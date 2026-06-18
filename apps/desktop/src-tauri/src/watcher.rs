use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, FileIdMap};
use tauri::{AppHandle, Emitter};

use crate::notebook;
use crate::state::NotebookState;

/// Watch the notebook folder for external changes (other editors, git, sync). On a
/// debounced change to any `.md` file, rebuild the in-memory index and notify
/// the frontend via the `notebook:changed` event. Our own writes are skipped via
/// `suppress_until`.
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
            let records = notebook::scan_notebook(&r);
            let mut g = match notebook.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            if g.root.as_ref() != Some(&r) {
                return; // notebook switched while the rescan was running
            }
            g.set_records(records);
            drop(g);
            let _ = app.emit("notebook:changed", ());
        },
    )?;
    debouncer.watcher().watch(&root, RecursiveMode::Recursive)?;
    Ok(debouncer)
}
