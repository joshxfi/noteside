use std::cell::RefCell;
use std::cmp::Reverse;
use std::collections::HashMap;
use std::sync::Arc;

use nucleo_matcher::pattern::{CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher, Utf32Str};

use crate::frecency::FrecencyEntry;
use crate::models::{ContentHit, FileHit};
use crate::notebook::NoteRecord;

/// Frecency nudge on text matches, in 1/BOOST_SCALE fixed point (integer keys
/// keep the tuple ordering exact): effective = nucleo_score * (BOOST_SCALE +
/// BOOST_MAX * s/(s+BOOST_PIVOT)) / BOOST_SCALE — i.e. * (1 + 0.15 * s/(s+3)),
/// saturating at +15% (154/1024) so text relevance always stays dominant.
const BOOST_SCALE: u64 = 1024;
const BOOST_MAX: u64 = 154;
const BOOST_PIVOT: f64 = 3.0;

thread_local! {
    // Matcher owns big scratch allocations; reuse it across calls (searches run
    // on a small pool of blocking threads, so this stays bounded).
    static MATCHER: RefCell<Matcher> = RefCell::new(Matcher::new(Config::DEFAULT.match_paths()));
}

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

/// Partial sort: keep only the `limit` smallest elements per `key`, in order.
/// The key must be a total order (tie-break on a unique index) so this returns
/// exactly what a stable full sort + truncate would have.
fn top_by_key<T, K: Ord, F: FnMut(&T) -> K + Copy>(items: &mut Vec<T>, limit: usize, key: F) {
    if items.len() > limit {
        items.select_nth_unstable_by_key(limit, key);
        items.truncate(limit);
    }
    items.sort_unstable_by_key(key);
}

/// The note's frecency score decayed to `now_ms`; 0 for a never-opened note
/// (so an empty map reproduces pre-frecency ranking exactly).
fn effective_frecency(frecency: &HashMap<String, FrecencyEntry>, path: &str, now_ms: u64) -> f64 {
    if frecency.is_empty() {
        return 0.0;
    }
    frecency.get(path).map_or(0.0, |e| e.effective(now_ms))
}

/// Fuzzy match over note paths and titles (Telescope/fzf-style), powered by
/// nucleo. With an empty query, returns everything pinned-first, then by open
/// frecency, then most-recent; with a query, frecency is only a bounded nudge
/// on the text score. Pure in `now_ms` — the command layer supplies the clock.
pub fn fuzzy_files(
    records: &[Arc<NoteRecord>],
    query: &str,
    limit: usize,
    frecency: &HashMap<String, FrecencyEntry>,
    now_ms: u64,
) -> Vec<FileHit> {
    let q = query.trim();
    if q.is_empty() {
        // Precompute each record's effective frecency once (decay is a powf);
        // non-negative f64s order identically to their IEEE bit patterns, so
        // the bits slot into the integer sort key.
        let mut all: Vec<(u64, usize, &NoteRecord)> = records
            .iter()
            .enumerate()
            .map(|(i, r)| {
                let f = effective_frecency(frecency, &r.meta.path, now_ms);
                (f.to_bits(), i, &**r)
            })
            .collect();
        top_by_key(&mut all, limit, |&(f, i, r)| {
            (
                Reverse(r.meta.pinned),
                Reverse(f),
                Reverse(r.meta.updated),
                i,
            )
        });
        return all
            .into_iter()
            .map(|(_, _, r)| file_hit(r, 0, Vec::new(), Vec::new()))
            .collect();
    }

    MATCHER.with(|m| {
        let matcher = &mut *m.borrow_mut();
        let pattern = Pattern::parse(q, CaseMatching::Ignore, Normalization::Smart);
        let mut buf: Vec<char> = Vec::new();

        // Score-only pass over every record (no index tracking). Ranking uses
        // the frecency-boosted fixed-point score; the reported `score` stays
        // the raw nucleo score.
        let mut scored: Vec<(u64, u32, usize)> = Vec::new();
        for (i, r) in records.iter().enumerate() {
            let path_score = pattern.score(Utf32Str::new(&r.meta.path, &mut buf), matcher);
            let title_score = pattern.score(Utf32Str::new(&r.meta.title, &mut buf), matcher);
            if path_score.is_none() && title_score.is_none() {
                continue;
            }
            let p = path_score.unwrap_or(0);
            let t = title_score.map_or(0, |s| s.saturating_add(16));
            let score = p.max(t);
            let s = effective_frecency(frecency, &r.meta.path, now_ms);
            let boost = (BOOST_MAX as f64 * s / (s + BOOST_PIVOT)) as u64;
            scored.push((score as u64 * (BOOST_SCALE + boost), score, i));
        }

        top_by_key(&mut scored, limit, |&(boosted, _, i)| {
            let r = &records[i];
            (
                Reverse(boosted),
                Reverse(r.meta.pinned),
                Reverse(r.meta.updated),
                i,
            )
        });

        // Highlight-index pass only for the returned page.
        let mut indices: Vec<u32> = Vec::new();
        scored
            .into_iter()
            .map(|(_, score, i)| {
                let r = &records[i];
                let positions =
                    fuzzy_match(&pattern, matcher, &r.meta.path, &mut buf, &mut indices)
                        .map_or_else(Vec::new, |m| m.1);
                let title_positions =
                    fuzzy_match(&pattern, matcher, &r.meta.title, &mut buf, &mut indices)
                        .map_or_else(Vec::new, |m| m.1);
                file_hit(r, score, positions, title_positions)
            })
            .collect()
    })
}

