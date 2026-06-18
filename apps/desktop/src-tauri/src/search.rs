use nucleo_matcher::pattern::{CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher, Utf32Str};

use crate::models::{ContentHit, FileHit};
use crate::notebook::NoteRecord;

fn file_hit(r: &NoteRecord, score: u32, positions: Vec<u32>, title_positions: Vec<u32>) -> FileHit {
    FileHit {
        id: r.meta.id.clone(),
        path: r.meta.path.clone(),
        title: r.meta.title.clone(),
        tags: r.meta.tags.clone(),
        pinned: r.meta.pinned,
        score,
        positions,
        title_positions,
    }
}

fn fuzzy_match(
    pattern: &Pattern,
    matcher: &mut Matcher,
    haystack: &str,
    buf: &mut Vec<char>,
    indices: &mut Vec<u32>,
) -> Option<(u32, Vec<u32>)> {
    let hay = Utf32Str::new(haystack, buf);
    indices.clear();
    pattern
        .indices(hay, matcher, indices)
        .map(|score| (score, indices.clone()))
}

/// Fuzzy match over note paths and titles (Telescope/fzf-style), powered by
/// nucleo. With an empty query, returns everything pinned-first then most-recent.
pub fn fuzzy_files(records: &[NoteRecord], query: &str, limit: usize) -> Vec<FileHit> {
    let q = query.trim();
    if q.is_empty() {
        let mut all: Vec<&NoteRecord> = records.iter().collect();
        all.sort_by(|a, b| {
            b.meta
                .pinned
                .cmp(&a.meta.pinned)
                .then(b.meta.updated.cmp(&a.meta.updated))
        });
        return all
            .into_iter()
            .take(limit)
            .map(|r| file_hit(r, 0, Vec::new(), Vec::new()))
            .collect();
    }

    let mut matcher = Matcher::new(Config::DEFAULT.match_paths());
    let pattern = Pattern::parse(q, CaseMatching::Ignore, Normalization::Smart);
    let mut buf: Vec<char> = Vec::new();
    let mut indices: Vec<u32> = Vec::new();
    let mut scored: Vec<(u32, Vec<u32>, Vec<u32>, &NoteRecord)> = Vec::new();

    for r in records {
        let path_match = fuzzy_match(&pattern, &mut matcher, &r.meta.path, &mut buf, &mut indices);
        let title_match = fuzzy_match(
            &pattern,
            &mut matcher,
            &r.meta.title,
            &mut buf,
            &mut indices,
        );
        if path_match.is_none() && title_match.is_none() {
            continue;
        }
        let path_score = path_match.as_ref().map_or(0, |m| m.0);
        let title_score = title_match.as_ref().map_or(0, |m| m.0.saturating_add(16));
        scored.push((
            path_score.max(title_score),
            path_match.map_or_else(Vec::new, |m| m.1),
            title_match.map_or_else(Vec::new, |m| m.1),
            r,
        ));
    }
    scored.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then(b.3.meta.pinned.cmp(&a.3.meta.pinned))
            .then(b.3.meta.updated.cmp(&a.3.meta.updated))
    });
    scored
        .into_iter()
        .take(limit)
        .map(|(score, positions, title_positions, r)| {
            file_hit(r, score, positions, title_positions)
        })
        .collect()
}

/// Line-level content search over the cached note bodies. Modes mirror the
/// finder UI: `plain` substring, `regex`, and `fuzzy` subsequence. Byte offsets
/// in `ranges` are fine for ASCII; multi-byte alignment is a known v1 limitation.
pub fn content_search(
    records: &[NoteRecord],
    query: &str,
    mode: &str,
    limit: usize,
) -> Result<Vec<ContentHit>, regex::Error> {
    let needle = query.trim();
    let mut hits = Vec::new();
    if needle.is_empty() {
        return Ok(hits);
    }
    let smart_case = needle.chars().any(|c| c.is_uppercase());

    let re = if mode == "regex" {
        Some(
            regex::RegexBuilder::new(needle)
                .case_insensitive(!smart_case)
                .build()?,
        )
    } else {
        None
    };
    let needle_lc = needle.to_lowercase();

    'outer: for r in records {
        for (i, line) in r.body.lines().enumerate() {
            let ranges: Vec<[u32; 2]> = match mode {
                "regex" => re
                    .as_ref()
                    .map(|re| {
                        re.find_iter(line)
                            .filter(|m| !m.as_str().is_empty())
                            .map(|m| [m.start() as u32, m.end() as u32])
                            .collect()
                    })
                    .unwrap_or_default(),
                "fuzzy" => subsequence_ranges(line, &needle_lc).unwrap_or_default(),
                _ => plain_ranges(line, needle, &needle_lc, smart_case),
            };
            if !ranges.is_empty() {
                hits.push(ContentHit {
                    id: r.meta.id.clone(),
                    path: r.meta.path.clone(),
                    title: r.meta.title.clone(),
                    line_number: (i + 1) as u32,
                    line: line.to_string(),
                    ranges,
                });
                if hits.len() >= limit {
                    break 'outer;
                }
            }
        }
    }
    Ok(hits)
}

