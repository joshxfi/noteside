use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Instant, SystemTime};

use notify::RecommendedWatcher;
use notify_debouncer_full::{Debouncer, FileIdMap};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::error::{AppError, Result};
use crate::frecency::{self, FrecencyEntry};
use crate::models::{ContentHit, Degradation, FileHit, FolderContents, NoteDoc, NoteMeta};
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

/// Take the notebook lock, recovering from poisoning. A panic inside a command
/// while the guard is held would otherwise make EVERY later unwrapped lock on
/// it panic too (dev/test builds unwind; release aborts on the first panic). The
/// index is rebuildable state — the next `finish_load` restores every invariant
/// — so continuing with the inner value is the right call (frecency::save uses
/// the same idiom for its own lock).
fn notebook_lock(state: &AppState) -> std::sync::MutexGuard<'_, NotebookState> {
    state
        .notebook
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

type WatcherHandle = Debouncer<RecommendedWatcher, FileIdMap>;

/// Same recovery for the watcher slot: a poisoned watcher mutex would wedge
/// every notebook open, and the worst case here is re-installing a debouncer.
fn watcher_lock(state: &AppState) -> std::sync::MutexGuard<'_, Option<WatcherHandle>> {
    state
        .watcher
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
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
    notebook_lock(state).context().ok_or(AppError::NoNotebook)
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

/// Count the files and subdirectories under `abs`, recursively, following no
/// symlinks. `notes` = `.md` files, `other_files` = everything else (hidden
/// files included — they are removed too), `dirs` = subdirectories (not `abs`).
fn folder_contents(abs: &Path) -> std::io::Result<FolderContents> {
    let mut out = FolderContents::default();
    for entry in walkdir::WalkDir::new(abs).min_depth(1).follow_links(false) {
        let entry = entry?;
        let ft = entry.file_type();
        if ft.is_dir() {
            out.dirs += 1;
        } else if entry.path().extension().and_then(|x| x.to_str()) == Some("md") {
            out.notes += 1;
        } else {
            out.other_files += 1;
        }
    }
    Ok(out)
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
    let load_token = notebook_lock(&state).begin_load();
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
        let mut g = notebook_lock(&state);
        let generation = g
            .finish_load(load_token, root.clone(), scan.records, scan.folders, frec)
            .ok_or_else(|| {
                AppError::Msg("notebook open was superseded by a newer request".into())
            })?;
        // Stop the previous notebook's watcher as part of the same ordered
        // commit. Keeping the notebook lock while taking the watcher lock also
        // establishes the lock order used by the installation below.
        *watcher_lock(&state) = None;
        generation
    };
    // Grant the asset protocol read access to THIS notebook's folder so the
    // editor can display relative-path images (editor/image.ts resolves them
    // through convertFileSrc). The static scope in tauri.conf.json is EMPTY on
    // purpose — least privilege: the webview can only ever read files under
    // notebooks the user actually opened this session. Grants are additive and
    // session-scoped; there is no revoke API, which matches the trust model
    // (the user opened the folder).
    // `start_watcher` MOVES `app`, so keep a handle for the degradation emits.
    let emitter = app.clone();
    if let Err(e) = app.asset_protocol_scope().allow_directory(&root, true) {
        eprintln!(
            "noteside: asset scope grant failed for {}: {e}",
            root.display()
        );
        let _ = emitter.emit(
            "notebook:degraded",
            Degradation {
                kind: "asset-scope".into(),
                message: e.to_string(),
            },
        );
    }
    match watcher::start_watcher(app, state.notebook.clone(), root.clone(), generation) {
        Ok(d) => {
            // A newer open may have committed while this watcher was starting.
            // Hold the generation check across the watcher swap so a newer open
            // cannot commit between those two operations.
            let g = notebook_lock(&state);
            if g.matches_context(&root, generation) {
                *watcher_lock(&state) = Some(d);
            }
        }
        Err(e) => {
            eprintln!("noteside: file watcher failed to start: {e}");
            let _ = emitter.emit(
                "notebook:degraded",
                Degradation {
                    kind: "watcher".into(),
                    message: e.to_string(),
                },
            );
        }
    }
    Ok(metas)
}

