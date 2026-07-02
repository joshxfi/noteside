use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::event::{EventKind, ModifyKind};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use notify_debouncer_full::{
    new_debouncer, DebounceEventResult, DebouncedEvent, Debouncer, FileIdMap,
};
use tauri::{AppHandle, Emitter};

use crate::notebook::{self, NoteRecord};
use crate::state::NotebookState;

/// A per-path change a debounced batch unambiguously describes.
enum PathChange {
    Upsert(PathBuf),
    Remove(PathBuf),
}

/// How to refresh the index for a debounced batch: read just the changed paths,
/// or (whenever anything is ambiguous) rescan the whole notebook.
enum Refresh {
    Targeted(Vec<(String, Option<NoteRecord>)>),
    Full(Vec<Arc<NoteRecord>>),
}

/// Map a debounced batch to targeted per-path changes, or `None` when only a
/// full rescan is safe: renames (surface with unreliable paths), multi-path
/// events, non-`.md` paths mixed in, and unknown event kinds.
fn classify_events(events: &[DebouncedEvent]) -> Option<Vec<PathChange>> {
    let mut changes = Vec::with_capacity(events.len());
    for e in events {
        if e.paths
            .iter()
            .any(|p| p.extension().and_then(|x| x.to_str()) != Some("md"))
        {
            return None;
        }
        let [path] = e.paths.as_slice() else {
            return None;
        };
        match e.kind {
            EventKind::Create(_) => changes.push(PathChange::Upsert(path.clone())),
            EventKind::Modify(ModifyKind::Name(_)) => return None,
            EventKind::Modify(_) => changes.push(PathChange::Upsert(path.clone())),
            EventKind::Remove(_) => changes.push(PathChange::Remove(path.clone())),
            _ => return None,
        }
    }
    Some(changes)
}

/// True if any normal component of `path` is dot-prefixed — such paths are
/// skipped by `scan_notebook`, so a targeted update must skip them too.
fn has_hidden_component(path: &Path) -> bool {
    path.components().any(
        |c| matches!(c, Component::Normal(n) if n.to_str().is_some_and(|s| s.starts_with('.'))),
    )
}

/// Read the targeted paths into upsert/remove entries mirroring exactly what a
/// full rescan would record for them. `None` (any surprise: path outside the
/// root, non-UTF-8 name, read error, a "removed" file that still exists) makes
/// the caller fall back to the full rescan.
fn targeted_updates(
    root: &Path,
    changes: &[PathChange],
) -> Option<Vec<(String, Option<NoteRecord>)>> {
    // A dot-component in the root itself changes what the walk yields; keep
    // that (unusual) layout on the well-tested full-rescan path.
    if has_hidden_component(root) {
        return None;
    }
    let mut out = Vec::with_capacity(changes.len());
    for c in changes {
        let abs = match c {
            PathChange::Upsert(p) | PathChange::Remove(p) => p.as_path(),
        };
        let rel = abs.strip_prefix(root).ok()?;
        if rel
            .components()
            .any(|comp| !matches!(comp, Component::Normal(n) if n.to_str().is_some()))
        {
            return None;
        }
        if has_hidden_component(rel) {
            continue; // the scanner never indexes these; nothing to update
        }
        let key = notebook::rel_path(root, abs);
        match c {
            PathChange::Upsert(_) => match notebook::read_record(root, abs) {
                Ok(rec) => out.push((key, Some(rec))),
                Err(_) => return None,
            },
            PathChange::Remove(_) => {
                if abs.exists() {
                    return None; // removed and recreated within the debounce window
                }
                out.push((key, None));
            }
        }
    }
    Some(out)
}

