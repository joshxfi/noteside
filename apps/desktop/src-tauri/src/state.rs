use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use notify::RecommendedWatcher;
use notify_debouncer_full::{Debouncer, FileIdMap};

use crate::notebook::NoteRecord;

/// The open notebook plus its in-memory index (rebuilt from files on open and kept
/// in sync on save / external change). For v1's target scale (1–5k notes) this
/// is faster and simpler than a SQLite/FTS5 index; the search module is the seam
/// to swap in FTS5 for 10k+ notebooks later.
#[derive(Default)]
pub struct NotebookState {
    pub root: Option<PathBuf>,
    pub records: Vec<NoteRecord>,
    /// While set in the future, watcher events are ignored — this suppresses the
    /// echo from our own atomic writes so they don't trigger a redundant reindex.
    pub suppress_until: Option<Instant>,
}

pub struct AppState {
    pub notebook: Arc<Mutex<NotebookState>>,
    /// Kept alive so the watcher thread keeps running; replaced on notebook switch.
    pub watcher: Mutex<Option<Debouncer<RecommendedWatcher, FileIdMap>>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            notebook: Arc::new(Mutex::new(NotebookState::default())),
            watcher: Mutex::new(None),
        }
    }
}
