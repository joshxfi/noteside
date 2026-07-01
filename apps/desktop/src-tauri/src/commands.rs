use std::path::{Path, PathBuf};
use std::time::Instant;

use tauri::{AppHandle, State};

use crate::error::{AppError, Result};
use crate::links;
use crate::models::{Backlink, ContentHit, FileHit, NoteDoc, NoteMeta};
use crate::notebook::{self, NoteRecord};
use crate::search;
use crate::state::AppState;
use crate::watcher;

async fn blocking<T, F>(f: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Msg(format!("worker failed: {e}")))?
}

fn sorted_metas(records: &[NoteRecord]) -> Vec<NoteMeta> {
    let mut metas: Vec<NoteMeta> = records.iter().map(|r| r.meta.clone()).collect();
    metas.sort_by(|a, b| b.pinned.cmp(&a.pinned).then(b.updated.cmp(&a.updated)));
    metas
}

/// Open (or switch to) a notebook folder: scan all Markdown files into the in-memory
/// index, start the file watcher, and return the note list.
#[tauri::command]
pub async fn open_notebook(
    path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<NoteMeta>> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(AppError::Msg(format!("not a directory: {path}")));
    }
    let scan_root = root.clone();
    let records = blocking(move || Ok(notebook::scan_notebook(&scan_root))).await?;
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
pub async fn read_note(path: String, state: State<'_, AppState>) -> Result<NoteDoc> {
    let root = {
        let g = state.notebook.lock().unwrap();
        g.root.clone().ok_or(AppError::NoNotebook)?
    };
    let abs = notebook::safe_note_path(&root, &path)
        .ok_or_else(|| AppError::Msg("path is not a markdown note in the notebook".into()))?;
    let rec = blocking(move || Ok(notebook::read_record(&root, &abs)?)).await?;
    Ok(NoteDoc {
        meta: rec.meta,
        body: rec.body,
    })
}

/// Read preview text from the in-memory index. Opening/editing still uses
/// `read_note`, which reads the authoritative file from disk.
#[tauri::command]
pub fn preview_note(path: String, state: State<AppState>) -> Result<NoteDoc> {
    let g = state.notebook.lock().unwrap();
    if g.root.is_none() {
        return Err(AppError::NoNotebook);
    }
    let rec = g
        .records
        .iter()
        .find(|r| r.meta.path == path)
        .ok_or_else(|| AppError::Msg("note is not in the notebook index".into()))?;
    Ok(NoteDoc {
        meta: rec.meta.clone(),
        body: rec.body.clone(),
    })
}

/// Atomically write the note and refresh its cached record. Returns fresh meta.
#[tauri::command]
pub async fn save_note(path: String, body: String, state: State<'_, AppState>) -> Result<NoteMeta> {
    let root = {
        let g = state.notebook.lock().unwrap();
        g.root.clone().ok_or(AppError::NoNotebook)?
    };
    let abs = notebook::safe_note_path(&root, &path)
        .ok_or_else(|| AppError::Msg("path is not a markdown note in the notebook".into()))?;
    let (meta, body) = blocking(move || {
        notebook::atomic_write(&abs, &body)?;
        let meta = notebook::parse_meta(path, &body, notebook::mtime_millis(&abs));
        Ok((meta, body))
    })
    .await?;
    let mut g = state.notebook.lock().unwrap();
    g.record_own_write(meta.clone(), body, Instant::now());
    Ok(meta)
}

#[tauri::command]
pub async fn create_note(title: Option<String>, state: State<'_, AppState>) -> Result<NoteMeta> {
    let root = {
        let g = state.notebook.lock().unwrap();
        g.root.clone().ok_or(AppError::NoNotebook)?
    };
    let raw = title.unwrap_or_default();
    let display = if raw.trim().is_empty() {
        "Untitled".to_string()
    } else {
        raw.trim().to_string()
    };
    let (meta, initial) = blocking(move || {
        let abs = notebook::unique_note_path(&root, &notebook::slugify(&display));
        let initial = format!("# {display}\n\n");
        notebook::atomic_write(&abs, &initial)?;
        let rel = notebook::rel_path(&root, &abs);
        let meta = notebook::parse_meta(rel, &initial, notebook::mtime_millis(&abs));
        Ok((meta, initial))
    })
    .await?;
    let mut g = state.notebook.lock().unwrap();
    g.record_own_write(meta.clone(), initial, Instant::now());
    Ok(meta)
}

