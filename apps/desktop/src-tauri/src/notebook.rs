use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::UNIX_EPOCH;

use walkdir::WalkDir;

use crate::models::NoteMeta;

/// One indexed note: metadata + the full raw file text (the editor edits this).
#[derive(Debug, Clone)]
pub struct NoteRecord {
    pub meta: NoteMeta,
    pub body: String,
}

/// Walk a notebook folder and read every Markdown file into a record. Hidden
/// directories (including `.noteside/` and `.git/`) are skipped. The reads fan
/// out across threads, then the result is sorted by path: a scan must be
/// deterministic because wikilink resolution tie-breaks on the first record.
/// Records come `Arc`-wrapped: the index treats them as immutable values, so
/// state mutations shallow-copy the index instead of cloning note bodies.
pub fn scan_notebook(root: &Path) -> Vec<Arc<NoteRecord>> {
    let paths: Vec<PathBuf> = WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| !is_hidden(e.path()))
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_type().is_file() && e.path().extension().and_then(|x| x.to_str()) == Some("md")
        })
        .map(|e| e.into_path())
        .collect();

    let workers = std::thread::available_parallelism()
        .map_or(1, |n| n.get())
        .min(paths.len());
    let read_all = |paths: &[PathBuf]| -> Vec<Arc<NoteRecord>> {
        paths
            .iter()
            .filter_map(|p| read_record(root, p).ok().map(Arc::new))
            .collect()
    };
    let mut out: Vec<Arc<NoteRecord>> = if workers <= 1 {
        read_all(&paths)
    } else {
        let chunk_len = paths.len().div_ceil(workers);
        std::thread::scope(|s| {
            let handles: Vec<_> = paths
                .chunks(chunk_len)
                .map(|chunk| s.spawn(move || read_all(chunk)))
                .collect();
            handles
                .into_iter()
                .flat_map(|h| h.join().expect("scan worker panicked"))
                .collect()
        })
    };
    out.sort_unstable_by(|a, b| a.meta.path.cmp(&b.meta.path));
    out
}

fn is_hidden(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.starts_with('.'))
        .unwrap_or(false)
}

/// Join a client-supplied relative note path onto the notebook root, rejecting any
/// path that is absolute or contains `..` so it can't escape the notebook.
pub fn safe_join(root: &Path, rel: &str) -> Option<PathBuf> {
    let p = Path::new(rel);
    if p.is_absolute() {
        return None;
    }
    for c in p.components() {
        match c {
            Component::Normal(_) | Component::CurDir => {}
            _ => return None,
        }
    }
    Some(root.join(p))
}

/// Resolve a client-supplied note path and reject anything that is not a
/// Markdown note inside the notebook.
pub fn safe_note_path(root: &Path, rel: &str) -> Option<PathBuf> {
    let abs = safe_join(root, rel)?;
    if abs.extension().and_then(|e| e.to_str()) != Some("md") {
        return None;
    }
    Some(abs)
}

pub fn rel_path(root: &Path, abs: &Path) -> String {
    abs.strip_prefix(root)
        .unwrap_or(abs)
        .to_string_lossy()
        .replace('\\', "/")
}

pub fn read_record(root: &Path, abs: &Path) -> std::io::Result<NoteRecord> {
    // One open handle serves the stat (mtime + size hint) and the read — no
    // second path lookup per file.
    let mut f = fs::File::open(abs)?;
    let stat = f.metadata().ok();
    let updated = stat
        .as_ref()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let mut text = String::with_capacity(stat.map_or(0, |m| m.len() as usize));
    f.read_to_string(&mut text)?;
    let rel = rel_path(root, abs);
    let meta = parse_meta(rel, &text, updated);
    Ok(NoteRecord { meta, body: text })
}