fn plain_ranges(line: &str, needle: &str, needle_lc: &str, smart_case: bool) -> Vec<[u32; 2]> {
    if needle.is_empty() {
        return Vec::new();
    }
    if smart_case {
        return exact_ranges(line, needle);
    }
    if line.is_ascii() && needle_lc.is_ascii() {
        return ascii_case_insensitive_ranges(line, needle_lc);
    }
    let hay = line.to_lowercase();
    exact_ranges(&hay, needle_lc)
}

fn exact_ranges(line: &str, needle: &str) -> Vec<[u32; 2]> {
    let mut ranges = Vec::new();
    let mut start = 0;
    while let Some(idx) = line[start..].find(needle) {
        let s = start + idx;
        let e = s + needle.len();
        ranges.push([s as u32, e as u32]);
        start = e;
    }
    ranges
}

fn ascii_case_insensitive_ranges(line: &str, needle_lc: &str) -> Vec<[u32; 2]> {
    let hay = line.as_bytes();
    let nee = needle_lc.as_bytes();
    let mut ranges = Vec::new();
    if nee.is_empty() || hay.len() < nee.len() {
        return ranges;
    }
    let mut i = 0;
    while i + nee.len() <= hay.len() {
        if hay[i..i + nee.len()]
            .iter()
            .zip(nee)
            .all(|(a, b)| a.to_ascii_lowercase() == *b)
        {
            ranges.push([i as u32, (i + nee.len()) as u32]);
            i += nee.len();
        } else {
            i += 1;
        }
    }
    ranges
}

fn subsequence_ranges(line: &str, needle_lc: &str) -> Option<Vec<[u32; 2]>> {
    let hay = line.to_lowercase();
    let mut chars = needle_lc.chars();
    let mut want = chars.next()?;
    let mut ranges = Vec::new();
    for (bi, ch) in hay.char_indices() {
        if ch == want {
            ranges.push([bi as u32, (bi + ch.len_utf8()) as u32]);
            match chars.next() {
                Some(c) => want = c,
                None => return Some(ranges),
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::NoteMeta;

    fn rec(path: &str, body: &str, pinned: bool, updated: i64) -> NoteRecord {
        rec_with_title(path, path, body, pinned, updated)
    }

    fn rec_with_title(
        path: &str,
        title: &str,
        body: &str,
        pinned: bool,
        updated: i64,
    ) -> NoteRecord {
        NoteRecord {
            meta: NoteMeta {
                id: path.into(),
                path: path.into(),
                title: title.into(),
                tags: vec![],
                created: None,
                updated,
                pinned,
            },
            body: body.into(),
        }
    }

    #[test]
    fn fuzzy_empty_query_returns_all_pinned_then_recent() {
        let recs = vec![
            rec("a.md", "", false, 1),
            rec("b.md", "", true, 0),
            rec("c.md", "", false, 2),
        ];
        let hits = fuzzy_files(&recs, "", 10);
        assert_eq!(hits.len(), 3);
        assert_eq!(hits[0].path, "b.md"); // pinned first
        assert_eq!(hits[1].path, "c.md"); // then updated desc
        assert_eq!(hits[2].path, "a.md");
    }

    #[test]
    fn fuzzy_matches_subsequence_and_excludes_non_matches() {
        let recs = vec![
            rec("welcome.md", "", false, 0),
            rec("keymap.md", "", false, 0),
        ];
        let hits = fuzzy_files(&recs, "wel", 10);
        assert_eq!(hits[0].path, "welcome.md");
        assert!(!hits[0].positions.is_empty());
        assert!(fuzzy_files(&recs, "zzzzz", 10).is_empty());
    }

    #[test]
    fn fuzzy_matches_title_with_separate_title_positions() {
        let recs = vec![
            rec_with_title("daily/2026-06-18.md", "Release Checklist", "", false, 0),
            rec_with_title("ideas/perf.md", "Performance Notes", "", false, 0),
        ];
        let hits = fuzzy_files(&recs, "rel", 10);
        assert_eq!(hits[0].path, "daily/2026-06-18.md");
        assert!(hits[0].positions.is_empty());
        assert!(!hits[0].title_positions.is_empty());
    }

    #[test]
    fn content_plain_is_case_insensitive_with_ranges() {
        let recs = vec![rec("a.md", "The Kettle is on\nsecond", false, 0)];
        let hits = content_search(&recs, "kettle", "plain", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].line_number, 1);
        let [s, e] = hits[0].ranges[0];
        assert_eq!(&hits[0].line[s as usize..e as usize], "Kettle");
    }

    #[test]
    fn content_smart_case_is_sensitive_when_uppercase() {
        let recs = vec![rec("a.md", "kettle Kettle", false, 0)];
        let hits = content_search(&recs, "Kettle", "plain", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].ranges.len(), 1);
    }

    #[test]
    fn content_regex_matches_and_rejects_invalid() {
        let recs = vec![rec("a.md", "foo123 bar", false, 0)];
        let hits = content_search(&recs, r"\d+", "regex", 10).unwrap();
        let [s, e] = hits[0].ranges[0];
        assert_eq!(&hits[0].line[s as usize..e as usize], "123");
        assert!(content_search(&recs, "(", "regex", 10).is_err());
    }

    #[test]
    fn content_empty_needle_is_empty() {
        let recs = vec![rec("a.md", "anything", false, 0)];
        assert!(content_search(&recs, "  ", "plain", 10).unwrap().is_empty());
    }
}
