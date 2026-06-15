use std::path::PathBuf;
use std::time::{Duration, Instant};

use tauri::{AppHandle, State};

use crate::error::{AppError, Result};
use crate::models::{ContentHit, FileHit, NoteDoc, NoteMeta};
use crate::search;
use crate::state::AppState;
use crate::vault::{self, NoteRecord};
use crate::watcher;

/// After our own write, ignore watcher echoes for a short window.
const SUPPRESS_MS: u64 = 700;

fn sorted_metas(records: &[NoteRecord]) -> Vec<NoteMeta> {
    let mut metas: Vec<NoteMeta> = records.iter().map(|r| r.meta.clone()).collect();
    metas.sort_by(|a, b| b.pinned.cmp(&a.pinned).then(b.updated.cmp(&a.updated)));
    metas
}

/// Open (or switch to) a vault folder: scan all Markdown files into the in-memory
/// index, start the file watcher, and return the note list.
#[tauri::command]
pub fn open_vault(path: String, app: AppHandle, state: State<AppState>) -> Result<Vec<NoteMeta>> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(AppError::Msg(format!("not a directory: {path}")));
    }
    let records = vault::scan_vault(&root);
    let metas = sorted_metas(&records);
    {
        let mut g = state.vault.lock().unwrap();
        g.root = Some(root.clone());
        g.records = records;
        g.suppress_until = None;
    }
    match watcher::start_watcher(app, state.vault.clone(), root) {
        Ok(d) => *state.watcher.lock().unwrap() = Some(d),
        Err(e) => eprintln!("noteside: file watcher failed to start: {e}"),
    }
    Ok(metas)
}

#[tauri::command]
pub fn current_vault(state: State<AppState>) -> Option<String> {
    let g = state.vault.lock().unwrap();
    g.root.as_ref().map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn list_notes(state: State<AppState>) -> Vec<NoteMeta> {
    let g = state.vault.lock().unwrap();
    sorted_metas(&g.records)
}

/// Read the raw file text fresh from disk (authoritative source of truth).
#[tauri::command]
pub fn read_note(path: String, state: State<AppState>) -> Result<NoteDoc> {
    let root = {
        let g = state.vault.lock().unwrap();
        g.root.clone().ok_or(AppError::NoVault)?
    };
    let abs = root.join(&path);
    let rec = vault::read_record(&root, &abs)?;
    Ok(NoteDoc {
        meta: rec.meta,
        body: rec.body,
    })
}

/// Atomically write the note and refresh its cached record. Returns fresh meta.
#[tauri::command]
pub fn save_note(path: String, body: String, state: State<AppState>) -> Result<NoteMeta> {
    let mut g = state.vault.lock().unwrap();
    let root = g.root.clone().ok_or(AppError::NoVault)?;
    let abs = root.join(&path);
    vault::atomic_write(&abs, &body)?;
    let meta = vault::parse_meta(path.clone(), &body, vault::mtime_millis(&abs));
    if let Some(rec) = g.records.iter_mut().find(|r| r.meta.path == path) {
        rec.meta = meta.clone();
        rec.body = body;
    } else {
        g.records.push(NoteRecord {
            meta: meta.clone(),
            body,
        });
    }
    g.suppress_until = Some(Instant::now() + Duration::from_millis(SUPPRESS_MS));
    Ok(meta)
}

#[tauri::command]
pub fn create_note(title: Option<String>, state: State<AppState>) -> Result<NoteMeta> {
    let mut g = state.vault.lock().unwrap();
    let root = g.root.clone().ok_or(AppError::NoVault)?;
    let raw = title.unwrap_or_default();
    let display = if raw.trim().is_empty() {
        "Untitled".to_string()
    } else {
        raw.trim().to_string()
    };
    let abs = vault::unique_note_path(&root, &vault::slugify(&display));
    let initial = format!("# {display}\n\n");
    vault::atomic_write(&abs, &initial)?;
    let rel = vault::rel_path(&root, &abs);
    let meta = vault::parse_meta(rel, &initial, vault::mtime_millis(&abs));
    g.records.push(NoteRecord {
        meta: meta.clone(),
        body: initial,
    });
    g.suppress_until = Some(Instant::now() + Duration::from_millis(SUPPRESS_MS));
    Ok(meta)
}

#[tauri::command]
pub fn delete_note(path: String, state: State<AppState>) -> Result<()> {
    let mut g = state.vault.lock().unwrap();
    let root = g.root.clone().ok_or(AppError::NoVault)?;
    let abs = root.join(&path);
    if abs.exists() {
        std::fs::remove_file(&abs)?;
    }
    g.records.retain(|r| r.meta.path != path);
    g.suppress_until = Some(Instant::now() + Duration::from_millis(SUPPRESS_MS));
    Ok(())
}

#[tauri::command]
pub fn search_files(query: String, state: State<AppState>) -> Vec<FileHit> {
    let g = state.vault.lock().unwrap();
    search::fuzzy_files(&g.records, &query, 200)
}

#[tauri::command]
pub fn search_content(
    query: String,
    mode: String,
    state: State<AppState>,
) -> Result<Vec<ContentHit>> {
    let g = state.vault.lock().unwrap();
    Ok(search::content_search(&g.records, &query, &mode, 200)?)
}