pub fn mtime_millis(abs: &Path) -> i64 {
    fs::metadata(abs)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Derive note metadata from the raw file text. Title precedence:
/// frontmatter `title:` → first heading / non-blank line → prettified filename.
pub fn parse_meta(rel: String, text: &str, updated: i64) -> NoteMeta {
    let (frontmatter, body_start) = split_frontmatter(text);
    let mut tags = Vec::new();
    let mut pinned = false;
    let mut created = None;
    let mut fm_title = None;
    if let Some(fm) = frontmatter {
        for line in fm.lines() {
            let line = line.trim();
            if let Some(v) = line.strip_prefix("title:") {
                fm_title = Some(v.trim().trim_matches('"').trim_matches('\'').to_string());
            } else if let Some(v) = line.strip_prefix("tags:") {
                tags = parse_tags(v);
            } else if let Some(v) = line.strip_prefix("created:") {
                created = Some(v.trim().to_string());
            } else if let Some(v) = line.strip_prefix("pinned:") {
                pinned = matches!(v.trim(), "true" | "yes" | "1");
            }
        }
    }
    let title = fm_title
        .filter(|s| !s.is_empty())
        .or_else(|| heading_title(&text[body_start..]))
        .unwrap_or_else(|| filename_title(&rel));
    NoteMeta {
        id: rel.clone(),
        path: rel,
        title,
        tags,
        created,
        updated,
        pinned,
    }
}

/// If the text opens with a `---` fenced YAML block, return its inner text and
/// the byte offset where the body begins. Tolerant: malformed → no frontmatter.
fn split_frontmatter(text: &str) -> (Option<&str>, usize) {
    let rest = match text
        .strip_prefix("---\n")
        .or_else(|| text.strip_prefix("---\r\n"))
    {
        Some(r) => r,
        None => return (None, 0),
    };
    let header_len = text.len() - rest.len();
    let mut idx = 0;
    for line in rest.split_inclusive('\n') {
        if line.trim_end() == "---" {
            let fm = &rest[..idx];
            return (Some(fm), header_len + idx + line.len());
        }
        idx += line.len();
    }
    (None, 0)
}

fn heading_title(body: &str) -> Option<String> {
    for line in body.lines() {
        let t = line.trim();
        if t.is_empty() {
            continue;
        }
        let t = t.trim_start_matches('#').trim();
        if !t.is_empty() {
            return Some(t.to_string());
        }
    }
    None
}

fn filename_title(rel: &str) -> String {
    let name = rel.rsplit('/').next().unwrap_or(rel);
    let stem = name.strip_suffix(".md").unwrap_or(name);
    let s = stem.replace(['-', '_'], " ");
    if s.trim().is_empty() {
        "Untitled".to_string()
    } else {
        s
    }
}

fn parse_tags(v: &str) -> Vec<String> {
    v.trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .split(',')
        .map(|s| s.trim().trim_matches('"').trim_matches('\'').to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// Crash-safe write: write to a sibling temp file, fsync, then atomically
/// rename over the target so a reader never sees a half-written file.
pub fn atomic_write(abs: &Path, text: &str) -> std::io::Result<()> {
    if let Some(dir) = abs.parent() {
        fs::create_dir_all(dir)?;
    }
    let file_name = abs
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("note.md");
    let tmp = abs.with_file_name(format!(".{file_name}.tmp"));
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(text.as_bytes())?;
        f.sync_all()?;
    }
    fs::rename(&tmp, abs)?;
    Ok(())
}

/// Build a filesystem-safe slug from a title.
pub fn slugify(title: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in title.trim().chars() {
        if ch.is_alphanumeric() {
            out.extend(ch.to_lowercase());
            prev_dash = false;
        } else if !prev_dash && !out.is_empty() {
            out.push('-');
            prev_dash = true;
        }
    }
    let slug = out.trim_matches('-').to_string();
    if slug.is_empty() {
        "untitled".to_string()
    } else {
        slug
    }
}

/// True if a filename `stem` already represents `slug` — either exactly, or as a
/// `<slug>-N` collision variant. Lets rename-on-save skip a file that is already a
/// correct name (so we don't churn `hello-2.md` → `hello-3.md` needlessly).
pub fn stem_matches_slug(stem: &str, slug: &str) -> bool {
    if stem == slug {
        return true;
    }
    match stem.strip_prefix(slug).and_then(|r| r.strip_prefix('-')) {
        Some(rest) => !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit()),
        None => false,
    }
}

/// Pick a unique `<slug>.md` (or `<slug>-N.md`) path within the notebook root.
pub fn unique_note_path(root: &Path, slug: &str) -> PathBuf {
    let first = root.join(format!("{slug}.md"));
    if !first.exists() {
        return first;
    }
    let mut n = 2;
    loop {
        let candidate = root.join(format!("{slug}-{n}.md"));
        if !candidate.exists() {
            return candidate;
        }
        n += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_join_rejects_traversal_and_absolute() {
        let root = Path::new("/notebook");
        assert!(safe_join(root, "a.md").is_some());
        assert!(safe_join(root, "notes/a.md").is_some());
        assert!(safe_join(root, "./a.md").is_some());
        assert!(safe_join(root, "../secret").is_none());
        assert!(safe_join(root, "notes/../../escape").is_none());
        assert!(safe_join(root, "/etc/passwd").is_none());
    }

    #[test]
    fn safe_note_path_requires_markdown() {
        let root = Path::new("/notebook");
        assert!(safe_note_path(root, "a.md").is_some());
        assert!(safe_note_path(root, "notes/a.md").is_some());
        assert!(safe_note_path(root, "notes/a.txt").is_none());
        assert!(safe_note_path(root, ".git/config").is_none());
        assert!(safe_note_path(root, "../a.md").is_none());
    }

    #[test]
    fn slugify_basics() {
        assert_eq!(slugify("Hello World"), "hello-world");
        assert_eq!(slugify("  Spaces  & punctuation!! "), "spaces-punctuation");
        assert_eq!(slugify(""), "untitled");
        assert_eq!(slugify("---"), "untitled");
    }

    #[test]
    fn stem_matches_slug_exact_and_numbered() {
        assert!(stem_matches_slug("hello-world", "hello-world"));
        assert!(stem_matches_slug("hello-world-2", "hello-world")); // collision variant
        assert!(stem_matches_slug("untitled-17", "untitled"));
        assert!(!stem_matches_slug("hello-world", "hello")); // different slug
        assert!(!stem_matches_slug("hello-world-x", "hello-world")); // suffix not numeric
        assert!(!stem_matches_slug("hello", "hello-world"));
    }

    #[test]
    fn title_from_frontmatter_wins() {
        let text = "---\ntitle: My Title\ntags: [a, b]\npinned: true\n---\n# Heading\nbody";
        let m = parse_meta("notes/x.md".into(), text, 0);
        assert_eq!(m.title, "My Title");
        assert_eq!(m.tags, vec!["a".to_string(), "b".to_string()]);
        assert!(m.pinned);
    }

    #[test]
    fn title_falls_back_to_heading_then_first_line_then_filename() {
        assert_eq!(
            parse_meta("x.md".into(), "# A Heading\n\ntext", 0).title,
            "A Heading"
        );
        assert_eq!(
            parse_meta("x.md".into(), "just a line\nmore", 0).title,
            "just a line"
        );
        assert_eq!(
            parse_meta("my-cool-note.md".into(), "", 0).title,
            "my cool note"
        );
    }

    #[test]
    fn frontmatter_handles_crlf() {
        let m = parse_meta("x.md".into(), "---\r\ntitle: CRLF Title\r\n---\r\nbody", 0);
        assert_eq!(m.title, "CRLF Title");
    }

    #[test]
    fn split_frontmatter_offsets_and_unclosed() {
        let text = "---\ntitle: x\n---\nbody line";
        let (fm, start) = split_frontmatter(text);
        assert_eq!(fm, Some("title: x\n"));
        assert_eq!(&text[start..], "body line");

        let (none, zero) = split_frontmatter("---\ntitle: x\nstill going");
        assert!(none.is_none());
        assert_eq!(zero, 0);
    }

    #[test]
    fn scan_notebook_is_path_sorted_and_skips_hidden_and_non_md() {
        let dir = std::env::temp_dir().join(format!("noteside-scan-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        for (path, body) in [
            ("zeta.md", "# Z"),
            ("alpha.md", "# A"),
            ("sub/nested.md", "# N"),
            ("sub/deeper/leaf.md", "# L"),
            ("notes.txt", "not md"),
            (".hidden/secret.md", "skipped"),
        ] {
            let p = dir.join(path);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(&p, body).unwrap();
        }
        let recs = scan_notebook(&dir);
        let paths: Vec<&str> = recs.iter().map(|r| r.meta.path.as_str()).collect();
        assert_eq!(
            paths,
            vec!["alpha.md", "sub/deeper/leaf.md", "sub/nested.md", "zeta.md"]
        );
        assert_eq!(recs[0].meta.title, "A");
        assert_eq!(recs[0].body, "# A");
        assert!(recs.iter().all(|r| r.meta.updated > 0));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn atomic_write_round_trip_no_temp_left() {
        let dir = std::env::temp_dir().join(format!("noteside-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let file = dir.join("sub").join("note.md");
        atomic_write(&file, "hello\nworld").unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "hello\nworld");
        assert!(!file.with_file_name(".note.md.tmp").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
