use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::RecommendedWatcher;
use notify_debouncer_full::{Debouncer, FileIdMap};

use crate::models::NoteMeta;
use crate::notebook::NoteRecord;

/// After our own write/delete, watcher events within this window are treated as
/// the echo of that write (not an external change) and ignored.
const SUPPRESS: Duration = Duration::from_millis(700);

/// Update in place when the path is already indexed, otherwise insert at the
/// path-sorted position: `scan_notebook` returns path-sorted records, and every
/// in-place mutation must preserve that order so wikilink resolution's
/// first-record tie-break stays deterministic.
fn upsert_sorted(records: &mut Vec<NoteRecord>, rec: NoteRecord) {
    if let Some(existing) = records.iter_mut().find(|r| r.meta.path == rec.meta.path) {
        *existing = rec;
    } else {
        let at = records.partition_point(|r| r.meta.path < rec.meta.path);
        records.insert(at, rec);
    }
}

/// The open notebook plus its in-memory index (rebuilt from files on open and kept
/// in sync on save / external change). Plain in-memory structures are faster and
/// simpler than a database here, and stay fast at any realistic notebook size.
///
/// The "did we cause this watcher event?" protocol lives entirely on this type:
/// the mutating commands call `record_own_write`/`record_own_delete` (which also
/// arm the window), and the watcher asks `should_ignore_event` — so the window
/// constant and the arm/check pair have a single owner instead of being split
/// between `commands.rs` and `watcher.rs`.
#[derive(Default)]
pub struct NotebookState {
    pub root: Option<PathBuf>,
    pub records: Arc<Vec<NoteRecord>>,
    /// When set, watcher events before this instant are echoes of our own write.
    /// Owned by the methods below — never set or read directly.
    suppress_until: Option<Instant>,
}

impl NotebookState {
    /// Install a freshly-scanned notebook, clearing any pending suppression
    /// (a fresh open is never an echo of a previous write).
    pub fn load(&mut self, root: PathBuf, records: Vec<NoteRecord>) {
        self.root = Some(root);
        self.records = Arc::new(records);
        self.suppress_until = None;
    }

    /// Replace the index after an external change (the watcher's rescan).
    pub fn set_records(&mut self, records: Vec<NoteRecord>) {
        self.records = Arc::new(records);
    }

    /// Apply targeted external changes from the watcher without a full rescan:
    /// `Some(record)` upserts (new paths at their path-sorted position, since
    /// scan output is path-sorted), `None` removes. Ends in the same state a
    /// full rescan would have produced for those paths.
    pub fn apply_external(&mut self, updates: Vec<(String, Option<NoteRecord>)>) {
        let records = Arc::make_mut(&mut self.records);
        for (path, rec) in updates {
            match rec {
                Some(rec) => upsert_sorted(records, rec),
                None => records.retain(|r| r.meta.path != path),
            }
        }
    }

    /// Record our own write: upsert the record (existing paths in place, new
    /// paths path-sorted) and arm the echo-suppression window from `now`.
    pub fn record_own_write(&mut self, meta: NoteMeta, body: String, now: Instant) {
        let records = Arc::make_mut(&mut self.records);
        upsert_sorted(records, NoteRecord { meta, body });
        self.suppress_until = Some(now + SUPPRESS);
    }

    /// Record our own rename: drop the old-path record, upsert the new-path record
    /// (with refreshed meta + body), and arm the echo-suppression window so the
    /// watcher ignores the move (which surfaces as a delete + create).
    pub fn record_own_rename(
        &mut self,
        old_path: &str,
        meta: NoteMeta,
        body: String,
        now: Instant,
    ) {
        let records = Arc::make_mut(&mut self.records);
        records.retain(|r| r.meta.path != old_path);
        upsert_sorted(records, NoteRecord { meta, body });
        self.suppress_until = Some(now + SUPPRESS);
    }

    /// Record our own delete: drop the record and arm the suppression window.
    pub fn record_own_delete(&mut self, path: &str, now: Instant) {
        let records = Arc::make_mut(&mut self.records);
        records.retain(|r| r.meta.path != path);
        self.suppress_until = Some(now + SUPPRESS);
    }

