use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::RecommendedWatcher;
use notify_debouncer_full::{Debouncer, FileIdMap};

use crate::frecency::FrecencyEntry;
use crate::models::NoteMeta;
use crate::notebook::NoteRecord;

/// After our own write/delete, watcher events within this window are treated as
/// the echo of that write (not an external change) and ignored.
const SUPPRESS: Duration = Duration::from_millis(700);

/// Binary search over the path-sorted records — the invariant `scan_notebook`'s
/// sort and `upsert_sorted` maintain. `Err` carries the path-sorted insertion
/// slot, so lookups and inserts share this one definition of the order.
fn search_by_path(records: &[Arc<NoteRecord>], path: &str) -> std::result::Result<usize, usize> {
    records.binary_search_by(|r| r.meta.path.as_str().cmp(path))
}

/// Index of the record at `path`, in O(log N).
pub fn find_record(records: &[Arc<NoteRecord>], path: &str) -> Option<usize> {
    search_by_path(records, path).ok()
}

/// Replace the record at the same path, or insert at the path-sorted position:
/// `scan_notebook` returns path-sorted records, and every in-place mutation must
/// preserve that order (wikilink resolution's first-record tie-break, and the
/// binary searches above, depend on it). The record is freshly `Arc`-wrapped —
/// never mutated through an existing `Arc` — so live search snapshots keep
/// their exact data.
fn upsert_sorted(records: &mut Vec<Arc<NoteRecord>>, rec: NoteRecord) {
    let rec = Arc::new(rec);
    match search_by_path(records, &rec.meta.path) {
        Ok(i) => records[i] = rec,
        Err(at) => records.insert(at, rec),
    }
}

