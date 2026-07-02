//! Open-frecency: exponentially-decayed open counts that rank recently/often
//! opened notes higher in the finder. This module is pure data + JSON
//! persistence (no tauri, node-style testable); the ranking effects live in
//! `search::fuzzy_files` and the bookkeeping in `state::NotebookState`.

use std::collections::HashMap;
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

/// Decay half-life: a note's frecency halves for every 7 days it goes unopened.
pub const HALF_LIFE_MS: u64 = 7 * 24 * 60 * 60 * 1000;

/// Per-notebook cap in `frecency.json`; the lowest effective scores are pruned
/// at save time so the file never grows with the notebook.
const MAX_SAVED: usize = 500;

/// One note's frecency: `score` is the decayed open count as of `last_ms`
/// (unix ms of the last open). Serialized as `s`/`t` per the store shape.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct FrecencyEntry {
    #[serde(rename = "s")]
    pub score: f64,
    #[serde(rename = "t")]
    pub last_ms: u64,
}

impl FrecencyEntry {
    /// The score decayed from `last_ms` to `now_ms`. Saturating on the clock
    /// running backwards — skew must decay-to-nothing, never inflate.
    pub fn effective(&self, now_ms: u64) -> f64 {
        let elapsed = now_ms.saturating_sub(self.last_ms) as f64;
        self.score * 0.5f64.powf(elapsed / HALF_LIFE_MS as f64)
    }

    /// Record an open: decay the running score to `now_ms`, then add 1.
    pub fn bump(&mut self, now_ms: u64) {
        self.score = self.effective(now_ms) + 1.0;
        self.last_ms = now_ms;
    }
}

/// The on-disk shape of `frecency.json`: one map per notebook root path, so
/// multiple notebooks coexist in the single app-data file.
type Store = HashMap<String, HashMap<String, FrecencyEntry>>;

fn read_store(file: &Path) -> Store {
    fs::read(file)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

/// Load one notebook's frecency map. Best-effort: a missing file, unreadable
/// file, or unparsable JSON is just an empty map (frecency is reconstructible
/// ranking data, never load-bearing).
pub fn load(file: &Path, root: &str) -> HashMap<String, FrecencyEntry> {
    read_store(file).remove(root).unwrap_or_default()
}

/// Persist one notebook's map into the shared store file (other notebooks'
/// maps are preserved), pruned to the MAX_SAVED highest effective scores.
/// Best-effort: I/O errors are ignored.
pub fn save(file: &Path, root: &str, map: &HashMap<String, FrecencyEntry>, now_ms: u64) {
    let mut store = read_store(file);
    store.insert(root.to_string(), prune(map, now_ms));
    if let Some(dir) = file.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string(&store) {
        let _ = fs::write(file, json);
    }
}

fn prune(map: &HashMap<String, FrecencyEntry>, now_ms: u64) -> HashMap<String, FrecencyEntry> {
    if map.len() <= MAX_SAVED {
        return map.clone();
    }
    let mut entries: Vec<(&String, &FrecencyEntry)> = map.iter().collect();
    // Path tie-break so the kept set is deterministic (HashMap order is not).
    entries.sort_unstable_by(|a, b| {
        b.1.effective(now_ms)
            .total_cmp(&a.1.effective(now_ms))
            .then_with(|| a.0.cmp(b.0))
    });
    entries.truncate(MAX_SAVED);
    entries.into_iter().map(|(p, e)| (p.clone(), *e)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_half_life_halves_the_score() {
        let e = FrecencyEntry {
            score: 2.0,
            last_ms: 0,
        };
        assert_eq!(e.effective(0), 2.0);
        assert!((e.effective(HALF_LIFE_MS) - 1.0).abs() < 1e-12);
        assert!((e.effective(2 * HALF_LIFE_MS) - 0.5).abs() < 1e-12);
        // clock skew (now before last) must never inflate the score
        let skewed = FrecencyEntry {
            score: 2.0,
            last_ms: 100,
        };
        assert_eq!(skewed.effective(0), 2.0);
    }

    #[test]
    fn bump_decays_then_adds_one() {
        let mut e = FrecencyEntry {
            score: 2.0,
            last_ms: 0,
        };
        e.bump(HALF_LIFE_MS);
        assert!((e.score - 2.0).abs() < 1e-12); // 2 * 0.5 + 1
        assert_eq!(e.last_ms, HALF_LIFE_MS);
    }

    #[test]
    fn save_and_load_round_trip_per_notebook() {
        let dir =
            std::env::temp_dir().join(format!("noteside-frecency-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let file = dir.join("frecency.json");

        assert!(load(&file, "/nb1").is_empty()); // missing file → empty map

        let mut nb1 = HashMap::new();
        nb1.insert(
            "a.md".to_string(),
            FrecencyEntry {
                score: 1.5,
                last_ms: 42,
            },
        );
        save(&file, "/nb1", &nb1, 42);
        let mut nb2 = HashMap::new();
        nb2.insert(
            "b.md".to_string(),
            FrecencyEntry {
                score: 3.0,
                last_ms: 7,
            },
        );
        save(&file, "/nb2", &nb2, 7);

        assert_eq!(load(&file, "/nb1"), nb1); // nb2's save preserved nb1
        assert_eq!(load(&file, "/nb2"), nb2);
        assert!(load(&file, "/nb3").is_empty()); // unknown root → empty map

        fs::write(&file, "not json").unwrap();
        assert!(load(&file, "/nb1").is_empty()); // corrupt file → empty map

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_prunes_to_the_top_entries_by_effective_score() {
        let dir =
            std::env::temp_dir().join(format!("noteside-frecency-prune-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let file = dir.join("frecency.json");

        // Same stored score everywhere; a fresher last_ms decays less, so the
        // most recently opened MAX_SAVED entries survive the prune.
        let map: HashMap<String, FrecencyEntry> = (0..MAX_SAVED + 10)
            .map(|i| {
                (
                    format!("n-{i:04}.md"),
                    FrecencyEntry {
                        score: 1.0,
                        last_ms: i as u64,
                    },
                )
            })
            .collect();
        save(&file, "/nb", &map, (MAX_SAVED + 10) as u64);
        let loaded = load(&file, "/nb");
        assert_eq!(loaded.len(), MAX_SAVED);
        assert!(!loaded.contains_key("n-0000.md")); // stalest dropped
        assert!(loaded.contains_key(&format!("n-{:04}.md", MAX_SAVED + 9)));

        let _ = fs::remove_dir_all(&dir);
    }
}