    /// True if a watcher event observed at `now` falls inside the suppression
    /// window — i.e. it's the echo of our own atomic write and should be ignored.
    pub fn should_ignore_event(&self, now: Instant) -> bool {
        matches!(self.suppress_until, Some(until) if now < until)
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn meta(path: &str) -> NoteMeta {
        NoteMeta {
            id: path.to_string(),
            path: path.to_string(),
            title: path.trim_end_matches(".md").to_string(),
            tags: vec![],
            created: None,
            updated: 0,
            pinned: false,
        }
    }
    fn rec(path: &str, body: &str) -> NoteRecord {
        NoteRecord {
            meta: meta(path),
            body: body.to_string(),
        }
    }

    #[test]
    fn ignores_events_inside_the_suppression_window() {
        let mut s = NotebookState::default();
        let t0 = Instant::now();
        s.record_own_write(meta("a.md"), "x".to_string(), t0);
        assert!(s.should_ignore_event(t0));
        assert!(s.should_ignore_event(t0 + Duration::from_millis(699)));
    }

    #[test]
    fn allows_events_after_the_window() {
        let mut s = NotebookState::default();
        let t0 = Instant::now();
        s.record_own_delete("a.md", t0);
        assert!(!s.should_ignore_event(t0 + Duration::from_millis(700)));
        assert!(!s.should_ignore_event(t0 + Duration::from_millis(5000)));
    }

    #[test]
    fn no_write_means_no_suppression() {
        let s = NotebookState::default();
        assert!(!s.should_ignore_event(Instant::now()));
    }

    #[test]
    fn load_clears_a_pending_suppression() {
        let mut s = NotebookState::default();
        let t0 = Instant::now();
        s.record_own_write(meta("a.md"), "x".to_string(), t0);
        assert!(s.should_ignore_event(t0));
        s.load(PathBuf::from("/nb"), vec![rec("a.md", "x")]);
        assert!(!s.should_ignore_event(t0)); // a fresh open is not our echo
        assert_eq!(s.root, Some(PathBuf::from("/nb")));
        assert_eq!(s.records.len(), 1);
    }

    #[test]
    fn record_own_write_inserts_then_updates_in_place() {
        let mut s = NotebookState::default();
        let t0 = Instant::now();
        s.record_own_write(meta("a.md"), "v1".to_string(), t0);
        assert_eq!(s.records.len(), 1);
        assert_eq!(s.records[0].body, "v1");
        s.record_own_write(meta("a.md"), "v2".to_string(), t0);
        assert_eq!(
            s.records.len(),
            1,
            "same path updates in place, no new record"
        );
        assert_eq!(s.records[0].body, "v2");
    }

    #[test]
    fn own_writes_and_renames_keep_records_path_sorted() {
        let mut s = NotebookState::default();
        let t0 = Instant::now();
        s.load(
            PathBuf::from("/nb"),
            vec![rec("a.md", "1"), rec("z.md", "2")],
        );
        s.record_own_write(meta("m.md"), "created".to_string(), t0); // new note
        s.record_own_rename("m.md", meta("b.md"), "created".to_string(), t0);
        s.apply_external(vec![("c.md".to_string(), Some(rec("c.md", "external")))]);
        let paths: Vec<&str> = s.records.iter().map(|r| r.meta.path.as_str()).collect();
        assert_eq!(paths, vec!["a.md", "b.md", "c.md", "z.md"]);
        assert_eq!(s.records[1].body, "created");
    }

    #[test]
    fn apply_external_upserts_sorted_and_removes_without_arming_suppression() {
        let mut s = NotebookState::default();
        s.load(
            PathBuf::from("/nb"),
            vec![rec("a.md", "1"), rec("m.md", "2"), rec("z.md", "3")],
        );
        s.apply_external(vec![
            ("m.md".to_string(), Some(rec("m.md", "2-updated"))), // in place
            ("c.md".to_string(), Some(rec("c.md", "new"))),       // sorted insert
            ("z.md".to_string(), None),                           // remove
        ]);
        let paths: Vec<&str> = s.records.iter().map(|r| r.meta.path.as_str()).collect();
        assert_eq!(paths, vec!["a.md", "c.md", "m.md"]);
        assert_eq!(s.records[2].body, "2-updated");
        // External changes are not our own writes — no echo suppression.
        assert!(!s.should_ignore_event(Instant::now()));
    }

    #[test]
    fn record_own_delete_drops_the_record_and_arms_suppression() {
        let mut s = NotebookState::default();
        let t0 = Instant::now();
        s.load(
            PathBuf::from("/nb"),
            vec![rec("a.md", "x"), rec("b.md", "y")],
        );
        s.record_own_delete("a.md", t0);
        assert_eq!(s.records.len(), 1);
        assert_eq!(s.records[0].meta.path, "b.md");
        assert!(s.should_ignore_event(t0));
    }
}
