use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::event::{EventKind, ModifyKind};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use notify_debouncer_full::{
    new_debouncer, DebounceEventResult, DebouncedEvent, Debouncer, FileIdMap,
};
use tauri::{AppHandle, Emitter};

use crate::notebook::{self, NoteRecord, Scan};
use crate::state::{find_record, NotebookState};

/// A per-path change a debounced batch unambiguously describes.
enum PathChange {
    Upsert(PathBuf),
    Remove(PathBuf),
}

/// How to refresh the index for a debounced batch: read just the changed paths,
/// or (whenever anything is ambiguous) rescan the whole notebook.
enum Refresh {
    Targeted(Vec<(String, Option<NoteRecord>)>),
    Full(Scan),
}

fn compute_refresh(root: &Path, events: Option<&[DebouncedEvent]>) -> std::io::Result<Refresh> {
    if let Some(events) = events {
        if let Some(updates) = classify_events(events).and_then(|c| targeted_updates(root, &c)) {
            return Ok(Refresh::Targeted(updates));
        }
    }
    Ok(Refresh::Full(notebook::scan_notebook(root)?))
}

fn apply_refresh(state: &mut NotebookState, refresh: Refresh) {
    match refresh {
        Refresh::Targeted(updates) => state.apply_external(updates),
        Refresh::Full(scan) => state.set_index(scan.records, scan.folders),
    }
}

/// Refresh outside the state lock and commit only when no newer index mutation
/// raced the disk read. After several collisions, take the rare locked fallback:
/// commands may still write disk concurrently, but their state commit orders
/// after this refresh, so the final index cannot regress to the older snapshot.
fn refresh_current(
    notebook: &Arc<Mutex<NotebookState>>,
    root: &Path,
    generation: u64,
    events: Option<&[DebouncedEvent]>,
) -> bool {
    for _ in 0..3 {
        let revision = {
            let Ok(g) = notebook.lock() else { return false };
            if !g.matches_context(root, generation) {
                return false;
            }
            g.revision()
        };
        let Ok(refresh) = compute_refresh(root, events) else {
            return false; // preserve the current index on any scan/read failure
        };
        let Ok(mut g) = notebook.lock() else {
            return false;
        };
        if !g.matches_context(root, generation) {
            return false;
        }
        if g.revision() != revision {
            continue;
        }
        apply_refresh(&mut g, refresh);
        return true;
    }

    let Ok(mut g) = notebook.lock() else {
        return false;
    };
    if !g.matches_context(root, generation) {
        return false;
    }
    let Ok(refresh) = compute_refresh(root, events) else {
        return false;
    };
    apply_refresh(&mut g, refresh);
    true
}

fn relevant_paths(root: &Path, events: &[DebouncedEvent]) -> Vec<String> {
    let mut paths: Vec<String> = events
        .iter()
        .flat_map(|event| event.paths.iter())
        .filter(|path| path.extension().and_then(|x| x.to_str()) == Some("md"))
        .filter_map(|path| {
            path.strip_prefix(root)
                .ok()
                .map(|_| notebook::rel_path(root, path))
        })
        .collect();
    paths.sort();
    paths.dedup();
    paths
}

/// Non-hidden, under-root, non-`.md` rel paths in a batch — the candidates for
/// the folder-relevance check. Dot-prefixed paths (our own atomic-write temp
/// files included) are excluded, so `.md` echo suppression is untouched, and
/// the root itself (rel "") is never a candidate.
fn folder_candidate_paths(root: &Path, events: &[DebouncedEvent]) -> Vec<String> {
    let mut out: Vec<String> = events
        .iter()
        .flat_map(|event| event.paths.iter())
        .filter(|path| path.extension().and_then(|x| x.to_str()) != Some("md"))
        .filter_map(|path| {
            let rel = path.strip_prefix(root).ok()?;
            if has_hidden_component(rel) {
                return None;
            }
            Some(notebook::rel_path(root, path))
        })
        .filter(|rel| !rel.is_empty())
        .collect();
    out.sort();
    out.dedup();
    out
}