/// Rename a note's file so its slug matches its (frontmatter/heading-derived) title.
/// No-op when the filename already represents the title (returns the current meta).
/// Wikilinks resolve by title, so title-based `[[links]]` keep working across the move.
#[tauri::command]
pub async fn rename_note(path: String, state: State<'_, AppState>) -> Result<NoteMeta> {
    let root = {
        let g = state.notebook.lock().unwrap();
        g.root.clone().ok_or(AppError::NoNotebook)?
    };
    let rel = path.clone();
    let (renamed, meta, body) = blocking(move || {
        let old_abs = notebook::safe_note_path(&root, &rel)
            .ok_or_else(|| AppError::Msg("path is not a markdown note in the notebook".into()))?;
        let body = std::fs::read_to_string(&old_abs)
            .map_err(|e| AppError::Msg(format!("read failed: {e}")))?;
        // Derive the title exactly as the index does, then slugify it.
        let title = notebook::parse_meta(rel.clone(), &body, 0).title;
        let slug = notebook::slugify(&title);
        let stem = Path::new(&rel).file_stem().and_then(|s| s.to_str()).unwrap_or("");
        if notebook::stem_matches_slug(stem, &slug) {
            let meta = notebook::parse_meta(rel.clone(), &body, notebook::mtime_millis(&old_abs));
            return Ok((false, meta, body));
        }
        let new_abs = notebook::unique_note_path(&root, &slug);
        std::fs::rename(&old_abs, &new_abs)
            .map_err(|e| AppError::Msg(format!("rename failed: {e}")))?;
        let new_rel = notebook::rel_path(&root, &new_abs);
        let meta = notebook::parse_meta(new_rel, &body, notebook::mtime_millis(&new_abs));
        Ok((true, meta, body))
    })
    .await?;
    let mut g = state.notebook.lock().unwrap();
    if renamed {
        g.record_own_rename(&path, meta.clone(), body, Instant::now());
    } else {
        // Refresh the in-memory meta (title may have changed) without a move.
        g.record_own_write(meta.clone(), body, Instant::now());
    }
    Ok(meta)
}

#[tauri::command]
pub async fn delete_note(path: String, state: State<'_, AppState>) -> Result<()> {
    let root = {
        let g = state.notebook.lock().unwrap();
        g.root.clone().ok_or(AppError::NoNotebook)?
    };
    let abs = notebook::safe_note_path(&root, &path)
        .ok_or_else(|| AppError::Msg("path is not a markdown note in the notebook".into()))?;
    blocking(move || {
        if abs.exists() {
            std::fs::remove_file(&abs)?;
        }
        Ok(())
    })
    .await?;
    let mut g = state.notebook.lock().unwrap();
    g.record_own_delete(&path, Instant::now());
    Ok(())
}

#[tauri::command]
pub async fn search_files(query: String, state: State<'_, AppState>) -> Result<Vec<FileHit>> {
    let records = {
        let g = state.notebook.lock().unwrap();
        g.records.clone()
    };
    blocking(move || Ok(search::fuzzy_files(records.as_slice(), &query, 200))).await
}

#[tauri::command]
pub async fn search_content(
    query: String,
    mode: String,
    state: State<'_, AppState>,
) -> Result<Vec<ContentHit>> {
    let records = {
        let g = state.notebook.lock().unwrap();
        g.records.clone()
    };
    blocking(move || {
        Ok(search::content_search(
            records.as_slice(),
            &query,
            &mode,
            200,
        )?)
    })
    .await
}

/// Notes that link to `id` via [[wikilinks]]. Scanned in Rust over the cached
/// index so only the matching references cross IPC (not every note body).
#[tauri::command]
pub async fn backlinks(id: String, state: State<'_, AppState>) -> Result<Vec<Backlink>> {
    let records = {
        let g = state.notebook.lock().unwrap();
        g.records.clone()
    };
    blocking(move || Ok(links::backlinks(records.as_slice(), &id))).await
}
