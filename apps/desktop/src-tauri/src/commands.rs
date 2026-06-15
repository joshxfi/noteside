use std::path::PathBuf;
use std::time::Instant;

use tauri::{AppHandle, State};

use crate::error::{AppError, Result};
use crate::links;
use crate::models::{Backlink, ContentHit, FileHit, NoteDoc, NoteMeta};
use crate::search;
use crate::state::AppState;
use crate::notebook::{self, NoteRecord};
use crate::watcher;

fn sorted_metas(records: &[NoteRecord]) -> Vec<NoteMeta> {
    let mut metas: Vec<NoteMeta> = records.iter().map(|r| r.meta.clone()).collect();
    metas.sort_by(|a, b| b.pinned.cmp(&a.pinned).then(b.updated.cmp(&a.updated)));
    metas
}

/// Open (or switch to) a notebook folder: scan all Markdown files into the in-memory
/// index, start the file watcher, and return the note list.
#[tauri::command]
pub fn open_notebook(path: String, app: AppHandle, state: State<AppState>) -> Result<Vec<NoteMeta>> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(AppError::Msg(format!("not a directory: {path}")));
    }
    let records = notebook::scan_notebook(&root);
    let metas = sorted_metas(&records);
    {
        let mut g = state.notebook.lock().unwrap();
        g.load(root.clone(), records);
    }
    match watcher::start_watcher(app, state.notebook.clone(), root) {
        Ok(d) => *state.watcher.lock().unwrap() = Some(d),
        Err(e) => eprintln!("noteside: file watcher failed to start: {e}"),
    }
    Ok(metas)
}

#[tauri::command]
pub fn current_notebook(state: State<AppState>) -> Option<String> {
    let g = state.notebook.lock().unwrap();
    g.root.as_ref().map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn list_notes(state: State<AppState>) -> Vec<NoteMeta> {
    let g = state.notebook.lock().unwrap();
    sorted_metas(&g.records)
}

/// Read the raw file text fresh from disk (authoritative source of truth).
#[tauri::command]
pub fn read_note(path: String, state: State<AppState>) -> Result<NoteDoc> {
    let root = {
        let g = state.notebook.lock().unwrap();
        g.root.clone().ok_or(AppError::NoNotebook)?
    };
    let abs = notebook::safe_join(&root, &path).ok_or_else(|| AppError::Msg("path escapes the notebook".into()))?;
    let rec = notebook::read_record(&root, &abs)?;
    Ok(NoteDoc {
        meta: rec.meta,
        body: rec.body,
    })
}

/// Atomically write the note and refresh its cached record. Returns fresh meta.
#[tauri::command]
pub fn save_note(path: String, body: String, state: State<AppState>) -> Result<NoteMeta> {
    let mut g = state.notebook.lock().unwrap();
    let root = g.root.clone().ok_or(AppError::NoNotebook)?;
    let abs = notebook::safe_join(&root, &path).ok_or_else(|| AppError::Msg("path escapes the notebook".into()))?;
    notebook::atomic_write(&abs, &body)?;
    let meta = notebook::parse_meta(path.clone(), &body, notebook::mtime_millis(&abs));
    g.record_own_write(meta.clone(), body, Instant::now());
    Ok(meta)
}

#[tauri::command]
pub fn create_note(title: Option<String>, state: State<AppState>) -> Result<NoteMeta> {
    let mut g = state.notebook.lock().unwrap();
    let root = g.root.clone().ok_or(AppError::NoNotebook)?;
    let raw = title.unwrap_or_default();
    let display = if raw.trim().is_empty() {
        "Untitled".to_string()
    } else {
        raw.trim().to_string()
    };
    let abs = notebook::unique_note_path(&root, &notebook::slugify(&display));
    let initial = format!("# {display}\n\n");
    notebook::atomic_write(&abs, &initial)?;
    let rel = notebook::rel_path(&root, &abs);
    let meta = notebook::parse_meta(rel, &initial, notebook::mtime_millis(&abs));
    g.record_own_write(meta.clone(), initial, Instant::now());
    Ok(meta)
}

#[tauri::command]
pub fn delete_note(path: String, state: State<AppState>) -> Result<()> {
    let mut g = state.notebook.lock().unwrap();
    let root = g.root.clone().ok_or(AppError::NoNotebook)?;
    let abs = notebook::safe_join(&root, &path).ok_or_else(|| AppError::Msg("path escapes the notebook".into()))?;
    if abs.exists() {
        std::fs::remove_file(&abs)?;
    }
    g.record_own_delete(&path, Instant::now());
    Ok(())
}

#[tauri::command]
pub fn search_files(query: String, state: State<AppState>) -> Vec<FileHit> {
    let g = state.notebook.lock().unwrap();
    search::fuzzy_files(&g.records, &query, 200)
}

#[tauri::command]
pub fn search_content(
    query: String,
    mode: String,
    state: State<AppState>,
) -> Result<Vec<ContentHit>> {
    let g = state.notebook.lock().unwrap();
    Ok(search::content_search(&g.records, &query, &mode, 200)?)
}

/// Notes that link to `id` via [[wikilinks]]. Scanned in Rust over the cached
/// index so only the matching references cross IPC (not every note body).
#[tauri::command]
pub fn backlinks(id: String, state: State<AppState>) -> Result<Vec<Backlink>> {
    let g = state.notebook.lock().unwrap();
    Ok(links::backlinks(&g.records, &id))
}