/// Drop the record at `path`, if indexed.
fn remove_by_path(records: &mut Vec<Arc<NoteRecord>>, path: &str) {
    if let Ok(i) = search_by_path(records, path) {
        records.remove(i);
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
    /// Two `Arc` layers: searches snapshot the outer Arc and run off the lock,
    /// while mutations `Arc::make_mut` the outer Vec — with a snapshot live
    /// that copies N pointers, not note bodies — and swap in freshly built
    /// records. Kept path-sorted (see `upsert_sorted`).
    pub records: Arc<Vec<Arc<NoteRecord>>>,
    /// Per-note open-frecency, keyed by notebook-relative path. Loaded with the
    /// notebook and snapshotted by search the same way `records` is.
    pub frecency: Arc<HashMap<String, FrecencyEntry>>,
    /// When set, watcher events before this instant are echoes of our own write.
    /// Owned by the methods below — never set or read directly.
    suppress_until: Option<Instant>,
}

impl NotebookState {
    /// Install a freshly-scanned notebook (plus its persisted frecency map),
    /// clearing any pending suppression (a fresh open is never an echo of a
    /// previous write).
    pub fn load(
        &mut self,
        root: PathBuf,
        records: Vec<Arc<NoteRecord>>,
        frecency: HashMap<String, FrecencyEntry>,
    ) {
        self.root = Some(root);
        self.records = Arc::new(records);
        self.frecency = Arc::new(frecency);
        self.suppress_until = None;
    }

    /// Record a note open at `now_ms`: decay the note's running frecency score
    /// to now, then add 1 (see `frecency::FrecencyEntry::bump`).
    pub fn record_open(&mut self, rel: &str, now_ms: u64) {
        Arc::make_mut(&mut self.frecency)
            .entry(rel.to_string())
            .or_insert(FrecencyEntry {
                score: 0.0,
                last_ms: now_ms,
            })
            .bump(now_ms);
    }

    /// Replace the index after an external change (the watcher's rescan).
    pub fn set_records(&mut self, records: Vec<Arc<NoteRecord>>) {
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
                None => {
                    remove_by_path(records, &path);
                    Arc::make_mut(&mut self.frecency).remove(&path);
                }
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
    /// (with refreshed meta + body), migrate the frecency entry to the new path,
    /// and arm the echo-suppression window so the watcher ignores the move (which
    /// surfaces as a delete + create).
    pub fn record_own_rename(
        &mut self,
        old_path: &str,
        meta: NoteMeta,
        body: String,
        now: Instant,
    ) {
        let frecency = Arc::make_mut(&mut self.frecency);
        if let Some(e) = frecency.remove(old_path) {
            frecency.insert(meta.path.clone(), e);
        }
        let records = Arc::make_mut(&mut self.records);
        remove_by_path(records, old_path);
        upsert_sorted(records, NoteRecord { meta, body });
        self.suppress_until = Some(now + SUPPRESS);
    }

    /// Record our own delete: drop the record (and its frecency entry) and arm
    /// the suppression window.
    pub fn record_own_delete(&mut self, path: &str, now: Instant) {
        let records = Arc::make_mut(&mut self.records);
        remove_by_path(records, path);
        Arc::make_mut(&mut self.frecency).remove(path);
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
    fn arcs(recs: Vec<NoteRecord>) -> Vec<Arc<NoteRecord>> {
        recs.into_iter().map(Arc::new).collect()
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
        s.load(
            PathBuf::from("/nb"),
            arcs(vec![rec("a.md", "x")]),
            HashMap::new(),
        );
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
    fn own_write_shallow_copies_only_the_touched_record() {
        let mut s = NotebookState::default();
        s.load(
            PathBuf::from("/nb"),
            arcs(vec![
                rec("a.md", "a1"),
                rec("b.md", "b1"),
                rec("c.md", "c1"),
            ]),
            HashMap::new(),
        );
        let snapshot = s.records.clone(); // a live search snapshot
        s.record_own_write(meta("b.md"), "b2".to_string(), Instant::now());
        // the snapshot still sees the pre-mutation body...
        assert_eq!(snapshot[1].body, "b1");
        assert_eq!(s.records[1].body, "b2");
        // ...and every untouched record is the SAME allocation in both vectors
        // (the make_mut copied pointers, not note bodies)
        assert!(Arc::ptr_eq(&snapshot[0], &s.records[0]));
        assert!(!Arc::ptr_eq(&snapshot[1], &s.records[1]));
        assert!(Arc::ptr_eq(&snapshot[2], &s.records[2]));
    }

    #[test]
    fn find_record_binary_search_agrees_with_linear_scan() {
        // Path set with the '/'-vs-alphanumeric byte-order trap ("dir/…" sorts
        // before "dir2/…"): guards the comparator against sort-order drift.
        let mut records = arcs(vec![
            rec("dir2/x.md", ""),
            rec("z.md", ""),
            rec("a.md", ""),
            rec("dir/nested.md", ""),
            rec("m.md", ""),
        ]);
        // Sort exactly the way scan_notebook does.
        records.sort_unstable_by(|a, b| a.meta.path.cmp(&b.meta.path));
        for (i, r) in records.iter().enumerate() {
            assert_eq!(
                find_record(&records, &r.meta.path),
                Some(i),
                "hit each element incl. first/last"
            );
        }
        assert_eq!(find_record(&records, "dir/nested.md"), Some(1)); // '/' < '2'
        assert!(find_record(&records, "missing.md").is_none());
        assert!(find_record(&records, "").is_none());
        assert!(find_record(&records, "zz.md").is_none()); // past the end
    }

    #[test]
    fn own_writes_and_renames_keep_records_path_sorted() {
        let mut s = NotebookState::default();
        let t0 = Instant::now();
        s.load(
            PathBuf::from("/nb"),
            arcs(vec![rec("a.md", "1"), rec("z.md", "2")]),
            HashMap::new(),
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
            arcs(vec![rec("a.md", "1"), rec("m.md", "2"), rec("z.md", "3")]),
            HashMap::new(),
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
            arcs(vec![rec("a.md", "x"), rec("b.md", "y")]),
            HashMap::new(),
        );
        s.record_own_delete("a.md", t0);
        assert_eq!(s.records.len(), 1);
        assert_eq!(s.records[0].meta.path, "b.md");
        assert!(s.should_ignore_event(t0));
    }

    #[test]
    fn record_open_bumps_frecency_mru_style() {
        let mut s = NotebookState::default();
        s.load(
            PathBuf::from("/nb"),
            arcs(vec![rec("a.md", "x")]),
            HashMap::new(),
        );
        s.record_open("a.md", 1_000);
        s.record_open("a.md", 1_000);
        let e = s.frecency.get("a.md").unwrap();
        assert_eq!(e.score, 2.0); // two opens with no time passing: 0+1, then 1+1
        assert_eq!(e.last_ms, 1_000);
    }

    #[test]
    fn record_own_rename_migrates_the_frecency_entry() {
        let mut s = NotebookState::default();
        s.load(
            PathBuf::from("/nb"),
            arcs(vec![rec("a.md", "x")]),
            HashMap::new(),
        );
        s.record_open("a.md", 1_000);
        s.record_own_rename("a.md", meta("b.md"), "x".to_string(), Instant::now());
        assert!(!s.frecency.contains_key("a.md"));
        let e = s.frecency.get("b.md").unwrap();
        assert_eq!(e.score, 1.0);
        assert_eq!(e.last_ms, 1_000);
    }

    #[test]
    fn delete_and_external_remove_drop_the_frecency_entry() {
        let mut s = NotebookState::default();
        s.load(
            PathBuf::from("/nb"),
            arcs(vec![rec("a.md", "x"), rec("b.md", "y")]),
            HashMap::new(),
        );
        s.record_open("a.md", 1_000);
        s.record_open("b.md", 1_000);
        s.record_own_delete("a.md", Instant::now());
        assert!(!s.frecency.contains_key("a.md"));
        s.apply_external(vec![("b.md".to_string(), None)]);
        assert!(!s.frecency.contains_key("b.md"));
    }
}
