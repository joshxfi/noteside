use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Instant, SystemTime};

use tauri::{AppHandle, Manager, State};

use crate::error::{AppError, Result};
use crate::frecency::{self, FrecencyEntry};
use crate::links;
use crate::models::{Backlink, ContentHit, FileHit, NoteDoc, NoteMeta};
use crate::notebook::{self, NoteRecord};
use crate::search;
use crate::state::{find_record, AppState};
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

/// Wall-clock unix ms, taken once per command and passed down so `search`/
/// `frecency` stay pure and deterministic under test.
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

/// The shared frecency store: `frecency.json` in the per-app data dir (one
/// file for all notebooks, keyed inside by notebook root path).
fn frecency_file(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join("frecency.json"))
}

/// Persist a notebook's frecency snapshot, off the state lock. Best-effort:
/// frecency is reconstructible ranking data, so I/O problems (including a
/// missing app-data dir resolution) never fail the calling command.
async fn persist_frecency(
    app: &AppHandle,
    root: &Path,
    snapshot: Arc<HashMap<String, FrecencyEntry>>,
    now_ms: u64,
) {
    let Some(file) = frecency_file(app) else {
        return;
    };
    let root = root.to_string_lossy().to_string();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        frecency::save(&file, &root, &snapshot, now_ms);
    })
    .await;
}

fn sorted_metas(records: &[Arc<NoteRecord>]) -> Vec<NoteMeta> {
    let mut metas: Vec<NoteMeta> = records.iter().map(|r| r.meta.clone()).collect();
    metas.sort_by(|a, b| b.pinned.cmp(&a.pinned).then(b.updated.cmp(&a.updated)));
    metas
}

/// Sanitize a user-typed notebook name into a single safe path segment: drop
/// control + reserved filesystem characters and leading/trailing dots/space.
/// Returns None when nothing usable remains (so the caller can reject it).
fn sanitize_folder(name: &str) -> Option<String> {
    let cleaned: String = name
        .trim()
        .chars()
        .filter(|c| {
            !c.is_control() && !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
        })
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').trim();
    (!cleaned.is_empty()).then(|| cleaned.to_string())
}

