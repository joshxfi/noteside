// Server-side wikilink resolution + backlinks — mirrors src/links.ts so the
// scan runs in Rust over the cached records (fast, off the JS main thread) and
// only the matching references cross the IPC boundary, not every note body.
use std::collections::HashMap;
use std::sync::Arc;

use crate::models::Backlink;
use crate::notebook::NoteRecord;

/// Extract `[[Target]]` / `[[Target|Display]]` targets from one line.
fn parse_targets(line: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut i = 0;
    while let Some(open) = line[i..].find("[[") {
        let start = i + open + 2;
        match line[start..].find("]]") {
            Some(close) => {
                let inner = &line[start..start + close];
                // Mirror the TS WIKILINK regex: target/display may not contain
                // '[' ']' '|'; at most one '|' (target|display), and a present
                // display must be non-empty.
                if !inner.is_empty() && !inner.contains('[') && !inner.contains(']') {
                    let mut parts = inner.split('|');
                    let target = parts.next().unwrap_or("").trim();
                    let display = parts.next();
                    let extra_pipe = parts.next().is_some();
                    let display_ok = display.map_or(true, |d| !d.is_empty());
                    if !target.is_empty() && !extra_pipe && display_ok {
                        out.push(target);
                    }
                }
                i = start + close + 2;
            }
            None => break,
        }
    }
    out
}

fn norm(s: &str) -> String {
    s.trim().to_lowercase()
}

fn slug(s: &str) -> String {
    let mut out = String::new();
    let mut in_dash = false;
    for ch in s.trim().to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            in_dash = false;
        } else if !in_dash {
            out.push('-');
            in_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

fn base_name(path: &str) -> String {
    let file = path.rsplit('/').next().unwrap_or(path);
    if file.to_lowercase().ends_with(".md") {
        file[..file.len() - 3].to_string()
    } else {
        file.to_string()
    }
}

/// Lookup tables for `resolve`'s four match steps, built in one pass over the
/// records. Values are record indices; insert-if-absent keeps the first record
/// per key, matching the old linear scans' first-match tie-break.
struct ResolveIndex {
    by_title: HashMap<String, usize>,
    by_base: HashMap<String, usize>,
    by_base_slug: HashMap<String, usize>,
    by_title_slug: HashMap<String, usize>,
}

impl ResolveIndex {
    fn build(records: &[Arc<NoteRecord>]) -> Self {
        let mut by_title = HashMap::with_capacity(records.len());
        let mut by_base = HashMap::with_capacity(records.len());
        let mut by_base_slug = HashMap::with_capacity(records.len());
        let mut by_title_slug = HashMap::with_capacity(records.len());
        for (i, r) in records.iter().enumerate() {
            let base = base_name(&r.meta.path);
            by_title.entry(norm(&r.meta.title)).or_insert(i);
            by_base.entry(norm(&base)).or_insert(i);
            by_base_slug.entry(slug(&base)).or_insert(i);
            by_title_slug.entry(slug(&r.meta.title)).or_insert(i);
        }
        Self {
            by_title,
            by_base,
            by_base_slug,
            by_title_slug,
        }
    }

    /// Decreasing specificity: exact title, exact filename, filename slug,
    /// title slug. Empty keys never match.
    fn lookup(&self, target: &str) -> Option<usize> {
        let t = {
            let n = norm(target);
            n.strip_suffix(".md").map(str::to_string).unwrap_or(n)
        };
        let ts = slug(target);
        if !t.is_empty() {
            if let Some(&i) = self.by_title.get(&t) {
                return Some(i);
            }
            if let Some(&i) = self.by_base.get(&t) {
                return Some(i);
            }
        }
        if !ts.is_empty() {
            if let Some(&i) = self.by_base_slug.get(&ts) {
                return Some(i);
            }
            if let Some(&i) = self.by_title_slug.get(&ts) {
                return Some(i);
            }
        }
        None
    }
}

/// Resolve a target to a note by decreasing specificity: exact title, exact
/// filename, filename slug, title slug. Empty keys never match.
pub fn resolve<'a>(target: &str, records: &'a [Arc<NoteRecord>]) -> Option<&'a NoteRecord> {
    ResolveIndex::build(records)
        .lookup(target)
        .map(|i| &*records[i])
}

