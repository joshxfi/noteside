use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, FileIdMap};
use tauri::{AppHandle, Emitter};

use crate::state::VaultState;
use crate::vault;

/// Watch the vault folder for external changes (other editors, git, sync). On a
/// debounced change to any `.md` file, rebuild the in-memory index and notify
/// the frontend via the `vault:changed` event. Our own writes are skipped via
/// `suppress_until`.
pub fn start_watcher(
    app: AppHandle,
    vault: Arc<Mutex<VaultState>>,
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
            let mut g = match vault.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            if let Some(until) = g.suppress_until {
                if Instant::now() < until {
                    return; // echo of our own write
                }
            }
            let Some(r) = g.root.clone() else { return };
            g.records = vault::scan_vault(&r);
            drop(g);
            let _ = app.emit("vault:changed", ());
        },
    )?;
    debouncer.watcher().watch(&root, RecursiveMode::Recursive)?;
    Ok(debouncer)
}