/// Create a new notebook folder named `name` under `parent` and return its path.
/// The name is sanitized to one path segment; an already-existing directory is
/// fine (the caller then `open_notebook`s the returned path).
#[tauri::command]
pub async fn create_notebook(parent: String, name: String) -> Result<String> {
    let folder =
        sanitize_folder(&name).ok_or_else(|| AppError::Msg("notebook name is empty".into()))?;
    let parent = PathBuf::from(&parent);
    if !parent.is_dir() {
        return Err(AppError::Msg(format!(
            "not a directory: {}",
            parent.display()
        )));
    }
    let dir = parent.join(&folder);
    blocking(move || {
        if dir.exists() {
            if !dir.is_dir() {
                return Err(AppError::Msg("a file with that name already exists".into()));
            }
        } else {
            std::fs::create_dir(&dir)?;
        }
        Ok(dir.to_string_lossy().to_string())
    })
    .await
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
    let store = frecency_file(&app);
    let (records, frec) = blocking(move || {
        let records = notebook::scan_notebook(&scan_root);
        let frec = store.map_or_else(HashMap::new, |file| {
            frecency::load(&file, &scan_root.to_string_lossy())
        });
        Ok((records, frec))
    })
    .await?;
    let metas = sorted_metas(&records);
    {
        let mut g = state.notebook.lock().unwrap();
        g.load(root.clone(), records, frec);
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
    // Clone the record's Arc under the lock; the string copies for the IPC
    // payload happen after it is released.
    let rec = {
        let g = state.notebook.lock().unwrap();
        if g.root.is_none() {
            return Err(AppError::NoNotebook);
        }
        let i = find_record(&g.records, &path)
            .ok_or_else(|| AppError::Msg("note is not in the notebook index".into()))?;
        g.records[i].clone()
    };
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

/// Rename a note's file so its slug matches its (frontmatter/heading-derived) title,
/// staying WITHIN the note's own directory (a nested note is never hoisted to the
/// root). No-op when the filename already represents the title (returns the current
/// meta). Wikilinks resolve by title, so `[[links]]` keep working across the move.
#[tauri::command]
pub async fn rename_note(
    path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<NoteMeta> {
    // The body comes from the in-memory index (save_note just recorded it) — no
    // disk re-read on the hot save path; fall back to disk for an unindexed note.
    let (root, recorded) = {
        let g = state.notebook.lock().unwrap();
        let root = g.root.clone().ok_or(AppError::NoNotebook)?;
        let body = find_record(&g.records, &path).map(|i| g.records[i].body.clone());
        (root, body)
    };
    let persist_root = root.clone();
    let rel = path.clone();
    let (renamed, meta, body) = blocking(move || {
        let old_abs = notebook::safe_note_path(&root, &rel)
            .ok_or_else(|| AppError::Msg("path is not a markdown note in the notebook".into()))?;
        let body = match recorded {
            Some(b) => b,
            None => std::fs::read_to_string(&old_abs)
                .map_err(|e| AppError::Msg(format!("read failed: {e}")))?,
        };
        // Derive the title exactly as the index does, then slugify it.
        let mut meta = notebook::parse_meta(rel.clone(), &body, 0);
        let slug = notebook::slugify(&meta.title);
        let stem = Path::new(&rel)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("");
        if notebook::stem_matches_slug(stem, &slug) {
            meta.updated = notebook::mtime_millis(&old_abs);
            return Ok((false, meta, body));
        }
        let dir = old_abs.parent().unwrap_or(&root);
        let new_abs = notebook::unique_note_path(dir, &slug);
        std::fs::rename(&old_abs, &new_abs)
            .map_err(|e| AppError::Msg(format!("rename failed: {e}")))?;
        let new_rel = notebook::rel_path(&root, &new_abs);
        let meta = notebook::parse_meta(new_rel, &body, notebook::mtime_millis(&new_abs));
        Ok((true, meta, body))
    })
    .await?;
    if renamed {
        let snapshot = {
            let mut g = state.notebook.lock().unwrap();
            g.record_own_rename(&path, meta.clone(), body, Instant::now());
            g.frecency.clone()
        };
        // The rename just migrated the note's frecency entry old→new path —
        // persist so a crash before the next open doesn't strand the old key.
        persist_frecency(&app, &persist_root, snapshot, now_ms()).await;
    }
    // No-op path: save_note already recorded this exact meta+body — nothing to update.
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

/// Record a note open for frecency ranking (finder recents + a bounded search
/// nudge), then persist the notebook's map — opens are human-paced, so an
/// immediate write is cheap and durable. Never fails over bookkeeping.
#[tauri::command]
pub async fn record_open(path: String, app: AppHandle, state: State<'_, AppState>) -> Result<()> {
    let now = now_ms();
    let (root, snapshot) = {
        let mut g = state.notebook.lock().unwrap();
        let Some(root) = g.root.clone() else {
            return Ok(());
        };
        // Only indexed notes count — synthetic buffers (e.g. the config
        // buffer) and stale paths must not accumulate in the map.
        if find_record(&g.records, &path).is_none() {
            return Ok(());
        }
        g.record_open(&path, now);
        (root, g.frecency.clone())
    };
    persist_frecency(&app, &root, snapshot, now).await;
    Ok(())
}

#[tauri::command]
pub async fn search_files(query: String, state: State<'_, AppState>) -> Result<Vec<FileHit>> {
    let now = now_ms();
    let (records, frecency) = {
        let g = state.notebook.lock().unwrap();
        (g.records.clone(), g.frecency.clone())
    };
    blocking(move || {
        Ok(search::fuzzy_files(
            records.as_slice(),
            &query,
            200,
            &frecency,
            now,
        ))
    })
    .await
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

#[cfg(test)]
mod tests {
    use super::sanitize_folder;

    #[test]
    fn sanitize_folder_strips_reserved_chars_and_edge_dots() {
        assert_eq!(sanitize_folder("My Ideas").as_deref(), Some("My Ideas"));
        assert_eq!(
            sanitize_folder("  work/notes:2  ").as_deref(),
            Some("worknotes2")
        );
        assert_eq!(sanitize_folder("..hidden.").as_deref(), Some("hidden"));
        assert_eq!(sanitize_folder("   "), None);
        assert_eq!(sanitize_folder("///"), None);
        assert_eq!(sanitize_folder("..."), None);
    }
}
