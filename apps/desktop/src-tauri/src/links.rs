// Server-side wikilink resolution + backlinks — mirrors src/links.ts so the
// scan runs in Rust over the cached records (fast, off the JS main thread) and
// only the matching references cross the IPC boundary, not every note body.
use std::collections::HashMap;

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
                // brackets/pipes/newlines aren't allowed in a target (mirror the TS regex)
                if !inner.is_empty() && !inner.contains('[') {
                    let target = inner.split('|').next().unwrap_or("").trim();
                    if !target.is_empty() {
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

/// Resolve a target to a note by decreasing specificity: exact title, exact
/// filename, filename slug, title slug. Empty keys never match.
pub fn resolve<'a>(target: &str, records: &'a [NoteRecord]) -> Option<&'a NoteRecord> {
    let t = {
        let n = norm(target);
        n.strip_suffix(".md").map(str::to_string).unwrap_or(n)
    };
    let ts = slug(target);
    if t.is_empty() && ts.is_empty() {
        return None;
    }
    if !t.is_empty() {
        if let Some(r) = records.iter().find(|r| norm(&r.meta.title) == t) {
            return Some(r);
        }
        if let Some(r) = records.iter().find(|r| norm(&base_name(&r.meta.path)) == t) {
            return Some(r);
        }
    }
    if !ts.is_empty() {
        if let Some(r) = records
            .iter()
            .find(|r| slug(&base_name(&r.meta.path)) == ts)
        {
            return Some(r);
        }
        if let Some(r) = records.iter().find(|r| slug(&r.meta.title) == ts) {
            return Some(r);
        }
    }
    None
}

/// Notes (other than `active_id`) whose body has a wikilink resolving to it.
/// One reference line per source note. A per-target cache keeps it ~O(refs).
pub fn backlinks(records: &[NoteRecord], active_id: &str) -> Vec<Backlink> {
    let mut cache: HashMap<String, bool> = HashMap::new();
    let mut out = Vec::new();
    for r in records {
        if r.meta.id == active_id {
            continue;
        }
        for (i, line) in r.body.lines().enumerate() {
            let mut found = false;
            for t in parse_targets(line) {
                let hit = *cache.entry(t.to_string()).or_insert_with(|| {
                    resolve(t, records)
                        .map(|m| m.meta.id == active_id)
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

    fn rec(path: &str, title: &str, body: &str) -> NoteRecord {
        NoteRecord {
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
        }
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
