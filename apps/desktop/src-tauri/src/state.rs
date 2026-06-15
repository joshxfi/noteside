use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use notify::RecommendedWatcher;
use notify_debouncer_full::{Debouncer, FileIdMap};

use crate::vault::NoteRecord;

/// The open vault plus its in-memory index (rebuilt from files on open and kept
/// in sync on save / external change). For v1's target scale (1–5k notes) this
/// is faster and simpler than a SQLite/FTS5 index; the search module is the seam
/// to swap in FTS5 for 10k+ vaults later.
#[derive(Default)]
pub struct VaultState {
    pub root: Option<PathBuf>,
    pub records: Vec<NoteRecord>,
    /// While set in the future, watcher events are ignored — this suppresses the
    /// echo from our own atomic writes so they don't trigger a redundant reindex.
    pub suppress_until: Option<Instant>,
}

pub struct AppState {
    pub vault: Arc<Mutex<VaultState>>,
    /// Kept alive so the watcher thread keeps running; replaced on vault switch.
    pub watcher: Mutex<Option<Debouncer<RecommendedWatcher, FileIdMap>>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            vault: Arc::new(Mutex::new(VaultState::default())),
            watcher: Mutex::new(None),
        }
    }
}
