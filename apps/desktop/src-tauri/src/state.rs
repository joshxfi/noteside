use std::path::PathBuf;
use std::sync::Mutex;

use crate::vault::NoteRecord;

/// The open vault plus its in-memory index (rebuilt from files on open and kept
/// in sync on save / external change). For v1's target scale (1–5k notes) this
/// is faster and simpler than a SQLite/FTS5 index; the search module is the seam
/// to swap in FTS5 for 10k+ vaults later.
#[derive(Default)]
pub struct VaultState {
    pub root: Option<PathBuf>,
    pub records: Vec<NoteRecord>,
}

#[derive(Default)]
pub struct AppState {
    pub vault: Mutex<VaultState>,
}