/// True when any probed candidate (rel path, is-dir-on-disk) disagrees with the
/// index: a directory on disk the folder list lacks, or a listed folder (or one
/// with indexed notes under it) that is now gone. Own folder ops commit the
/// list BEFORE their debounced events arrive, so agreement means our own echo
/// — no suppression window needed — while any disagreement forces the full-
/// rescan path (the safe direction). A plain non-`.md` FILE probes as
/// not-a-dir and unknown, i.e. irrelevant.
fn folders_disagree(state: &NotebookState, probes: &[(String, bool)]) -> bool {
    probes.iter().any(|(rel, is_dir)| {
        if *is_dir {
            !state.has_folder(rel)
        } else {
            let prefix = format!("{rel}/");
            state.has_folder(rel)
                || state
                    .records
                    .iter()
                    .any(|r| r.meta.path.starts_with(&prefix))
        }
    })
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
            PathChange::Upsert(_) => {
                // The scanner never follows symlinks (WalkDir's file_type is
                // not a file for them), so a targeted upsert must not index
                // through one either — the record would flip in and out of the
                // index depending on which refresh path ran. Any non-regular-
                // file surprise (symlink, dir, vanished) falls back to the full
                // rescan, which also drops a stale record if a real file was
                // replaced by a symlink.
                match std::fs::symlink_metadata(abs) {
                    Ok(m) if m.is_file() => {}
                    _ => return None,
                }
                match notebook::read_record(root, abs) {
                    Ok(rec) => out.push((key, Some(rec))),
                    Err(_) => return None,
                }
            }
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

/// Verify a suppressed "own write" echo against disk: for an indexed path the
/// file's mtime must still be exactly what our write recorded (`meta.updated`
/// is read right after the write lands); for an unindexed path (our own
/// delete, or a rename's old path) the file must be gone. Any disagreement
/// means an external change landed inside the suppression window — it must be
/// refreshed, not swallowed, or the index (and every command reading it)
/// diverges from disk until some unrelated future event. A same-mtime-tick
/// external write remains invisible; this check shrinks the blind spot from
/// the full 700ms window to one mtime tick.
fn echo_matches_disk(root: &Path, rel: &str, indexed_mtime: Option<i64>) -> bool {
    let abs = root.join(rel);
    match indexed_mtime {
        None => std::fs::symlink_metadata(&abs).is_err(),
        // updated == 0 means the mtime read failed at write time — unverifiable,
        // so treat it as a mismatch and refresh (the safe direction).
        Some(updated) => updated != 0 && notebook::mtime_millis(&abs) == updated,
    }
}

/// Watch the notebook folder for external changes (other editors, git, sync). On a
/// debounced change to any `.md` file, refresh the in-memory index — reading just
/// the reported paths when the batch is unambiguous, rebuilding it whole otherwise —
/// and notify the frontend via the `notebook:changed` event. Our own writes are
/// skipped only when every relevant path is an own-write echo.
pub fn start_watcher(
    app: AppHandle,
    notebook: Arc<Mutex<NotebookState>>,
    root: PathBuf,
    generation: u64,
) -> notify::Result<Debouncer<RecommendedWatcher, FileIdMap>> {
    let watched_root = root.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(400),
        None,
        move |result: DebounceEventResult| {
            let events = match result {
                Ok(events) => events,
                // A backend error (notably event-queue overflow) means we may have
                // missed changes — fall back to a full rescan, exactly like an
                // ambiguous batch. No paths are available here, so skip the .md
                // prefilter and the echo-suppression check and rescan wholesale.
                Err(_) => {
                    if refresh_current(&notebook, &watched_root, generation, None) {
                        let _ = app.emit("notebook:changed", ());
                    }
                    return;
                }
            };
            let paths = relevant_paths(&watched_root, &events);
            let candidates = folder_candidate_paths(&watched_root, &events);
            if paths.is_empty() && candidates.is_empty() {
                return;
            }
            // Probe disk per folder candidate before taking the lock (cheap
            // stats; racy only in the direction of an extra full rescan).
            let probes: Vec<(String, bool)> = candidates
                .into_iter()
                .map(|rel| {
                    let is_dir = std::fs::symlink_metadata(watched_root.join(&rel))
                        .map(|m| m.is_dir())
                        .unwrap_or(false);
                    (rel, is_dir)
                })
                .collect();
            let suppressed = {
                let mut g = match notebook.lock() {
                    Ok(g) => g,
                    Err(_) => return,
                };
                if !g.matches_context(&watched_root, generation) {
                    return;
                }
                if folders_disagree(&g, &probes) {
                    // An external folder change (mkdir/rmdir/mv-dir) — always
                    // refresh, even when every .md path would be suppressed.
                    None
                } else if paths.is_empty() {
                    return; // only irrelevant non-.md noise in the batch
                } else if !g.should_ignore_event(&paths, Instant::now()) {
                    None
                } else {
                    // The time window alone can't tell our echo from an
                    // external write that landed inside it. Snapshot what the
                    // index believes about each suppressed path so the echo can
                    // be verified against disk outside the lock.
                    Some(
                        paths
                            .iter()
                            .map(|p| {
                                let updated =
                                    find_record(&g.records, p).map(|i| g.records[i].meta.updated);
                                (p.clone(), updated)
                            })
                            .collect::<Vec<_>>(),
                    )
                }
            };
            if let Some(expected) = suppressed {
                if expected
                    .iter()
                    .all(|(rel, updated)| echo_matches_disk(&watched_root, rel, *updated))
                {
                    return; // verified echo of our own write
                }
                // Disk disagrees with the index: an external change slipped
                // into the suppression window — fall through and refresh.
            }
            if refresh_current(&notebook, &watched_root, generation, Some(&events)) {
                let _ = app.emit("notebook:changed", ());
            }
        },
    )?;
    debouncer.watcher().watch(&root, RecursiveMode::Recursive)?;
    Ok(debouncer)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::NoteMeta;
    use notify::event::{CreateKind, DataChange, RemoveKind, RenameMode};
    use notify::Event;
    use std::collections::HashMap;

    fn ev(kind: EventKind, paths: &[&Path]) -> DebouncedEvent {
        let mut e = Event::new(kind);
        for p in paths {
            e = e.add_path(p.to_path_buf());
        }
        DebouncedEvent::new(e, Instant::now())
    }

    fn record(path: &str, body: &str) -> Arc<NoteRecord> {
        Arc::new(NoteRecord {
            meta: NoteMeta {
                id: path.into(),
                path: path.into(),
                title: path.trim_end_matches(".md").into(),
                tags: vec![],
                created: None,
                updated: 0,
                pinned: false,
            },
            body: body.into(),
        })
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

    #[test]
    fn echo_verification_compares_disk_mtime_and_absence() {
        let dir = std::env::temp_dir().join(format!("noteside-echo-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.md"), "# A").unwrap();
        let mtime = notebook::mtime_millis(&dir.join("a.md"));

        assert!(echo_matches_disk(&dir, "a.md", Some(mtime))); // our own write's echo
        assert!(!echo_matches_disk(&dir, "a.md", Some(mtime + 1))); // disk moved on — external write
        assert!(!echo_matches_disk(&dir, "a.md", Some(0))); // unverifiable index mtime → refresh
        assert!(!echo_matches_disk(&dir, "a.md", None)); // own delete, but the file EXISTS → recreate
        assert!(echo_matches_disk(&dir, "gone.md", None)); // own delete verified gone
        assert!(!echo_matches_disk(&dir, "gone.md", Some(123))); // indexed but missing → external delete

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn targeted_upsert_of_a_symlink_falls_back_to_full_rescan() {
        let dir =
            std::env::temp_dir().join(format!("noteside-symlink-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("real.md"), "# Real").unwrap();
        std::os::unix::fs::symlink(dir.join("real.md"), dir.join("link.md")).unwrap();
        // The scanner skips symlinks, so the targeted path must not index one.
        assert!(targeted_updates(&dir, &[PathChange::Upsert(dir.join("link.md"))]).is_none());
        // ...while a regular file still upserts fine.
        let ok = targeted_updates(&dir, &[PathChange::Upsert(dir.join("real.md"))]).unwrap();
        assert_eq!(ok.len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn relevant_paths_deduplicates_markdown_and_ignores_other_files() {
        let root = Path::new("/nb");
        let events = [
            ev(
                EventKind::Create(CreateKind::File),
                &[Path::new("/nb/a.md")],
            ),
            ev(
                EventKind::Modify(ModifyKind::Data(DataChange::Content)),
                &[Path::new("/nb/a.md"), Path::new("/nb/a.tmp")],
            ),
        ];
        assert_eq!(relevant_paths(root, &events), vec!["a.md"]);
    }

    #[test]
    fn folder_candidates_skip_md_hidden_outside_and_the_root() {
        let root = Path::new("/nb");
        let events = [
            ev(
                EventKind::Create(CreateKind::Folder),
                &[Path::new("/nb/work")],
            ),
            ev(
                EventKind::Create(CreateKind::File),
                &[Path::new("/nb/a.md")], // .md — never a folder candidate
            ),
            ev(
                EventKind::Create(CreateKind::File),
                &[Path::new("/nb/.a.md.tmp-1-2")], // our temp files are hidden
            ),
            ev(
                EventKind::Create(CreateKind::Folder),
                &[Path::new("/elsewhere/dir")],
            ),
            ev(EventKind::Modify(ModifyKind::Any), &[Path::new("/nb")]),
            ev(
                EventKind::Create(CreateKind::Folder),
                &[Path::new("/nb/work")], // duplicate
            ),
        ];
        assert_eq!(folder_candidate_paths(root, &events), vec!["work"]);
    }

    #[test]
    fn folder_relevance_is_state_aware() {
        let mut state = NotebookState::default();
        let token = state.begin_load();
        state
            .finish_load(
                token,
                PathBuf::from("/nb"),
                vec![record("orphan/n.md", "x")],
                vec!["known".into()],
                HashMap::new(),
            )
            .unwrap();
        // A dir on disk the list already has = our own mkdir echo — irrelevant.
        assert!(!folders_disagree(&state, &[("known".into(), true)]));
        // A dir on disk the list lacks = external mkdir — refresh.
        assert!(folders_disagree(&state, &[("fresh".into(), true)]));
        // Absent but listed = external rmdir — refresh.
        assert!(folders_disagree(&state, &[("known".into(), false)]));
        // Absent, unlisted, but with indexed notes under it — refresh.
        assert!(folders_disagree(&state, &[("orphan".into(), false)]));
        // A stray non-.md FILE (probes as not-a-dir, unknown) — irrelevant.
        assert!(!folders_disagree(&state, &[("notes.txt".into(), false)]));
        // A mixed batch where one candidate disagrees — refresh.
        assert!(folders_disagree(
            &state,
            &[("known".into(), true), ("fresh".into(), true)]
        ));
    }

    #[test]
    fn failed_full_refresh_preserves_the_existing_index() {
        let root = std::env::temp_dir().join(format!(
            "noteside-watch-error-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("invalid.md"), [0xff]).unwrap();
        let mut state = NotebookState::default();
        let token = state.begin_load();
        let generation = state
            .finish_load(
                token,
                root.clone(),
                vec![record("kept.md", "kept")],
                vec![],
                HashMap::new(),
            )
            .unwrap();
        let state = Arc::new(Mutex::new(state));
        assert!(!refresh_current(&state, &root, generation, None));
        assert_eq!(state.lock().unwrap().records[0].meta.path, "kept.md");
        let _ = std::fs::remove_dir_all(root);
    }
}
