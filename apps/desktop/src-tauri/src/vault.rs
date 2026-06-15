use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use walkdir::WalkDir;

use crate::models::NoteMeta;

/// One indexed note: metadata + the full raw file text (the editor edits this).
#[derive(Debug, Clone)]
pub struct NoteRecord {
    pub meta: NoteMeta,
    pub body: String,
}

/// Walk a vault folder and read every Markdown file into a record. Hidden
/// directories (including `.noteside/` and `.git/`) are skipped.
pub fn scan_vault(root: &Path) -> Vec<NoteRecord> {
    let mut out = Vec::new();
    for entry in WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| !is_hidden(e.path()))
        .filter_map(|e| e.ok())
    {
        let p = entry.path();
        if !entry.file_type().is_file() {
            continue;
        }
        if p.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        if let Ok(rec) = read_record(root, p) {
            out.push(rec);
        }
    }
    out
}

fn is_hidden(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.starts_with('.'))
        .unwrap_or(false)
}

pub fn rel_path(root: &Path, abs: &Path) -> String {
    abs.strip_prefix(root)
        .unwrap_or(abs)
        .to_string_lossy()
        .replace('\\', "/")
}

pub fn read_record(root: &Path, abs: &Path) -> std::io::Result<NoteRecord> {
    let text = fs::read_to_string(abs)?;
    let rel = rel_path(root, abs);
    let meta = parse_meta(rel, &text, mtime_millis(abs));
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

/// Pick a unique `<slug>.md` (or `<slug>-N.md`) path within the vault root.
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
