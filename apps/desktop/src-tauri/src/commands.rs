use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Instant, SystemTime};

use tauri::{AppHandle, Manager, State};

use crate::error::{AppError, Result};
use crate::frecency::{self, FrecencyEntry};
use crate::models::{ContentHit, FileHit, NoteDoc, NoteMeta};
use crate::notebook::{self, NoteRecord};
use crate::search;
use crate::state::{find_record, AppState, NotebookState};
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

fn notebook_context(state: &AppState) -> Result<(PathBuf, u64)> {
    state
        .notebook
        .lock()
        .unwrap()
        .context()
        .ok_or(AppError::NoNotebook)
}

fn ensure_context(state: &NotebookState, root: &Path, generation: u64) -> Result<()> {
    if state.matches_context(root, generation) {
        Ok(())
    } else {
        Err(AppError::Msg(
            "notebook changed while the operation was running".into(),
        ))
    }
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
    let requested_root = PathBuf::from(&path);
    if !requested_root.is_dir() {
        return Err(AppError::Msg(format!("not a directory: {path}")));
    }
    let load_token = state.notebook.lock().unwrap().begin_load();
    let store = frecency_file(&app);
    let (root, scan, frec) = blocking(move || {
        let scan_root = std::fs::canonicalize(&requested_root)?;
        let scan = notebook::scan_notebook(&scan_root)?;
        let frec = store.map_or_else(HashMap::new, |file| {
            frecency::load(&file, &scan_root.to_string_lossy())
        });
        Ok((scan_root, scan, frec))
    })
    .await?;
    let metas = sorted_metas(&scan.records);
    let generation = {
        let mut g = state.notebook.lock().unwrap();
        let generation = g
            .finish_load(load_token, root.clone(), scan.records, scan.folders, frec)
            .ok_or_else(|| {
                AppError::Msg("notebook open was superseded by a newer request".into())
            })?;
        // Stop the previous notebook's watcher as part of the same ordered
        // commit. Keeping the notebook lock while taking the watcher lock also
        // establishes the lock order used by the installation below.
        *state.watcher.lock().unwrap() = None;
        generation
    };
    // Grant the asset protocol read access to THIS notebook's folder so the
    // editor can display relative-path images (editor/image.ts resolves them
    // through convertFileSrc). The static scope in tauri.conf.json is EMPTY on
    // purpose — least privilege: the webview can only ever read files under
    // notebooks the user actually opened this session. Grants are additive and
    // session-scoped; there is no revoke API, which matches the trust model
    // (the user opened the folder).
    if let Err(e) = app.asset_protocol_scope().allow_directory(&root, true) {
        eprintln!(
            "noteside: asset scope grant failed for {}: {e}",
            root.display()
        );
    }
    match watcher::start_watcher(app, state.notebook.clone(), root.clone(), generation) {
        Ok(d) => {
            // A newer open may have committed while this watcher was starting.
            // Hold the generation check across the watcher swap so a newer open
            // cannot commit between those two operations.
            let g = state.notebook.lock().unwrap();
            if g.matches_context(&root, generation) {
                *state.watcher.lock().unwrap() = Some(d);
            }
        }
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
    let (root, generation) = notebook_context(&state)?;
    let abs = notebook::safe_note_path(&root, &path)
        .ok_or_else(|| AppError::Msg("path is not a markdown note in the notebook".into()))?;
    let disk_root = root.clone();
    let rec = blocking(move || Ok(notebook::read_record(&disk_root, &abs)?)).await?;
    ensure_context(&state.notebook.lock().unwrap(), &root, generation)?;
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
    let (root, generation) = notebook_context(&state)?;
    let abs = notebook::safe_note_path(&root, &path)
        .ok_or_else(|| AppError::Msg("path is not a markdown note in the notebook".into()))?;
    let (meta, body) = blocking(move || {
        notebook::atomic_write(&abs, &body)?;
        let meta = notebook::parse_meta(path, &body, notebook::mtime_millis(&abs));
        Ok((meta, body))
    })
    .await?;
    let mut g = state.notebook.lock().unwrap();
    ensure_context(&g, &root, generation)?;
    g.record_own_write(meta.clone(), body, Instant::now());
    Ok(meta)
}

/// Create a note, optionally inside a folder (`dir`; None/"" = the notebook
/// root — the folder header's "New note here" passes a dir).
#[tauri::command]
pub async fn create_note(
    title: Option<String>,
    dir: Option<String>,
    state: State<'_, AppState>,
) -> Result<NoteMeta> {
    let (root, generation) = notebook_context(&state)?;
    let raw = title.unwrap_or_default();
    let display = if raw.trim().is_empty() {
        "Untitled".to_string()
    } else {
        raw.trim().to_string()
    };
    let folder = dir.unwrap_or_default();
    let dest = if folder.is_empty() {
        root.clone()
    } else {
        notebook::safe_dir_path(&root, &folder)
            .ok_or_else(|| AppError::Msg("destination is not a folder in the notebook".into()))?
    };
    let disk_root = root.clone();
    let (meta, initial) = blocking(move || {
        let initial = format!("# {display}\n\n");
        let abs = notebook::atomic_create_unique(&dest, &notebook::slugify(&display), &initial)?;
        let rel = notebook::rel_path(&disk_root, &abs);
        let meta = notebook::parse_meta(rel, &initial, notebook::mtime_millis(&abs));
        Ok((meta, initial))
    })
    .await?;
    let mut g = state.notebook.lock().unwrap();
    ensure_context(&g, &root, generation)?;
    g.record_own_write(meta.clone(), initial, Instant::now());
    g.add_folder(&folder);
    Ok(meta)
}

/// Rename a note's file so its slug matches its (frontmatter/heading-derived) title,
/// staying WITHIN the note's own directory (a nested note is never hoisted to the
/// root). No-op when the filename already represents the title (returns the current
/// meta).
#[tauri::command]
pub async fn rename_note(
    path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<NoteMeta> {
    // The body comes from the in-memory index (save_note just recorded it) — no
    // disk re-read on the hot save path; fall back to disk for an unindexed note.
    // Index-first is safe HERE because rename moves the inode and never writes
    // body bytes: a stale body can only mis-derive the slug, not lose content.
    // The body-REWRITING commands (retitle/pin/duplicate) read disk instead.
    let (root, generation, recorded) = {
        let g = state.notebook.lock().unwrap();
        let (root, generation) = g.context().ok_or(AppError::NoNotebook)?;
        let body = find_record(&g.records, &path).map(|i| g.records[i].body.clone());
        (root, generation, body)
    };
    let persist_root = root.clone();
    let disk_root = root.clone();
    let rel = path.clone();
    let (renamed, meta, body) = blocking(move || {
        let old_abs = notebook::safe_note_path(&disk_root, &rel)
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
        let dir = old_abs.parent().unwrap_or(&disk_root);
        let new_abs = notebook::rename_unique(&old_abs, dir, &slug)
            .map_err(|e| AppError::Msg(format!("rename failed: {e}")))?;
        let new_rel = notebook::rel_path(&disk_root, &new_abs);
        let meta = notebook::parse_meta(new_rel, &body, notebook::mtime_millis(&new_abs));
        Ok((true, meta, body))
    })
    .await?;
    let snapshot = {
        let mut g = state.notebook.lock().unwrap();
        ensure_context(&g, &root, generation)?;
        if renamed {
            g.record_own_rename(&path, meta.clone(), body, Instant::now());
        }
        g.frecency.clone()
    };
    if renamed {
        // The rename just migrated the note's frecency entry old→new path —
        // persist so a crash before the next open doesn't strand the old key.
        persist_frecency(&app, &persist_root, snapshot, now_ms()).await;
    }
    // No-op path: save_note already recorded this exact meta+body — nothing to update.
    Ok(meta)
}

/// The current notebook's folders (sorted relative dirs, empties included).
/// Folders are first-class sidebar data, kept on `NotebookState` under the
/// same snapshot discipline as `records`.
#[tauri::command]
pub fn list_folders(state: State<AppState>) -> Vec<String> {
    let g = state.notebook.lock().unwrap();
    g.folders.as_ref().clone()
}

/// Move a note into another folder (`dir`; "" = the notebook root), preserving
/// the filename STEM — a move is a location change, not a rename (the slug
/// still follows the title on the next explicit save). Destination collisions
/// get the usual `-N` suffix. Moving a note into the folder it already lives
/// in is a byte-free no-op returning the current meta (an mtime bump would
/// jump the note to the top of the updated-sort for nothing — the pin
/// short-circuit's reasoning).
#[tauri::command]
pub async fn move_note(
    path: String,
    dir: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<NoteMeta> {
    // Index-first body, exactly like rename_note: a move relinks the inode and
    // never writes body bytes, so a stale body cannot lose content.
    let (root, generation, recorded) = {
        let g = state.notebook.lock().unwrap();
        let (root, generation) = g.context().ok_or(AppError::NoNotebook)?;
        let body = find_record(&g.records, &path).map(|i| g.records[i].body.clone());
        (root, generation, body)
    };
    let persist_root = root.clone();
    let disk_root = root.clone();
    let rel = path.clone();
    let target = dir.clone();
    let (moved, meta, body) = blocking(move || {
        let old_abs = notebook::safe_note_path(&disk_root, &rel)
            .ok_or_else(|| AppError::Msg("path is not a markdown note in the notebook".into()))?;
        let body = match recorded {
            Some(b) => b,
            None => std::fs::read_to_string(&old_abs)
                .map_err(|e| AppError::Msg(format!("read failed: {e}")))?,
        };
        let dest = if target.is_empty() {
            disk_root.clone()
        } else {
            notebook::safe_dir_path(&disk_root, &target).ok_or_else(|| {
                AppError::Msg("destination is not a folder in the notebook".into())
            })?
        };
        let current = old_abs.parent().unwrap_or(&disk_root);
        if notebook::rel_path(&disk_root, current) == notebook::rel_path(&disk_root, &dest) {
            let meta = notebook::parse_meta(rel.clone(), &body, notebook::mtime_millis(&old_abs));
            return Ok((false, meta, body));
        }
        std::fs::create_dir_all(&dest)?;
        let stem = Path::new(&rel)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("untitled");
        // The hard-link move preserves the inode's mtime, so the note keeps its
        // place in the updated-sort and echo verification stays byte-exact.
        let new_abs = notebook::rename_unique(&old_abs, &dest, stem)
            .map_err(|e| AppError::Msg(format!("move failed: {e}")))?;
        let new_rel = notebook::rel_path(&disk_root, &new_abs);
        let meta = notebook::parse_meta(new_rel, &body, notebook::mtime_millis(&new_abs));
        Ok((true, meta, body))
    })
    .await?;
    let snapshot = {
        let mut g = state.notebook.lock().unwrap();
        ensure_context(&g, &root, generation)?;
        if moved {
            g.record_own_rename(&path, meta.clone(), body, Instant::now());
            g.add_folder(&dir);
        }
        g.frecency.clone()
    };
    if moved {
        // The move migrated the note's frecency entry old→new path — persist so
        // a crash before the next open doesn't strand the old key.
        persist_frecency(&app, &persist_root, snapshot, now_ms()).await;
    }
    Ok(meta)
}

/// Create a folder (possibly nested) under the notebook root and return its
/// canonical relative path. Each user-typed segment is sanitized; an existing
/// directory is an idempotent success, a FILE at the path errors. The folder
/// registers in state immediately, so an empty folder shows in the sidebar
/// without waiting for a note to land in it — and the pre-committed state is
/// what makes the watcher treat our own mkdir event as an echo.
#[tauri::command]
pub async fn create_folder(dir: String, state: State<'_, AppState>) -> Result<String> {
    let (root, generation) = notebook_context(&state)?;
    let segments: Vec<String> = dir
        .split('/')
        .filter(|s| !s.trim().is_empty())
        .map(|s| sanitize_folder(s).ok_or_else(|| AppError::Msg("folder name is empty".into())))
        .collect::<Result<_>>()?;
    if segments.is_empty() {
        return Err(AppError::Msg("folder name is empty".into()));
    }
    let rel = segments.join("/");
    let disk_root = root.clone();
    let target = rel.clone();
    blocking(move || {
        let abs = notebook::safe_dir_path(&disk_root, &target)
            .ok_or_else(|| AppError::Msg("folder name is not allowed".into()))?;
        if abs.exists() && !abs.is_dir() {
            return Err(AppError::Msg("a file with that name already exists".into()));
        }
        std::fs::create_dir_all(&abs)?;
        if let Some(parent) = abs.parent() {
            let _ = notebook::sync_directory(parent);
        }
        Ok(())
    })
    .await?;
    let mut g = state.notebook.lock().unwrap();
    ensure_context(&g, &root, generation)?;
    g.add_folder(&rel);
    Ok(rel)
}

/// Rename a folder's LAST segment in place (`work/projects` + "archive" →
/// `work/archive`) and return the new relative dir. The whole subtree moves
/// atomically via fs::rename; the commit rewrites every contained path and
/// migrates frecency keys. An occupied target errors — no silent `-N` for
/// directories — except a case-only rename, where a case-insensitive
/// filesystem (macOS/Windows) reports the target as existing because it IS
/// the source.
#[tauri::command]
pub async fn rename_folder(
    dir: String,
    name: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String> {
    let (root, generation) = notebook_context(&state)?;
    let segment =
        sanitize_folder(&name).ok_or_else(|| AppError::Msg("folder name is empty".into()))?;
    let new_rel = match dir.rfind('/') {
        Some(i) => format!("{}/{segment}", &dir[..i]),
        None => segment,
    };
    if new_rel == dir {
        return Ok(dir);
    }
    let disk_root = root.clone();
    let persist_root = root.clone();
    let old_rel = dir.clone();
    let target_rel = new_rel.clone();
    blocking(move || {
        let old_abs = notebook::safe_dir_path(&disk_root, &old_rel)
            .ok_or_else(|| AppError::Msg("not a folder in the notebook".into()))?;
        if !old_abs.is_dir() {
            return Err(AppError::Msg("not a folder in the notebook".into()));
        }
        let new_abs = notebook::safe_dir_path(&disk_root, &target_rel)
            .ok_or_else(|| AppError::Msg("folder name is not allowed".into()))?;
        let case_only = old_rel.eq_ignore_ascii_case(&target_rel);
        if new_abs.exists() && !case_only {
            return Err(AppError::Msg(
                "something with that name already exists".into(),
            ));
        }
        std::fs::rename(&old_abs, &new_abs)?;
        if let Some(parent) = new_abs.parent() {
            let _ = notebook::sync_directory(parent);
        }
        Ok(())
    })
    .await?;
    let snapshot = {
        let mut g = state.notebook.lock().unwrap();
        ensure_context(&g, &root, generation)?;
        g.record_own_folder_rename(&dir, &new_rel, Instant::now());
        g.frecency.clone()
    };
    // Many frecency keys just migrated — persist the whole map, as renames do.
    persist_frecency(&app, &persist_root, snapshot, now_ms()).await;
    Ok(new_rel)
}

/// Delete a folder RECURSIVELY (the frontend confirms with the contained note
/// count first — this is the permanent-delete precedent, folder-sized).
/// `remove_dir_all` does not traverse symlink targets. The commit drops the
/// subtree from the index and arms suppression per removed note, so the
/// flurry of child Remove events disk-verifies as gone and is swallowed.
#[tauri::command]
pub async fn delete_folder(dir: String, app: AppHandle, state: State<'_, AppState>) -> Result<()> {
    let (root, generation) = notebook_context(&state)?;
    let disk_root = root.clone();
    let persist_root = root.clone();
    let rel = dir.clone();
    blocking(move || {
        let abs = notebook::safe_dir_path(&disk_root, &rel)
            .ok_or_else(|| AppError::Msg("not a folder in the notebook".into()))?;
        if !abs.is_dir() {
            // Already gone: idempotent success, matching delete_note semantics.
            return Ok(());
        }
        std::fs::remove_dir_all(&abs)?;
        if let Some(parent) = abs.parent() {
            let _ = notebook::sync_directory(parent);
        }
        Ok(())
    })
    .await?;
    let snapshot = {
        let mut g = state.notebook.lock().unwrap();
        ensure_context(&g, &root, generation)?;
        g.record_own_folder_delete(&dir, Instant::now());
        g.frecency.clone()
    };
    // Entries under the folder were dropped — persist so they don't resurrect.
    persist_frecency(&app, &persist_root, snapshot, now_ms()).await;
    Ok(())
}

#[tauri::command]
pub async fn delete_note(path: String, state: State<'_, AppState>) -> Result<()> {
    let (root, generation) = notebook_context(&state)?;
    let abs = notebook::safe_note_path(&root, &path)
        .ok_or_else(|| AppError::Msg("path is not a markdown note in the notebook".into()))?;
    blocking(move || {
        notebook::remove_note(&abs)?;
        Ok(())
    })
    .await?;
    let mut g = state.notebook.lock().unwrap();
    ensure_context(&g, &root, generation)?;
    g.record_own_delete(&path, Instant::now());
    Ok(())
}

/// Copy a note to a new "<title> copy" file in the SAME directory (nested notes
/// stay nested), retitling the copy so the two don't share a title. Returns the
/// new note's meta (the caller inserts it and opens it).
#[tauri::command]
pub async fn duplicate_note(path: String, state: State<'_, AppState>) -> Result<NoteMeta> {
    let (root, generation) = notebook_context(&state)?;
    let disk_root = root.clone();
    let rel = path.clone();
    let (meta, new_body) = blocking(move || {
        let src_abs = notebook::safe_note_path(&disk_root, &rel)
            .ok_or_else(|| AppError::Msg("path is not a markdown note in the notebook".into()))?;
        // Disk is authoritative for the copy's content: the in-memory body can
        // lag it (the watcher debounce, or an external write landing inside the
        // own-write suppression window), and duplicating a stale body would
        // silently drop the external edit from the copy. This command is
        // human-paced, so the one extra read is free.
        let body = std::fs::read_to_string(&src_abs)
            .map_err(|e| AppError::Msg(format!("read failed: {e}")))?;
        let src_title = notebook::parse_meta(rel.clone(), &body, 0).title;
        let new_title = format!("{src_title} copy");
        let new_body = notebook::set_title(&body, &new_title);
        let dir = src_abs.parent().unwrap_or(&disk_root);
        let new_abs =
            notebook::atomic_create_unique(dir, &notebook::slugify(&new_title), &new_body)?;
        let new_rel = notebook::rel_path(&disk_root, &new_abs);
        let meta = notebook::parse_meta(new_rel, &new_body, notebook::mtime_millis(&new_abs));
        Ok((meta, new_body))
    })
    .await?;
    let mut g = state.notebook.lock().unwrap();
    ensure_context(&g, &root, generation)?;
    g.record_own_write(meta.clone(), new_body, Instant::now());
    Ok(meta)
}

/// Set a note's title: rewrite the title in the body (frontmatter/heading) and
/// rename the file to the new slug within its directory. Returns the new meta.
/// Both edits are own-writes, so the watcher ignores the resulting events.
#[tauri::command]
pub async fn retitle_note(
    path: String,
    title: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<NoteMeta> {
    let (root, generation) = notebook_context(&state)?;
    let persist_root = root.clone();
    let disk_root = root.clone();
    let rel = path.clone();
    let new_title = title.trim().to_string();
    if new_title.is_empty() {
        return Err(AppError::Msg("a note title can't be empty".into()));
    }
    let (renamed, meta, new_body) = blocking(move || {
        let old_abs = notebook::safe_note_path(&disk_root, &rel)
            .ok_or_else(|| AppError::Msg("path is not a markdown note in the notebook".into()))?;
        // Disk is authoritative for a rewrite: the in-memory body can lag it
        // (watcher debounce, or an external write inside the own-write
        // suppression window), and writing a stale body back would destroy the
        // external edit. Human-paced command — the read is free.
        let body = std::fs::read_to_string(&old_abs)
            .map_err(|e| AppError::Msg(format!("read failed: {e}")))?;
        let new_body = notebook::set_title(&body, &new_title);
        let slug = notebook::slugify(&new_title);
        let stem = Path::new(&rel)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("");
        if notebook::stem_matches_slug(stem, &slug) {
            notebook::atomic_write(&old_abs, &new_body)?;
            let meta =
                notebook::parse_meta(rel.clone(), &new_body, notebook::mtime_millis(&old_abs));
            return Ok((false, meta, new_body));
        }
        let dir = old_abs.parent().unwrap_or(&disk_root);
        let new_abs = notebook::retitle_unique(&old_abs, dir, &slug, &new_body)
            .map_err(|e| AppError::Msg(format!("retitle failed: {e}")))?;
        let new_rel = notebook::rel_path(&disk_root, &new_abs);
        let meta = notebook::parse_meta(new_rel, &new_body, notebook::mtime_millis(&new_abs));
        Ok((true, meta, new_body))
    })
    .await?;
    let snapshot = {
        let mut g = state.notebook.lock().unwrap();
        ensure_context(&g, &root, generation)?;
        if renamed {
            g.record_own_rename(&path, meta.clone(), new_body, Instant::now());
        } else {
            g.record_own_write(meta.clone(), new_body, Instant::now());
        }
        g.frecency.clone()
    };
    if renamed {
        persist_frecency(&app, &persist_root, snapshot, now_ms()).await;
    }
    Ok(meta)
}

/// Pin or unpin a note by rewriting its `pinned` frontmatter flag. Pinned notes
/// sort to the top of the sidebar and of the finder's empty-query recents. The
/// filename never changes, so — unlike retitle — there is no rename or frecency
/// migration to do; this is just an own-write of the same path.
#[tauri::command]
pub async fn set_note_pinned(
    path: String,
    pinned: bool,
    state: State<'_, AppState>,
) -> Result<NoteMeta> {
    let (root, generation) = notebook_context(&state)?;
    let disk_root = root.clone();
    let rel = path.clone();
    let (changed, meta, new_body) = blocking(move || {
        let abs = notebook::safe_note_path(&disk_root, &rel)
            .ok_or_else(|| AppError::Msg("path is not a markdown note in the notebook".into()))?;
        // Disk is authoritative for a rewrite (see retitle_note): pinning must
        // rewrite the file's REAL current body, never a lagging index copy.
        let body = std::fs::read_to_string(&abs)
            .map_err(|e| AppError::Msg(format!("read failed: {e}")))?;
        let new_body = notebook::set_pinned(&body, pinned);
        // Already in the requested state. Writing identical bytes would still
        // bump mtime, which IS the sidebar's sort key — a redundant unpin would
        // silently jump the note to the top of "recently updated".
        if new_body == body {
            let meta = notebook::parse_meta(rel, &body, notebook::mtime_millis(&abs));
            return Ok((false, meta, body));
        }
        notebook::atomic_write(&abs, &new_body)?;
        let meta = notebook::parse_meta(rel, &new_body, notebook::mtime_millis(&abs));
        Ok((true, meta, new_body))
    })
    .await?;
    let mut g = state.notebook.lock().unwrap();
    ensure_context(&g, &root, generation)?;
    // Only a real write arms echo suppression — recording a write that never
    // happened could swallow a genuine external event for this path.
    if changed {
        g.record_own_write(meta.clone(), new_body, Instant::now());
    }
    Ok(meta)
}

/// Reveal a note's file in the OS file manager (Finder / File Explorer / …).
#[tauri::command]
pub fn reveal_note(path: String, app: AppHandle, state: State<AppState>) -> Result<()> {
    use tauri_plugin_opener::OpenerExt;
    let root = {
        let g = state.notebook.lock().unwrap();
        g.root.clone().ok_or(AppError::NoNotebook)?
    };
    let abs = notebook::safe_note_path(&root, &path)
        .ok_or_else(|| AppError::Msg("path is not a markdown note in the notebook".into()))?;
    app.opener()
        .reveal_item_in_dir(&abs)
        .map_err(|e| AppError::Msg(format!("reveal failed: {e}")))?;
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

#[cfg(test)]
mod tests {
    use super::{ensure_context, sanitize_folder};
    use crate::state::NotebookState;
    use std::collections::HashMap;
    use std::path::{Path, PathBuf};

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

    #[test]
    fn operation_context_rejects_a_previous_notebook_generation() {
        let mut state = NotebookState::default();
        let first = state.begin_load();
        let first_generation = state
            .finish_load(
                first,
                PathBuf::from("/first"),
                vec![],
                vec![],
                HashMap::new(),
            )
            .unwrap();
        assert!(ensure_context(&state, Path::new("/first"), first_generation).is_ok());

        let second = state.begin_load();
        state
            .finish_load(
                second,
                PathBuf::from("/second"),
                vec![],
                vec![],
                HashMap::new(),
            )
            .unwrap();
        assert!(ensure_context(&state, Path::new("/first"), first_generation).is_err());
    }
}