/// Watch the notebook folder for external changes (other editors, git, sync). On a
/// debounced change to any `.md` file, refresh the in-memory index — reading just
/// the reported paths when the batch is unambiguous, rebuilding it whole otherwise —
/// and notify the frontend via the `notebook:changed` event. Our own writes are
/// skipped via `suppress_until`.
pub fn start_watcher(
    app: AppHandle,
    notebook: Arc<Mutex<NotebookState>>,
    root: PathBuf,
) -> notify::Result<Debouncer<RecommendedWatcher, FileIdMap>> {
    let mut debouncer = new_debouncer(
        Duration::from_millis(400),
        None,
        move |result: DebounceEventResult| {
            let Ok(events) = result else { return };
            let touches_md = events.iter().any(|e| {
                e.paths
                    .iter()
                    .any(|p| p.extension().and_then(|x| x.to_str()) == Some("md"))
            });
            if !touches_md {
                return;
            }
            let r = {
                let g = match notebook.lock() {
                    Ok(g) => g,
                    Err(_) => return,
                };
                if g.should_ignore_event(Instant::now()) {
                    return; // echo of our own write
                }
                let Some(r) = g.root.clone() else { return };
                r
            };
            // Disk I/O stays outside the lock, exactly like the full rescan.
            let refresh = match classify_events(&events).and_then(|c| targeted_updates(&r, &c)) {
                Some(updates) => Refresh::Targeted(updates),
                None => Refresh::Full(notebook::scan_notebook(&r)),
            };
            let mut g = match notebook.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            if g.root.as_ref() != Some(&r) {
                return; // notebook switched while the refresh was running
            }
            match refresh {
                Refresh::Targeted(updates) => g.apply_external(updates),
                Refresh::Full(records) => g.set_records(records),
            }
            drop(g);
            let _ = app.emit("notebook:changed", ());
        },
    )?;
    debouncer.watcher().watch(&root, RecursiveMode::Recursive)?;
    Ok(debouncer)
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{CreateKind, DataChange, RemoveKind, RenameMode};
    use notify::Event;

    fn ev(kind: EventKind, paths: &[&Path]) -> DebouncedEvent {
        let mut e = Event::new(kind);
        for p in paths {
            e = e.add_path(p.to_path_buf());
        }
        DebouncedEvent::new(e, Instant::now())
    }

    #[test]
    fn classify_maps_create_modify_remove_and_rejects_the_rest() {
        let a = Path::new("/nb/a.md");
        let got = classify_events(&[
            ev(EventKind::Create(CreateKind::File), &[a]),
            ev(
                EventKind::Modify(ModifyKind::Data(DataChange::Content)),
                &[a],
            ),
            ev(EventKind::Remove(RemoveKind::File), &[a]),
        ])
        .unwrap();
        assert!(matches!(got[0], PathChange::Upsert(_)));
        assert!(matches!(got[1], PathChange::Upsert(_)));
        assert!(matches!(got[2], PathChange::Remove(_)));

        // rename → full rescan
        assert!(classify_events(&[ev(
            EventKind::Modify(ModifyKind::Name(RenameMode::Any)),
            &[a]
        )])
        .is_none());
        // unknown kind → full rescan
        assert!(classify_events(&[ev(EventKind::Any, &[a])]).is_none());
        // a non-.md path mixed in → full rescan
        assert!(classify_events(&[
            ev(EventKind::Create(CreateKind::File), &[a]),
            ev(
                EventKind::Create(CreateKind::File),
                &[Path::new("/nb/x.tmp")]
            ),
        ])
        .is_none());
        // multi-path event → full rescan
        assert!(classify_events(&[ev(
            EventKind::Create(CreateKind::File),
            &[a, Path::new("/nb/b.md")]
        )])
        .is_none());
    }

    #[test]
    fn targeted_updates_reads_upserts_and_confirms_removes() {
        let dir = std::env::temp_dir().join(format!("noteside-watch-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("a.md"), "# Alpha\nbody").unwrap();
        std::fs::write(dir.join("sub/b.md"), "# Beta").unwrap();

        let got = targeted_updates(
            &dir,
            &[
                PathChange::Upsert(dir.join("a.md")),
                PathChange::Upsert(dir.join("sub/b.md")),
                PathChange::Remove(dir.join("gone.md")),
            ],
        )
        .unwrap();
        assert_eq!(got.len(), 3);
        assert_eq!(got[0].0, "a.md");
        assert_eq!(got[0].1.as_ref().unwrap().meta.title, "Alpha");
        assert_eq!(got[1].0, "sub/b.md");
        assert!(got[2].1.is_none());

        // upsert of a missing file → error → full rescan
        assert!(targeted_updates(&dir, &[PathChange::Upsert(dir.join("nope.md"))]).is_none());
        // "removed" file that exists on disk → full rescan
        assert!(targeted_updates(&dir, &[PathChange::Remove(dir.join("a.md"))]).is_none());
        // path outside the root → full rescan
        assert!(targeted_updates(
            &dir,
            &[PathChange::Upsert(PathBuf::from("/elsewhere/x.md"))]
        )
        .is_none());
        // hidden path → skipped, not indexed (mirrors the scanner)
        let hidden = targeted_updates(&dir, &[PathChange::Upsert(dir.join(".git/x.md"))]).unwrap();
        assert!(hidden.is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