/// Notes (other than `active_id`) whose body has a wikilink resolving to it.
/// One reference line per source note. A per-target cache keeps it ~O(refs).
pub fn backlinks(records: &[Arc<NoteRecord>], active_id: &str) -> Vec<Backlink> {
    let index = ResolveIndex::build(records);
    // Keys borrow from the note bodies: a repeated target costs one hash
    // lookup, no allocation.
    let mut cache: HashMap<&str, bool> = HashMap::new();
    let mut out = Vec::new();
    for r in records {
        if r.meta.id == active_id {
            continue;
        }
        for (i, line) in r.body.lines().enumerate() {
            let mut found = false;
            for t in parse_targets(line) {
                let hit = *cache.entry(t).or_insert_with(|| {
                    index
                        .lookup(t)
                        .map(|m| records[m].meta.id == active_id)
                        .unwrap_or(false)
                });
                if hit {
                    found = true;
                    break;
                }
            }
            if found {
                out.push(Backlink {
                    id: r.meta.id.clone(),
                    title: r.meta.title.clone(),
                    line_number: (i + 1) as u32,
                    line: line.trim().to_string(),
                });
                break;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::NoteMeta;

    fn rec(path: &str, title: &str, body: &str) -> Arc<NoteRecord> {
        Arc::new(NoteRecord {
            meta: NoteMeta {
                id: path.into(),
                path: path.into(),
                title: title.into(),
                tags: vec![],
                created: None,
                updated: 0,
                pinned: false,
            },
            body: body.into(),
        })
    }

    #[test]
    fn parses_plain_and_piped_targets() {
        assert_eq!(
            parse_targets("see [[A]] and [[b c|disp]] x"),
            vec!["A", "b c"]
        );
        assert!(parse_targets("[[]] and [[unterminated").is_empty());
    }

    #[test]
    fn wikilink_parity_matches_shared_vectors() {
        let raw = include_str!("../../src/test-vectors/parity.json");
        let v: serde_json::Value = serde_json::from_str(raw).unwrap();
        for case in v["wikilinkTargets"].as_array().unwrap() {
            let line = case["line"].as_str().unwrap();
            let expected: Vec<&str> = case["out"]
                .as_array()
                .unwrap()
                .iter()
                .map(|x| x.as_str().unwrap())
                .collect();
            assert_eq!(
                parse_targets(line),
                expected,
                "wikilink parity for {line:?}"
            );
        }
    }

    #[test]
    fn resolves_by_title_filename_and_slug() {
        let recs = vec![
            rec("ideas/garden.md", "Digital Garden", ""),
            rec("meeting-notes.md", "Meeting Notes", ""),
        ];
        assert_eq!(
            resolve("digital garden", &recs).unwrap().meta.id,
            "ideas/garden.md"
        );
        assert_eq!(
            resolve("meeting-notes", &recs).unwrap().meta.id,
            "meeting-notes.md"
        );
        assert_eq!(
            resolve("Meeting Notes", &recs).unwrap().meta.id,
            "meeting-notes.md"
        );
        assert!(resolve("nope", &recs).is_none());
        assert!(resolve("!!!", &recs).is_none());
    }

    #[test]
    fn resolve_prefers_title_over_filename_and_first_record_on_ties() {
        // Step precedence: an exact TITLE match on a later record beats an
        // exact FILENAME match on an earlier one.
        let recs = vec![rec("zed.md", "Other", ""), rec("b.md", "Zed", "")];
        assert_eq!(resolve("zed", &recs).unwrap().meta.id, "b.md");
        // Within a step, the first record wins.
        let dupes = vec![rec("first.md", "Dup", ""), rec("second.md", "Dup", "")];
        assert_eq!(resolve("dup", &dupes).unwrap().meta.id, "first.md");
        // Slug fallback: filename slug beats title slug.
        let slugs = vec![
            rec("x.md", "Meeting Notes!", ""),
            rec("meeting-notes.md", "Y", ""),
        ];
        assert_eq!(
            resolve("Meeting -- Notes", &slugs).unwrap().meta.id,
            "meeting-notes.md"
        );
    }

    #[test]
    fn backlinks_finds_linkers_and_excludes_self() {
        let recs = vec![
            rec("a.md", "Alpha", "links to [[Beta]]"),
            rec(
                "b.md",
                "Beta",
                "self ref [[Beta]] ignored for itself\nand [[Alpha]]",
            ),
            rec("c.md", "Gamma", "no links"),
        ];
        let back = backlinks(&recs, "b.md");
        assert_eq!(back.len(), 1);
        assert_eq!(back[0].id, "a.md");
        assert_eq!(back[0].line_number, 1);
    }
}