#[tauri::command]
pub async fn current_notebook(state: State<'_, AppState>) -> Result<Option<String>> {
    let g = notebook_lock(&state);
    Ok(g.root.as_ref().map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn list_notes(state: State<'_, AppState>) -> Result<Vec<NoteMeta>> {
    // Snapshot the Arc under the lock; the per-meta clones + sort run after it
    // is released (the session's reconcile calls this on every external change).
    let records = notebook_lock(&state).records.clone();
    Ok(sorted_metas(&records))
}

/// Read the raw file text fresh from disk (authoritative source of truth).
#[tauri::command]
pub async fn read_note(path: String, state: State<'_, AppState>) -> Result<NoteDoc> {
    let (root, generation) = notebook_context(&state)?;
    let abs = notebook::safe_note_path(&root, &path)
        .ok_or_else(|| AppError::Msg("path is not a markdown note in the notebook".into()))?;
    let disk_root = root.clone();
    let rec = blocking(move || Ok(notebook::read_record(&disk_root, &abs)?)).await?;
    ensure_context(&notebook_lock(&state), &root, generation)?;
    Ok(NoteDoc {
        meta: rec.meta,
        body: rec.body,
    })
}

/// Read preview text from the in-memory index. Opening/editing still uses
/// `read_note`, which reads the authoritative file from disk.
#[tauri::command]
pub async fn preview_note(path: String, state: State<'_, AppState>) -> Result<NoteDoc> {
    // Clone the record's Arc under the lock; the string copies for the IPC
    // payload happen after it is released.
    let rec = {
        let g = notebook_lock(&state);
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
    let mut g = notebook_lock(&state);
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
    let (meta, initial, folder) = blocking(move || {
        // Resolve the folder's on-disk spelling first (a case-insensitive volume
        // maps `work` onto an existing `Work`), so the note's id — and the
        // folder we register — match what a rescan would produce.
        std::fs::create_dir_all(&dest)?;
        let folder = notebook::disk_rel_dir(&disk_root, &dest);
        let dest = disk_root.join(&folder);
        let initial = format!("# {display}\n\n");
        let abs = notebook::atomic_create_unique(&dest, &notebook::slugify(&display), &initial)?;
        let rel = notebook::rel_path(&disk_root, &abs);
        let meta = notebook::parse_meta(rel, &initial, notebook::mtime_millis(&abs));
        Ok((meta, initial, folder))
    })
    .await?;
    let mut g = notebook_lock(&state);
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
        let g = notebook_lock(&state);
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
        let mut g = notebook_lock(&state);
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
pub async fn list_folders(state: State<'_, AppState>) -> Result<Vec<String>> {
    let g = notebook_lock(&state);
    Ok(g.folders.as_ref().clone())
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
        let g = notebook_lock(&state);
        let (root, generation) = g.context().ok_or(AppError::NoNotebook)?;
        let body = find_record(&g.records, &path).map(|i| g.records[i].body.clone());
        (root, generation, body)
    };
    let persist_root = root.clone();
    let disk_root = root.clone();
    let rel = path.clone();
    let target = dir.clone();
    let (moved, meta, body, dest_rel) = blocking(move || {
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
        // Resolve both directories to their on-disk spelling before comparing:
        // on a case-insensitive volume `work` and `Work` are ONE directory, and
        // a string compare would "move" the note onto itself (the self hard-link
        // collides, and the note came back renamed `-2` under a phantom group).
        std::fs::create_dir_all(&dest)?;
        let dest_rel = notebook::disk_rel_dir(&disk_root, &dest);
        let current = old_abs.parent().unwrap_or(&disk_root);
        if notebook::disk_rel_dir(&disk_root, current) == dest_rel {
            let meta = notebook::parse_meta(rel.clone(), &body, notebook::mtime_millis(&old_abs));
            return Ok((false, meta, body, dest_rel));
        }
        let dest = disk_root.join(&dest_rel);
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
        Ok((true, meta, body, dest_rel))
    })
    .await?;
    let snapshot = {
        let mut g = notebook_lock(&state);
        ensure_context(&g, &root, generation)?;
        if moved {
            g.record_own_rename(&path, meta.clone(), body, Instant::now());
            g.add_folder(&dest_rel);
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
    let rel = blocking(move || {
        let abs = notebook::safe_dir_path(&disk_root, &target)
            .ok_or_else(|| AppError::Msg("folder name is not allowed".into()))?;
        if abs.exists() && !abs.is_dir() {
            return Err(AppError::Msg("a file with that name already exists".into()));
        }
        std::fs::create_dir_all(&abs)?;
        if let Some(parent) = abs.parent() {
            let _ = notebook::sync_directory(parent);
        }
        // Report the folder as the disk spells it: typing `work` where `Work`
        // exists on a case-insensitive volume is that folder, not a second one.
        Ok(notebook::disk_rel_dir(&disk_root, &abs))
    })
    .await?;
    let mut g = notebook_lock(&state);
    ensure_context(&g, &root, generation)?;
    g.add_folder(&rel);
    Ok(rel)
}

/// Rename a folder's LAST segment in place (`work/projects` + "archive" →
/// `work/archive`) and return the new relative dir. The whole subtree moves
/// atomically via fs::rename; the commit rewrites every contained path and
/// migrates frecency keys. An occupied target errors — no silent `-N` for
/// directories — unless the "occupant" IS the source: a case-insensitive
/// filesystem (macOS/Windows) reports `work` as existing when renaming
/// `Work`. That is decided by identity (both paths canonicalize to the same
/// directory), never by comparing spellings — on a case-sensitive filesystem
/// `Work` and `work` can be two real directories, and POSIX rename would
/// silently replace an empty one.
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
        if new_abs.exists() {
            let same_dir =
                std::fs::canonicalize(&new_abs).ok() == std::fs::canonicalize(&old_abs).ok();
            if !same_dir {
                return Err(AppError::Msg(
                    "something with that name already exists".into(),
                ));
            }
        }
        std::fs::rename(&old_abs, &new_abs)
            .map_err(|e| AppError::Msg(format!("rename failed: {e}")))?;
        if let Some(parent) = new_abs.parent() {
            let _ = notebook::sync_directory(parent);
        }
        Ok(())
    })
    .await?;
    let snapshot = {
        let mut g = notebook_lock(&state);
        ensure_context(&g, &root, generation)?;
        g.record_own_folder_rename(&dir, &new_rel, Instant::now());
        g.frecency.clone()
    };
    // Many frecency keys just migrated — persist the whole map, as renames do.
    persist_frecency(&app, &persist_root, snapshot, now_ms()).await;
    Ok(new_rel)
}

/// Dry run for `delete_folder`: what the confirm dialog should say. Read-only.
#[tauri::command]
pub async fn folder_contents_of(dir: String, state: State<'_, AppState>) -> Result<FolderContents> {
    let (root, generation) = notebook_context(&state)?;
    let disk_root = root.clone();
    let contents = blocking(move || {
        let abs = notebook::safe_dir_path(&disk_root, &dir)
            .ok_or_else(|| AppError::Msg("not a folder in the notebook".into()))?;
        if !abs.is_dir() {
            return Ok(FolderContents::default());
        }
        Ok(folder_contents(&abs)?)
    })
    .await?;
    ensure_context(&notebook_lock(&state), &root, generation)?;
    Ok(contents)
}

/// Delete a folder RECURSIVELY (the frontend confirms first, with the walk
/// `folder_contents_of` returns — this is the permanent-delete precedent,
/// folder-sized). `remove_dir_all` does not traverse symlink targets. The
/// commit drops the subtree from the index and arms suppression per removed
/// note, so the flurry of child Remove events disk-verifies as gone and is
/// swallowed.
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
        let mut g = notebook_lock(&state);
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
    let mut g = notebook_lock(&state);
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
    let mut g = notebook_lock(&state);
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
        let mut g = notebook_lock(&state);
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
    let mut g = notebook_lock(&state);
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
pub async fn reveal_note(path: String, app: AppHandle, state: State<'_, AppState>) -> Result<()> {
    use tauri_plugin_opener::OpenerExt;
    let root = {
        let g = notebook_lock(&state);
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
        let mut g = notebook_lock(&state);
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
        let g = notebook_lock(&state);
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
        let g = notebook_lock(&state);
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
    use crate::state::{AppState, NotebookState};
    use std::collections::HashMap;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};
    use tauri::Manager;

    static HARNESS_SEQ: AtomicU64 = AtomicU64::new(0);

    /// A real `AppState` holding a scanned temp notebook, inside Tauri's mock
    /// app so commands can take `State<'_, AppState>`. The watcher is
    /// deliberately NOT started (load goes through begin/finish_load, not
    /// `open_notebook`): these tests are about the command layer's own
    /// disk→state protocol, and a watcher thread would race the assertions.
    ///
    /// Commands that take `app: AppHandle` (= `AppHandle<Wry>`) are NOT callable
    /// here — the mock app hands out an `AppHandle<MockRuntime>`. Covering
    /// `move_note`/`retitle_note`/`delete_folder` needs those commands made
    /// generic over `R: tauri::Runtime`, which is a production change.
    struct Harness {
        app: tauri::App<tauri::test::MockRuntime>,
        root: PathBuf,
    }

    impl Harness {
        fn new(label: &str, files: &[(&str, &str)]) -> Self {
            let n = HARNESS_SEQ.fetch_add(1, Ordering::Relaxed);
            let root = std::env::temp_dir()
                .join(format!("noteside-cmd-{label}-{}-{n}", std::process::id()));
            let _ = std::fs::remove_dir_all(&root);
            std::fs::create_dir_all(&root).unwrap();
            for (rel, body) in files {
                let abs = root.join(rel);
                std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
                std::fs::write(&abs, body).unwrap();
            }
            let root = std::fs::canonicalize(&root).unwrap();
            let app = tauri::test::mock_app();
            app.manage(AppState::default());
            let scan = crate::notebook::scan_notebook(&root).unwrap();
            {
                let state = app.state::<AppState>();
                let mut g = super::notebook_lock(&state);
                let token = g.begin_load();
                g.finish_load(
                    token,
                    root.clone(),
                    scan.records,
                    scan.folders,
                    HashMap::new(),
                )
                .unwrap();
            }
            Harness { app, root }
        }

        fn state(&self) -> tauri::State<'_, AppState> {
            self.app.state::<AppState>()
        }

        fn read(&self, rel: &str) -> String {
            std::fs::read_to_string(self.root.join(rel)).unwrap()
        }

        fn exists(&self, rel: &str) -> bool {
            self.root.join(rel).exists()
        }

        fn ids(&self) -> Vec<String> {
            let state = self.state();
            let g = super::notebook_lock(&state);
            g.records.iter().map(|r| r.meta.path.clone()).collect()
        }

        fn has_folder(&self, rel: &str) -> bool {
            let state = self.state();
            let g = super::notebook_lock(&state);
            g.has_folder(rel)
        }

        /// Simulate a notebook switch: a newer load wins, pointing at a
        /// different (empty) root, so the old generation is stale.
        fn swap_notebook(&self) {
            let other = self.root.parent().unwrap().join(format!(
                "{}-other",
                self.root.file_name().unwrap().to_string_lossy()
            ));
            std::fs::create_dir_all(&other).unwrap();
            let other = std::fs::canonicalize(&other).unwrap();
            let state = self.state();
            let mut g = super::notebook_lock(&state);
            let token = g.begin_load();
            g.finish_load(token, other, vec![], vec![], HashMap::new())
                .unwrap();
        }
    }

    impl Drop for Harness {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
            let other = self.root.parent().unwrap().join(format!(
                "{}-other",
                self.root.file_name().unwrap().to_string_lossy()
            ));
            let _ = std::fs::remove_dir_all(other);
        }
    }

    fn block_on<F: std::future::Future>(f: F) -> F::Output {
        tauri::async_runtime::block_on(f)
    }

    #[test]
    fn create_note_lands_in_the_root_or_the_folder_and_registers_it() {
        block_on(async {
            let h = Harness::new("create", &[]);
            let meta = super::create_note(Some("Hello World".into()), None, h.state())
                .await
                .unwrap();
            assert_eq!(meta.path, "hello-world.md");
            assert_eq!(h.read("hello-world.md"), "# Hello World\n\n");
            assert!(h.ids().contains(&"hello-world.md".to_string()));

            // No title => "Untitled"; a dir that does not exist yet is created
            // and registered (with its ancestors) in the folder list.
            let meta = super::create_note(None, Some("work".into()), h.state())
                .await
                .unwrap();
            assert_eq!(meta.path, "work/untitled.md");
            assert_eq!(h.read("work/untitled.md"), "# Untitled\n\n");
            assert!(h.has_folder("work"));
        });
    }

    #[test]
    fn create_note_twice_with_the_same_title_gets_a_numbered_sibling() {
        block_on(async {
            let h = Harness::new("create-collide", &[]);
            let a = super::create_note(Some("Notes".into()), None, h.state())
                .await
                .unwrap();
            let b = super::create_note(Some("Notes".into()), None, h.state())
                .await
                .unwrap();
            let c = super::create_note(Some("Notes".into()), None, h.state())
                .await
                .unwrap();
            // candidate_note_path: n == 1 is bare, n >= 2 gets "-{n}".
            assert_eq!(a.path, "notes.md");
            assert_eq!(b.path, "notes-2.md");
            assert_eq!(c.path, "notes-3.md");
            assert!(h.exists("notes.md") && h.exists("notes-2.md") && h.exists("notes-3.md"));
        });
    }

    #[test]
    fn save_note_rejects_paths_outside_the_notebook() {
        block_on(async {
            let h = Harness::new("escape", &[("a.md", "# A\n")]);
            for bad in ["../x.md", "/etc/x.md", ".hidden/x.md"] {
                assert!(
                    super::save_note(bad.into(), "pwned".into(), h.state())
                        .await
                        .is_err(),
                    "{bad} should be rejected"
                );
            }
            assert!(!h.exists("../x.md"));
            assert!(!h.exists(".hidden/x.md"));
            // The legitimate neighbour is untouched.
            assert_eq!(h.read("a.md"), "# A\n");
        });
    }

    #[test]
    fn set_note_pinned_is_idempotent_and_round_trips_bytes() {
        block_on(async {
            let seed = "# A\n\nbody\n";
            let h = Harness::new("pin", &[("a.md", seed)]);
            let meta = super::set_note_pinned("a.md".into(), true, h.state())
                .await
                .unwrap();
            assert!(meta.pinned);
            let pinned_bytes = h.read("a.md");
            assert!(
                pinned_bytes.starts_with("---\npinned: true\n---\n"),
                "got {pinned_bytes:?}"
            );
            let mtime = crate::notebook::mtime_millis(&h.root.join("a.md"));

            // Sleep so a redundant write would move the ms-resolution mtime —
            // without it the assertion could pass vacuously.
            std::thread::sleep(std::time::Duration::from_millis(10));
            super::set_note_pinned("a.md".into(), true, h.state())
                .await
                .unwrap();
            assert_eq!(
                h.read("a.md"),
                pinned_bytes,
                "a redundant pin rewrote bytes"
            );
            assert_eq!(
                crate::notebook::mtime_millis(&h.root.join("a.md")),
                mtime,
                "a redundant pin bumped mtime (which IS the sidebar sort key)"
            );

            // Unpin removes the key and the block it emptied: byte-identical.
            super::set_note_pinned("a.md".into(), false, h.state())
                .await
                .unwrap();
            assert_eq!(h.read("a.md"), seed);
        });
    }

    #[test]
    fn delete_note_is_idempotent_and_updates_the_index() {
        block_on(async {
            let h = Harness::new("delete", &[("a.md", "# A\n"), ("b.md", "# B\n")]);
            super::delete_note("a.md".into(), h.state()).await.unwrap();
            assert!(!h.exists("a.md"));
            assert_eq!(h.ids(), vec!["b.md".to_string()]);
            // Already gone: idempotent success, not an error.
            super::delete_note("a.md".into(), h.state()).await.unwrap();
            assert_eq!(h.ids(), vec!["b.md".to_string()]);
        });
    }

    #[test]
    fn create_folder_is_idempotent_and_nested_segments_register() {
        block_on(async {
            let h = Harness::new("mkdir", &[]);
            let rel = super::create_folder("work/projects".into(), h.state())
                .await
                .unwrap();
            assert_eq!(rel, "work/projects");
            assert!(h.root.join("work/projects").is_dir());
            assert!(h.has_folder("work"), "ancestors register too");
            assert!(h.has_folder("work/projects"));
            // Existing folder is an idempotent success.
            let again = super::create_folder("work/projects".into(), h.state())
                .await
                .unwrap();
            assert_eq!(again, "work/projects");
        });
    }

    #[test]
    fn folder_contents_of_counts_the_walk() {
        block_on(async {
            let h = Harness::new(
                "walk",
                &[
                    ("work/a.md", "# A\n"),
                    ("work/img.png", "notpng"),
                    ("work/sub/b.md", "# B\n"),
                ],
            );
            let got = super::folder_contents_of("work".into(), h.state())
                .await
                .unwrap();
            assert_eq!(
                got,
                crate::models::FolderContents {
                    notes: 2,
                    other_files: 1,
                    dirs: 1
                }
            );
        });
    }

    #[test]
    fn commands_never_write_to_a_notebook_that_was_switched_away() {
        block_on(async {
            let seed = "# A\n\nbody\n";
            let h = Harness::new("switched", &[("a.md", seed)]);
            h.swap_notebook();

            // Every command now resolves against the NEW (empty) root, so none
            // of them may touch the old notebook's file. `set_note_pinned`
            // reads fresh from disk and fails; `delete_note` is idempotent on a
            // missing target; `save_note` writes into the NEW notebook. What
            // matters for the old notebook is that its bytes never move.
            let _ = super::save_note("a.md".into(), "pwned".into(), h.state()).await;
            let _ = super::set_note_pinned("a.md".into(), true, h.state()).await;
            let _ = super::delete_note("a.md".into(), h.state()).await;

            assert!(h.exists("a.md"), "the old notebook's note was deleted");
            assert_eq!(
                h.read("a.md"),
                seed,
                "the old notebook's note was rewritten"
            );
        });
    }

    #[test]
    fn list_notes_and_list_folders_report_the_loaded_scan() {
        block_on(async {
            let h = Harness::new(
                "list",
                &[("b.md", "# B\n"), ("work/a.md", "# A\n"), ("z.md", "# Z\n")],
            );
            let notes = super::list_notes(h.state()).await.unwrap();
            let mut ids: Vec<&str> = notes.iter().map(|m| m.path.as_str()).collect();
            ids.sort_unstable();
            assert_eq!(ids, vec!["b.md", "work/a.md", "z.md"]);
            let folders = super::list_folders(h.state()).await.unwrap();
            assert_eq!(folders, vec!["work".to_string()]);
        });
    }

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

    #[test]
    fn folder_contents_counts_notes_other_files_and_dirs() {
        let n = std::process::id();
        let dir = std::env::temp_dir().join(format!("noteside-folder-contents-{n}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("sub/deeper")).unwrap();
        std::fs::write(dir.join("a.md"), "# a").unwrap();
        std::fs::write(dir.join("sub/b.md"), "# b").unwrap();
        std::fs::write(dir.join("sub/deeper/shot.png"), [0u8; 4]).unwrap();
        std::fs::write(dir.join(".hidden"), "x").unwrap();
        let got = super::folder_contents(&dir).unwrap();
        assert_eq!(
            got,
            crate::models::FolderContents {
                notes: 2,
                other_files: 2,
                dirs: 2
            }
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn notebook_lock_recovers_from_a_poisoned_mutex() {
        use crate::state::AppState;
        let state = std::sync::Arc::new(AppState::default());
        let poisoner = std::sync::Arc::clone(&state);
        let _ = std::thread::spawn(move || {
            let _g = poisoner.notebook.lock().unwrap();
            panic!("poison on purpose");
        })
        .join();
        assert!(
            state.notebook.lock().is_err(),
            "precondition: the mutex is poisoned"
        );
        // The helper hands back the inner state instead of propagating the poison.
        let g = super::notebook_lock(&state);
        assert!(g.root.is_none());
    }
}