/// Line-level content search over the cached note bodies. Modes mirror the
/// finder UI: `plain` substring, `regex`, and `fuzzy` subsequence. Byte offsets
/// in `ranges` are fine for ASCII; multi-byte alignment is a known v1 limitation.
pub fn content_search(
    records: &[Arc<NoteRecord>],
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
    let mut prefilter: Option<Prefilter> = None;

    'outer: for (ri, r) in records.iter().enumerate() {
        // A popular query fills `limit` within the first records and never pays
        // for the prefilter (building one can cost a regex compile); only a scan
        // that outlives PREFILTER_AFTER notes — a rare or no-match query, which
        // is exactly where skipping pays off — builds and consults it.
        if ri >= PREFILTER_AFTER {
            let pf = prefilter.get_or_insert_with(|| build_prefilter(needle, mode, smart_case));
            if !pf.may_match(&r.body, needle, &needle_lc) {
                continue;
            }
        }
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

/// Long-scan threshold for building the whole-body prefilter (see the comment
/// at its use in `content_search`).
const PREFILTER_AFTER: usize = 128;

/// Whole-body skip test, run once per note before the per-line loop: most notes
/// don't match a query, and one fast body scan is far cheaper than line-by-line
/// matching. A prefilter may say "maybe" for a non-matching note (the unchanged
/// per-line pass then finds nothing) but must never say "no" for a matching one.
enum Prefilter {
    /// Case-sensitive plain: a line hit implies the body contains the needle.
    Contains,
    /// Plain case-insensitive, as an escaped-literal regex (its literal engine
    /// is SIMD-accelerated). A no-match verdict is only honored for ASCII
    /// bodies: the per-line matcher uses full Unicode lowercasing while regex
    /// case-insensitivity uses simple case folding, and the two disagree on
    /// oddities like 'İ' → "i̇" (on ASCII they agree exactly).
    CiLiteral(regex::Regex),
    /// Regex mode, recompiled with `(?m)` + CRLF line endings. A no-match
    /// verdict is only honored for bodies without '\r': CRLF mode also stops
    /// `.` from matching a mid-line '\r' that the per-line regex would match.
    Multiline(regex::Regex),
    /// Fuzzy: lowercased-subsequence scan over the whole body — ignoring line
    /// boundaries makes it a superset of any single line's subsequence.
    Fuzzy,
    /// No safe body-level test exists for this query: per-line only.
    None,
}

impl Prefilter {
    fn may_match(&self, body: &str, needle: &str, needle_lc: &str) -> bool {
        match self {
            Prefilter::Contains => body.contains(needle),
            Prefilter::CiLiteral(re) => re.is_match(body) || !body.is_ascii(),
            Prefilter::Multiline(re) => re.is_match(body) || body.contains('\r'),
            Prefilter::Fuzzy => body_has_subsequence(body, needle_lc),
            Prefilter::None => true,
        }
    }
}

fn build_prefilter(needle: &str, mode: &str, smart_case: bool) -> Prefilter {
    match mode {
        // The per-line pattern is re-anchored to the body with `(?m)` (+ CRLF
        // line endings, since `lines()` strips `\r\n` but plain `(?m)$` only
        // matches before `\n`). `^`/`$`/`\b` keep their per-line meaning then;
        // body anchors and inline flag groups clearing `m` do not, so those
        // patterns get no prefilter.
        "regex" if !regex_prefilter_unsafe(needle) => {
            regex::RegexBuilder::new(&format!("(?m){needle}"))
                .case_insensitive(!smart_case)
                .crlf(true)
                .build()
                .map_or(Prefilter::None, Prefilter::Multiline)
        }
        "regex" => Prefilter::None,
        "fuzzy" => Prefilter::Fuzzy,
        _ if smart_case => Prefilter::Contains,
        _ => regex::RegexBuilder::new(&regex::escape(needle))
            .case_insensitive(true)
            .build()
            .map_or(Prefilter::None, Prefilter::CiLiteral),
    }
}

/// True if prepending `(?m)` could make the prefilter miss a per-line match:
/// `\A`/`\z`/`\Z` stay body-anchored under `(?m)`, and an inline flag group
/// that clears `m` (e.g. `(?-m:...)`) re-anchors `^`/`$` to the body.
/// Over-approximates — a false "true" only skips the prefilter.
fn regex_prefilter_unsafe(pattern: &str) -> bool {
    if pattern.contains(r"\A") || pattern.contains(r"\z") || pattern.contains(r"\Z") {
        return true;
    }
    let mut i = 0;
    while let Some(off) = pattern[i..].find("(?") {
        let start = i + off + 2;
        let end = pattern[start..]
            .find([':', ')'])
            .map_or(pattern.len(), |e| start + e);
        let flags = &pattern[start..end];
        if let Some(dash) = flags.find('-') {
            if flags[dash..].contains('m') {
                return true;
            }
        }
        i = start;
    }
    false
}

/// Allocation-free "could any line fuzzy-match?": is `needle_lc` a subsequence
/// of the lowercased body? The char walk mirrors per-char `to_lowercase`, with
/// σ/ς treated as equal because full lowercasing is context-sensitive about
/// final sigma. Never misses a line the per-line matcher would accept.
fn body_has_subsequence(body: &str, needle_lc: &str) -> bool {
    if body.is_ascii() && needle_lc.is_ascii() {
        let mut nee = needle_lc.bytes();
        let Some(mut want) = nee.next() else {
            return false;
        };
        for b in body.bytes() {
            if b.to_ascii_lowercase() == want {
                match nee.next() {
                    Some(n) => want = n,
                    None => return true,
                }
            }
        }
        return false;
    }
    let mut nee = needle_lc.chars();
    let Some(mut want) = nee.next() else {
        return false;
    };
    for ch in body.chars() {
        for lc in ch.to_lowercase() {
            if lc == want || (lc == 'σ' && want == 'ς') || (lc == 'ς' && want == 'σ') {
                match nee.next() {
                    Some(n) => want = n,
                    None => return true,
                }
            }
        }
    }
    false
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
    ci_ranges(line, needle_lc)
}

/// Case-insensitive plain-substring ranges whose byte offsets index the
/// ORIGINAL `line` (never a lowercased copy, which can shift byte lengths for
/// chars like 'İ'/'ẞ'). Builds the lowercased haystack alongside a byte→origin
/// map, finds `needle_lc` in it, and translates each match back to `line`.
fn ci_ranges(line: &str, needle_lc: &str) -> Vec<[u32; 2]> {
    if needle_lc.is_empty() {
        return Vec::new();
    }
    let mut low = String::with_capacity(line.len());
    // For each byte of `low`, the byte offset in `line` of the source char that
    // produced it; a trailing sentinel maps `low.len()` to `line.len()`.
    let mut origin: Vec<usize> = Vec::with_capacity(line.len() + 1);
    for (obi, ch) in line.char_indices() {
        for lc in ch.to_lowercase() {
            let mut buf = [0u8; 4];
            let s = lc.encode_utf8(&mut buf);
            for _ in 0..s.len() {
                origin.push(obi);
            }
            low.push_str(s);
        }
    }
    origin.push(line.len());

    let mut ranges = Vec::new();
    let mut from = 0;
    while let Some(off) = low[from..].find(needle_lc) {
        let ls = from + off;
        let le = ls + needle_lc.len();
        // ls/le are char boundaries of `low` (both strings are valid UTF-8), so
        // `origin[ls]`/`origin[le]` are defined (sentinel covers le == low.len()).
        ranges.push([origin[ls] as u32, origin[le] as u32]);
        from = le;
    }
    ranges
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
    let mut chars = needle_lc.chars();
    let mut want = chars.next()?;
    let mut ranges = Vec::new();
    // Case-fold in place (no lowercased copy) so offsets index the original
    // line. Mirrors `body_has_subsequence`: a char's full lowercase expansion
    // (e.g. 'İ' → "i̇") can consume several needle chars, and σ/ς fold both
    // ways because `str::to_lowercase` is context-sensitive about final sigma.
    for (bi, ch) in line.char_indices() {
        let mut consumed = false;
        let mut done = false;
        if ch.is_ascii() && want.is_ascii() {
            if ch.eq_ignore_ascii_case(&want) {
                consumed = true;
                match chars.next() {
                    Some(c) => want = c,
                    None => done = true,
                }
            }
        } else {
            for lc in ch.to_lowercase() {
                if lc != want && !(lc == 'σ' && want == 'ς') && !(lc == 'ς' && want == 'σ') {
                    continue;
                }
                consumed = true;
                match chars.next() {
                    Some(c) => want = c,
                    None => {
                        done = true;
                        break;
                    }
                }
            }
        }
        if consumed {
            ranges.push([bi as u32, (bi + ch.len_utf8()) as u32]);
        }
        if done {
            return Some(ranges);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::NoteMeta;

    fn rec(path: &str, body: &str, pinned: bool, updated: i64) -> Arc<NoteRecord> {
        rec_with_title(path, path, body, pinned, updated)
    }

    fn rec_with_title(
        path: &str,
        title: &str,
        body: &str,
        pinned: bool,
        updated: i64,
    ) -> Arc<NoteRecord> {
        Arc::new(NoteRecord {
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
        })
    }

    /// Prepend PREFILTER_AFTER non-matching notes so `content_search` actually
    /// reaches the prefilter path for the records under test.
    fn pad(recs: Vec<Arc<NoteRecord>>) -> Vec<Arc<NoteRecord>> {
        let mut out: Vec<Arc<NoteRecord>> = (0..PREFILTER_AFTER)
            .map(|i| rec(&format!("pad-{i}.md"), "zz", false, 0))
            .collect();
        out.extend(recs);
        out
    }

    #[test]
    fn fuzzy_empty_query_returns_all_pinned_then_recent() {
        let recs = vec![
            rec("a.md", "", false, 1),
            rec("b.md", "", true, 0),
            rec("c.md", "", false, 2),
        ];
        let hits = fuzzy_files(&recs, "", 10, &HashMap::new(), 0);
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
        let hits = fuzzy_files(&recs, "wel", 10, &HashMap::new(), 0);
        assert_eq!(hits[0].path, "welcome.md");
        assert!(!hits[0].positions.is_empty());
        assert!(fuzzy_files(&recs, "zzzzz", 10, &HashMap::new(), 0).is_empty());
    }

    #[test]
    fn fuzzy_matches_title_with_separate_title_positions() {
        let recs = vec![
            rec_with_title("daily/2026-06-18.md", "Release Checklist", "", false, 0),
            rec_with_title("ideas/perf.md", "Performance Notes", "", false, 0),
        ];
        let hits = fuzzy_files(&recs, "rel", 10, &HashMap::new(), 0);
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
    fn content_plain_nonascii_ranges_stay_valid_on_the_original_line() {
        // 'ẞ' (U+1E9E, 3 bytes) lowercases to 'ß' (2 bytes): searching a shorter
        // lowercased copy shifted offsets so they could land mid-char in `line`.
        let recs = vec![rec("a.md", "xẞy", false, 0)];
        let hits = content_search(&recs, "ß", "plain", 10).unwrap();
        assert_eq!(hits.len(), 1);
        for [s, e] in hits[0].ranges.iter().copied() {
            // Offsets must be valid char-boundary slices of the SHIPPED line.
            assert!(
                hits[0].line.get(s as usize..e as usize).is_some(),
                "range [{s},{e}] is not a valid slice of {:?}",
                hits[0].line
            );
        }
        let [s, e] = hits[0].ranges[0];
        assert_eq!(&hits[0].line[s as usize..e as usize], "ẞ"); // covers the source char
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

    #[test]
    fn fuzzy_query_limit_keeps_best_with_original_tie_order() {
        // Identical paths (and non-matching titles) → identical scores; ties
        // must fall back to pinned, updated, then input order, exactly like
        // the old stable full sort.
        let recs = vec![
            rec_with_title("notes/kettle.md", "One", "", false, 1),
            rec_with_title("notes/kettle.md", "Two", "", true, 0),
            rec_with_title("notes/kettle.md", "Three", "", false, 1),
            rec_with_title("notes/kettle.md", "Four", "", false, 5),
        ];
        let hits = fuzzy_files(&recs, "kettle", 2, &HashMap::new(), 0);
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].title, "Two"); // pinned first
        assert_eq!(hits[1].title, "Four"); // then updated desc
        let full = fuzzy_files(&recs, "kettle", 10, &HashMap::new(), 0);
        assert_eq!(full[2].title, "One"); // equal keys keep input order
        assert_eq!(full[3].title, "Three");
        assert!(!full.iter().any(|h| h.positions.is_empty()));
    }

    #[test]
    fn fuzzy_empty_query_limit_matches_full_sort_prefix() {
        let recs = vec![
            rec("a.md", "", false, 3),
            rec("b.md", "", true, 0),
            rec("c.md", "", false, 7),
        ];
        let page = fuzzy_files(&recs, "", 2, &HashMap::new(), 0);
        assert_eq!(page.len(), 2);
        assert_eq!(page[0].path, "b.md");
        assert_eq!(page[1].path, "c.md");
    }

    #[test]
    fn content_nomatch_is_empty_in_every_mode() {
        let recs = pad(vec![
            rec("a.md", "the kettle is on\nsecond line", false, 0),
            rec("b.md", "roadmap review", false, 0),
        ]);
        assert!(content_search(&recs, "qqzzxxnotpresent", "plain", 10)
            .unwrap()
            .is_empty());
        assert!(content_search(&recs, "qqzzxxnotpresent", "regex", 10)
            .unwrap()
            .is_empty());
        assert!(content_search(&recs, "qxv", "fuzzy", 10)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn content_regex_body_anchor_bypasses_prefilter() {
        // `\A` under the body-level `(?m)` prefilter would only match the first
        // line; per-line it anchors every line, so the prefilter must not run.
        let recs = pad(vec![rec("a.md", "alpha\nbeta", false, 0)]);
        let hits = content_search(&recs, r"\Abeta", "regex", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].line_number, 2);
        assert!(regex_prefilter_unsafe(r"\Abeta"));
        assert!(regex_prefilter_unsafe(r"foo\z"));
        assert!(regex_prefilter_unsafe(r"foo\Z"));
        assert!(regex_prefilter_unsafe(r"(?-m:^a)"));
        assert!(regex_prefilter_unsafe(r"(?i-m)^a"));
        assert!(!regex_prefilter_unsafe(r"^foo$"));
        assert!(!regex_prefilter_unsafe(r"(?i)foo\b"));
    }

    #[test]
    fn content_regex_line_anchors_survive_the_prefilter() {
        let recs = pad(vec![rec("a.md", "x\nfoo", false, 0)]);
        let hits = content_search(&recs, "^foo", "regex", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].line_number, 2);

        // `$` on a CRLF body: lines() strips \r\n, so the prefilter needs CRLF
        // line-terminator handling to see the same match.
        let crlf = pad(vec![rec("b.md", "foo\r\nbar", false, 0)]);
        let hits = content_search(&crlf, "foo$", "regex", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].line_number, 1);
    }

    #[test]
    fn content_plain_insensitive_hit_survives_the_prefilter() {
        let recs = pad(vec![
            rec("a.md", "nothing here", false, 0),
            rec("b.md", "The KETTLE is on", false, 0),
        ]);
        let hits = content_search(&recs, "kettle", "plain", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "b.md");
        let [s, e] = hits[0].ranges[0];
        assert_eq!(&hits[0].line[s as usize..e as usize], "KETTLE");
    }

    #[test]
    fn content_plain_non_ascii_body_is_not_skipped() {
        // 'İ' lowercases to "i̇" (i + combining dot) — the per-line matcher sees
        // an "i" the prefilter's case-folded scan would not; non-ASCII bodies
        // must fall through to the per-line pass.
        let recs = pad(vec![rec("a.md", "İstanbul", false, 0)]);
        let hits = content_search(&recs, "i", "plain", 10).unwrap();
        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn content_fuzzy_matches_with_ranges_into_the_original_line() {
        let recs = pad(vec![
            rec("a.md", "unrelated words only", false, 0),
            rec("b.md", "The Kettle Boils", false, 0),
        ]);
        let hits = content_search(&recs, "ktb", "fuzzy", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "b.md");
        let picked: String = hits[0]
            .ranges
            .iter()
            .map(|&[s, e]| &hits[0].line[s as usize..e as usize])
            .collect();
        assert_eq!(picked, "KtB");
    }

    #[test]
    fn prefilter_verdicts_per_mode() {
        let pf = build_prefilter("kettle", "plain", false);
        assert!(pf.may_match("the KETTLE is on", "kettle", "kettle"));
        assert!(!pf.may_match("nothing here", "kettle", "kettle"));
        assert!(pf.may_match("İstanbul", "i", "i")); // non-ASCII body: never skip

        let pf = build_prefilter("Kettle", "plain", true);
        assert!(pf.may_match("a Kettle", "Kettle", "kettle"));
        assert!(!pf.may_match("a kettle", "Kettle", "kettle")); // case-sensitive

        let pf = build_prefilter("^foo", "regex", false);
        assert!(pf.may_match("x\nfoo", "^foo", "^foo"));
        assert!(!pf.may_match("x\nbar", "^foo", "^foo"));
        let pf = build_prefilter("foo$", "regex", false);
        assert!(pf.may_match("foo\r\nbar", "foo$", "foo$"));
        // a body with '\r' is never skipped: per-line `.` matches a lone CR,
        // the prefilter's CRLF mode does not
        let pf = build_prefilter("alpha.beta", "regex", false);
        assert!(pf.may_match("alpha\rbeta", "alpha.beta", "alpha.beta"));
        assert!(matches!(
            build_prefilter(r"\Abeta", "regex", false),
            Prefilter::None
        ));

        let pf = build_prefilter("ktb", "fuzzy", false);
        assert!(pf.may_match("The Kettle Boils", "ktb", "ktb"));
        assert!(!pf.may_match("unrelated words only", "ktb", "ktb"));
    }

    #[test]
    fn content_regex_dot_matches_mid_line_cr_past_the_prefilter() {
        // lines() keeps a lone '\r', and the per-line regex (no CRLF mode) lets
        // `.` match it; the CRLF-mode prefilter must not skip such a body.
        let recs = pad(vec![rec("c.md", "alpha\rbeta", false, 0)]);
        let hits = content_search(&recs, "alpha.beta", "regex", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].line_number, 1);
    }

    #[test]
    fn content_fuzzy_folds_final_sigma() {
        // str::to_lowercase maps a word-final 'Σ' to 'ς'; the in-place fold
        // maps it to 'σ', so the matcher must treat the two as equal.
        let recs = pad(vec![rec("g.md", "ΚΑΦΈΣ", false, 0)]);
        let hits = content_search(&recs, "καφές", "fuzzy", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].ranges.len(), 5);
    }

    #[test]
    fn content_fuzzy_consumes_multichar_lowercase_expansions() {
        // 'İ'.to_lowercase() is "i̇" (i + combining dot): the needle's two chars
        // must both be consumable by the single 'İ' line char.
        let recs = pad(vec![rec("t.md", "İstanbul", false, 0)]);
        let hits = content_search(&recs, "İstanbul", "fuzzy", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].ranges[0], [0, 2]); // the two-byte 'İ', emitted once

        // the multi-consume walk leaves ASCII output byte-identical
        assert_eq!(
            subsequence_ranges("The Kettle", "tk").unwrap(),
            vec![[0u32, 1], [4, 5]]
        );
    }

    #[test]
    fn body_has_subsequence_matches_the_per_line_semantics() {
        assert!(body_has_subsequence("The Kettle Boils", "ktb"));
        assert!(!body_has_subsequence("The Kettle Boils", "qzx"));
        // spans lines (superset of per-line: false positive is fine, miss is not)
        assert!(body_has_subsequence("ab\ncd", "acd"));
        assert!(body_has_subsequence("ΚΑΦΈΣ", "ς")); // final-sigma folding
        assert!(!body_has_subsequence("anything", ""));
    }

    fn frec(entries: &[(&str, f64, u64)]) -> HashMap<String, FrecencyEntry> {
        entries
            .iter()
            .map(|&(path, score, last_ms)| (path.to_string(), FrecencyEntry { score, last_ms }))
            .collect()
    }

    #[test]
    fn empty_query_frecency_ranks_opened_above_unopened() {
        let recs = vec![
            rec("old-opened.md", "", false, 1), // stale, but opened once
            rec("new-a.md", "", false, 10),
            rec("new-b.md", "", false, 9),
            rec("pin.md", "", true, 0),
        ];
        let f = frec(&[("old-opened.md", 1.0, 1_000)]);
        let hits = fuzzy_files(&recs, "", 10, &f, 1_000);
        assert_eq!(hits[0].path, "pin.md"); // pinned still outranks frecency
        assert_eq!(hits[1].path, "old-opened.md"); // MRU bump beats fresher mtimes
        assert_eq!(hits[2].path, "new-a.md"); // unopened keep updated-desc order
        assert_eq!(hits[3].path, "new-b.md");
    }

    #[test]
    fn query_boost_is_bounded_by_text_relevance() {
        let recs = vec![
            rec_with_title("kern/tottle.md", "Misc", "", false, 0), // weak, scattered match
            rec_with_title("notes/one.md", "Kettle", "", false, 0), // strong title match
        ];
        let plain = fuzzy_files(&recs, "kettle", 10, &HashMap::new(), 0);
        assert_eq!(plain[0].path, "notes/one.md");
        // The premise the pin relies on: even a maxed-out boost (+15%) cannot
        // close this score gap.
        assert!(f64::from(plain[0].score) > f64::from(plain[1].score) * 1.16);

        let f = frec(&[("kern/tottle.md", 1e9, 1_000)]); // absurdly hot note
        let hits = fuzzy_files(&recs, "kettle", 10, &f, 1_000);
        assert_eq!(hits[0].path, "notes/one.md"); // text relevance still wins
        assert_eq!(hits[0].score, plain[0].score); // reported score stays raw nucleo
    }

    #[test]
    fn query_equal_text_scores_break_toward_frecency() {
        // Identical structure → identical nucleo scores; equal updated; input
        // order would put `a` first. Frecency on `b` must flip the tie.
        let recs = vec![
            rec_with_title("notes/kettle-a.md", "One", "", false, 5),
            rec_with_title("notes/kettle-b.md", "Two", "", false, 5),
        ];
        let plain = fuzzy_files(&recs, "kettle", 10, &HashMap::new(), 0);
        assert_eq!(plain[0].score, plain[1].score); // the premise: a true text tie
        assert_eq!(plain[0].path, "notes/kettle-a.md");

        let f = frec(&[("notes/kettle-b.md", 2.0, 1_000)]);
        let hits = fuzzy_files(&recs, "kettle", 10, &f, 1_000);
        assert_eq!(hits[0].path, "notes/kettle-b.md");
        assert_eq!(hits[1].path, "notes/kettle-a.md");
    }

    /// Regression pin: with an empty frecency map, `fuzzy_files` must be
    /// byte-identical to the pre-frecency implementation (inlined here).
    #[test]
    fn empty_frecency_map_output_matches_the_pre_frecency_implementation() {
        fn fuzzy_files_v1(records: &[Arc<NoteRecord>], query: &str, limit: usize) -> Vec<FileHit> {
            let q = query.trim();
            if q.is_empty() {
                let mut all: Vec<(usize, &NoteRecord)> =
                    records.iter().enumerate().map(|(i, r)| (i, &**r)).collect();
                top_by_key(&mut all, limit, |&(i, r)| {
                    (Reverse(r.meta.pinned), Reverse(r.meta.updated), i)
                });
                return all
                    .into_iter()
                    .map(|(_, r)| file_hit(r, 0, Vec::new(), Vec::new()))
                    .collect();
            }
            MATCHER.with(|m| {
                let matcher = &mut *m.borrow_mut();
                let pattern = Pattern::parse(q, CaseMatching::Ignore, Normalization::Smart);
                let mut buf: Vec<char> = Vec::new();
                let mut scored: Vec<(u32, usize)> = Vec::new();
                for (i, r) in records.iter().enumerate() {
                    let path_score = pattern.score(Utf32Str::new(&r.meta.path, &mut buf), matcher);
                    let title_score =
                        pattern.score(Utf32Str::new(&r.meta.title, &mut buf), matcher);
                    if path_score.is_none() && title_score.is_none() {
                        continue;
                    }
                    let p = path_score.unwrap_or(0);
                    let t = title_score.map_or(0, |s| s.saturating_add(16));
                    scored.push((p.max(t), i));
                }
                top_by_key(&mut scored, limit, |&(score, i)| {
                    let r = &records[i];
                    (
                        Reverse(score),
                        Reverse(r.meta.pinned),
                        Reverse(r.meta.updated),
                        i,
                    )
                });
                let mut indices: Vec<u32> = Vec::new();
                scored
                    .into_iter()
                    .map(|(score, i)| {
                        let r = &records[i];
                        let positions =
                            fuzzy_match(&pattern, matcher, &r.meta.path, &mut buf, &mut indices)
                                .map_or_else(Vec::new, |m| m.1);
                        let title_positions =
                            fuzzy_match(&pattern, matcher, &r.meta.title, &mut buf, &mut indices)
                                .map_or_else(Vec::new, |m| m.1);
                        file_hit(r, score, positions, title_positions)
                    })
                    .collect()
            })
        }

        let recs = vec![
            rec_with_title("notes/kettle.md", "Kettle", "", false, 3),
            rec_with_title("notes/kettle-two.md", "Kettle Two", "", true, 1),
            rec_with_title("journal/keymap.md", "Keymap", "", false, 7),
            rec_with_title("ideas/kelp.md", "Kelp", "", false, 7),
            rec_with_title("welcome.md", "Welcome", "", true, 0),
        ];
        let empty = HashMap::new();
        for (query, limit) in [("", 10), ("", 2), ("kettle", 10), ("ke", 3), ("k", 2)] {
            assert_eq!(
                serde_json::to_string(&fuzzy_files(&recs, query, limit, &empty, 12345)).unwrap(),
                serde_json::to_string(&fuzzy_files_v1(&recs, query, limit)).unwrap(),
                "diverged for query {query:?} limit {limit}"
            );
        }
    }
}
