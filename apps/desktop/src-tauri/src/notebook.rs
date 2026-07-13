use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
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
/// out across threads, then the result is sorted by path so by-path lookups can
/// binary-search and the ordering stays deterministic. Records come
/// `Arc`-wrapped: the index treats them as immutable values, so state mutations
/// shallow-copy the index instead of cloning note bodies.
pub fn scan_notebook(root: &Path) -> std::io::Result<Vec<Arc<NoteRecord>>> {
    let mut paths = Vec::new();
    for entry in WalkDir::new(root)
        .into_iter()
        // A dot-prefixed notebook root is a valid user choice; only descendants
        // are hidden entries that should prune their subtree.
        .filter_entry(|e| e.depth() == 0 || !is_hidden(e.path()))
    {
        let entry = entry.map_err(walk_error)?;
        if entry.file_type().is_file()
            && entry.path().extension().and_then(|x| x.to_str()) == Some("md")
        {
            paths.push(entry.into_path());
        }
    }

    let workers = std::thread::available_parallelism()
        .map_or(1, |n| n.get())
        .min(paths.len());
    let read_all = |paths: &[PathBuf]| -> std::io::Result<Vec<Arc<NoteRecord>>> {
        paths
            .iter()
            .map(|p| read_record(root, p).map(Arc::new))
            .collect()
    };
    let mut out = if workers <= 1 {
        read_all(&paths)?
    } else {
        let chunk_len = paths.len().div_ceil(workers);
        std::thread::scope(|s| {
            let handles: Vec<_> = paths
                .chunks(chunk_len)
                .map(|chunk| s.spawn(move || read_all(chunk)))
                .collect();
            handles
                .into_iter()
                .map(|h| {
                    h.join()
                        .map_err(|_| std::io::Error::other("scan worker panicked"))?
                })
                .collect::<std::io::Result<Vec<_>>>()
                .map(|chunks| chunks.into_iter().flatten().collect::<Vec<_>>())
        })?
    };
    out.sort_unstable_by(|a, b| a.meta.path.cmp(&b.meta.path));
    Ok(out)
}

fn walk_error(error: walkdir::Error) -> std::io::Error {
    error
        .into_io_error()
        .unwrap_or_else(|| std::io::Error::other("invalid notebook walk entry"))
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
    if Path::new(rel).components().any(
        |c| matches!(c, Component::Normal(n) if n.to_str().is_some_and(|s| s.starts_with('.'))),
    ) {
        return None;
    }
    // Lexical `..` rejection is insufficient when a normal component is a
    // symlink. Canonicalize the target when it exists, otherwise its nearest
    // existing parent, and require the resolved location to remain under root.
    let canonical_root = fs::canonicalize(root).ok()?;
    let resolved = if abs.exists() {
        fs::canonicalize(&abs).ok()?
    } else {
        let parent = fs::canonicalize(abs.parent()?).ok()?;
        parent.join(abs.file_name()?)
    };
    resolved.starts_with(&canonical_root).then_some(abs)
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

/// Rewrite `text` so `parse_meta` derives `new_title`, preserving all other
/// content. Mirrors the title-precedence in `parse_meta` (frontmatter → heading /
/// first line → filename): update a frontmatter `title:` if present, else replace
/// a leading `# heading` line, else prepend one. Used by duplicate/retitle.
pub fn set_title(text: &str, new_title: &str) -> String {
    let (frontmatter, body_start) = split_frontmatter(text);
    if frontmatter.is_some() {
        let header = &text[..body_start];
        let body = &text[body_start..];
        // (a) an explicit frontmatter `title:` is authoritative — replace just
        //     that line (every other byte + line ending preserved) and leave the
        //     body alone (its heading, if any, may be unrelated to the title).
        if let Some((idx, seg)) = header
            .split_inclusive('\n')
            .enumerate()
            .find(|(_, seg)| line_body(seg).trim_start().starts_with("title:"))
        {
            let content = line_body(seg);
            let indent = &content[..content.len() - content.trim_start().len()];
            return replace_line_at(text, idx, &format!("{indent}title: {new_title}"));
        }
        // (b) frontmatter without a `title:`, but the body has a heading — retitle
        //     THAT (parse_meta falls back to it), so the visible title never
        //     diverges from the filename/metadata by leaving a stale heading.
        if let Some(retitled) = retitle_leading_heading(body, new_title) {
            return format!("{header}{retitled}");
        }
        // (c) no title anywhere — insert one right after the opening `---`.
        let nl = if header.contains("\r\n") {
            "\r\n"
        } else {
            "\n"
        };
        let after_open = header.find('\n').map(|i| i + 1).unwrap_or(header.len());
        return format!(
            "{}title: {new_title}{nl}{}{body}",
            &header[..after_open],
            &header[after_open..],
        );
    }
    // no frontmatter: retitle a leading heading, else prepend one.
    if let Some(retitled) = retitle_leading_heading(text, new_title) {
        return retitled;
    }
    format!("# {new_title}\n\n{text}")
}

/// The content of a `split_inclusive('\n')` segment without its trailing
/// `\n`/`\r\n` (the final, unterminated line yields an empty terminator).
fn line_body(seg: &str) -> &str {
    let s = seg.strip_suffix('\n').unwrap_or(seg);
    s.strip_suffix('\r').unwrap_or(s)
}

/// Rebuild `text` with its `idx`-th line (0-based, split on `\n`) replaced by
/// `new_content`, keeping that line's terminator and every other byte verbatim —
/// so retitling a CRLF note leaves it CRLF instead of silently normalizing to LF.
fn replace_line_at(text: &str, idx: usize, new_content: &str) -> String {
    let mut out = String::with_capacity(text.len() + new_content.len());
    for (j, seg) in text.split_inclusive('\n').enumerate() {
        if j == idx {
            out.push_str(new_content);
            out.push_str(&seg[line_body(seg).len()..]);
        } else {
            out.push_str(seg);
        }
    }
    out
}

/// If the first non-blank line of `text` is a `#`-heading, return `text` with it
/// rewritten to `<hashes> new_title` (level kept, terminators + other lines
/// verbatim); `None` when there's no leading heading (caller prepends one).
fn retitle_leading_heading(text: &str, new_title: &str) -> Option<String> {
    for (idx, seg) in text.split_inclusive('\n').enumerate() {
        let content = line_body(seg);
        if content.trim().is_empty() {
            continue;
        }
        let after_ws = content.trim_start();
        if !after_ws.starts_with('#') {
            return None; // first non-blank line isn't a heading
        }
        let hashes: String = after_ws.chars().take_while(|&c| c == '#').collect();
        return Some(replace_line_at(text, idx, &format!("{hashes} {new_title}")));
    }
    None
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

static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn unique_temp_path(abs: &Path) -> PathBuf {
    let file_name = abs
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("note.md");
    let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    abs.with_file_name(format!(
        ".{file_name}.tmp-{}-{sequence}",
        std::process::id()
    ))
}

fn create_unique_temp(abs: &Path) -> std::io::Result<(PathBuf, fs::File)> {
    loop {
        let tmp = unique_temp_path(abs);
        match OpenOptions::new().write(true).create_new(true).open(&tmp) {
            Ok(file) => return Ok((tmp, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
}

#[cfg(unix)]
fn sync_directory(dir: &Path) -> std::io::Result<()> {
    fs::File::open(dir)?.sync_all()
}

#[cfg(not(unix))]
fn sync_directory(_dir: &Path) -> std::io::Result<()> {
    Ok(())
}

/// Crash-safe write: write to a unique sibling temp file, fsync, then atomically
/// rename over the target so a reader never sees a half-written file. Existing
/// permissions are retained and the parent directory entry is synced on Unix.
pub fn atomic_write(abs: &Path, text: &str) -> std::io::Result<()> {
    let dir = abs
        .parent()
        .ok_or_else(|| std::io::Error::other("note has no parent directory"))?;
    fs::create_dir_all(dir)?;
    let existing_permissions = fs::metadata(abs).ok().map(|m| m.permissions());
    let (tmp, mut f) = create_unique_temp(abs)?;
    let result = (|| {
        f.write_all(text.as_bytes())?;
        if let Some(permissions) = existing_permissions {
            f.set_permissions(permissions)?;
        }
        f.sync_all()?;
        drop(f);
        fs::rename(&tmp, abs)?;
        sync_directory(dir)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// Remove a note and durably record the directory-entry change. Missing notes
/// are idempotent successes, matching delete command semantics.
pub fn remove_note(abs: &Path) -> std::io::Result<()> {
    match fs::remove_file(abs) {
        Ok(()) => {
            if let Some(dir) = abs.parent() {
                sync_directory(dir)?;
            }
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

/// Build a filesystem-safe slug from a title. ASCII-only: mirrors the JS
/// `slugifyTitle` byte-for-byte (so the rename pre-check agrees across the IPC
/// boundary — see src/test-vectors/parity.json). Non-ASCII and punctuation
/// collapse to a single '-'; falls back to "untitled".
pub fn slugify(title: &str) -> String {
    let mut out = String::new();
    let mut in_dash = false;
    for ch in title.trim().to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            in_dash = false;
        } else if !in_dash {
            out.push('-');
            in_dash = true;
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

fn candidate_note_path(root: &Path, slug: &str, n: usize) -> PathBuf {
    if n == 1 {
        root.join(format!("{slug}.md"))
    } else {
        root.join(format!("{slug}-{n}.md"))
    }
}

/// Publish a fully-written temp file without replacing an existing destination.
/// Hard links provide an atomic complete-file publication on normal desktop
/// filesystems. The create-new copy fallback retains no-clobber behavior on
/// filesystems without hard links (at the cost of brief partial visibility).
fn publish_temp_noclobber(tmp: &Path, candidate: &Path) -> std::io::Result<bool> {
    match fs::hard_link(tmp, candidate) {
        Ok(()) => return Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => return Ok(false),
        Err(_) => {}
    }
    let mut destination = match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(candidate)
    {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => return Ok(false),
        Err(error) => return Err(error),
    };
    let copy_result = (|| {
        let mut source = fs::File::open(tmp)?;
        std::io::copy(&mut source, &mut destination)?;
        destination.sync_all()
    })();
    if let Err(error) = copy_result {
        drop(destination);
        let _ = fs::remove_file(candidate);
        return Err(error);
    }
    Ok(true)
}

/// Atomically create a complete new note at the first available slug path. A
/// hard-link publishes the fully-fsynced temp inode only when the destination
/// does not exist, eliminating the exists-check/write race and partial readers.
pub fn atomic_create_unique(root: &Path, slug: &str, text: &str) -> std::io::Result<PathBuf> {
    fs::create_dir_all(root)?;
    let (tmp, mut file) = create_unique_temp(&root.join(format!("{slug}.md")))?;
    let result = (|| {
        file.write_all(text.as_bytes())?;
        file.sync_all()?;
        drop(file);
        let mut n = 1;
        loop {
            let candidate = candidate_note_path(root, slug, n);
            match publish_temp_noclobber(&tmp, &candidate) {
                Ok(true) => break Ok(candidate),
                Ok(false) => n += 1,
                Err(error) => break Err(error),
            }
        }
    })();
    let _ = fs::remove_file(&tmp);
    let path = result?;
    sync_directory(root)?;
    Ok(path)
}

/// Move `old_abs` to the first available slug without ever replacing an existing
/// note. Linking then unlinking is same-directory and no-clobber; a failed unlink
/// removes the new link again so the original remains authoritative.
pub fn rename_unique(old_abs: &Path, root: &Path, slug: &str) -> std::io::Result<PathBuf> {
    let mut n = 1;
    loop {
        let candidate = candidate_note_path(root, slug, n);
        match publish_temp_noclobber(old_abs, &candidate) {
            Ok(true) => {
                if let Ok(permissions) = fs::metadata(old_abs).map(|m| m.permissions()) {
                    if let Err(error) = fs::set_permissions(&candidate, permissions) {
                        let _ = fs::remove_file(&candidate);
                        return Err(error);
                    }
                }
                if let Err(error) = fs::remove_file(old_abs) {
                    let _ = fs::remove_file(&candidate);
                    return Err(error);
                }
                sync_directory(root)?;
                return Ok(candidate);
            }
            Ok(false) => n += 1,
            Err(error) => return Err(error),
        }
    }
}

/// Publish retitled content at a unique destination, then remove the old path.
/// If removing the old path fails, clean up the new file so callers never observe
/// a reported failure with two authoritative copies.
pub fn retitle_unique(
    old_abs: &Path,
    root: &Path,
    slug: &str,
    text: &str,
) -> std::io::Result<PathBuf> {
    let candidate = atomic_create_unique(root, slug, text)?;
    if let Ok(permissions) = fs::metadata(old_abs).map(|m| m.permissions()) {
        if let Err(error) = fs::set_permissions(&candidate, permissions) {
            let _ = fs::remove_file(&candidate);
            return Err(error);
        }
    }
    if let Err(error) = fs::remove_file(old_abs) {
        let _ = fs::remove_file(&candidate);
        return Err(error);
    }
    sync_directory(root)?;
    Ok(candidate)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir(label: &str) -> PathBuf {
        let n = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!("noteside-{label}-{}-{n}", std::process::id()))
    }

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
        let root = test_dir("safe-path");
        fs::create_dir_all(root.join("notes")).unwrap();
        fs::write(root.join("a.md"), "a").unwrap();
        assert!(safe_note_path(&root, "a.md").is_some());
        assert!(safe_note_path(&root, "notes/a.md").is_some());
        assert!(safe_note_path(&root, "notes/a.txt").is_none());
        assert!(safe_note_path(&root, ".git/note.md").is_none());
        assert!(safe_note_path(&root, "../a.md").is_none());
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn safe_note_path_rejects_symlink_escape() {
        use std::os::unix::fs::symlink;

        let root = test_dir("safe-symlink-root");
        let outside = test_dir("safe-symlink-outside");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("secret.md"), "secret").unwrap();
        symlink(&outside, root.join("linked")).unwrap();
        assert!(safe_note_path(&root, "linked/secret.md").is_none());
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }

    // set_title must make parse_meta derive the new title, whatever the source of
    // the old one (frontmatter / heading / plain first line / empty).
    fn titled(text: &str) -> String {
        parse_meta("n.md".into(), text, 0).title
    }

    #[test]
    fn set_title_replaces_a_leading_heading() {
        let out = set_title("# Old Title\n\nbody text\n", "New Title");
        assert_eq!(out, "# New Title\n\nbody text\n");
        assert_eq!(titled(&out), "New Title");
    }

    #[test]
    fn set_title_preserves_heading_level_and_trailing_newline() {
        assert_eq!(set_title("## Old", "New"), "## New");
        assert_eq!(set_title("## Old\n", "New"), "## New\n");
    }

    #[test]
    fn set_title_updates_frontmatter_title() {
        let out = set_title("---\ntitle: Old\ntags: [a]\n---\n# ignored\nbody", "New");
        assert!(out.contains("title: New"));
        assert!(out.contains("tags: [a]"));
        assert_eq!(titled(&out), "New");
    }

    #[test]
    fn set_title_inserts_frontmatter_title_when_absent() {
        let out = set_title("---\ntags: [a]\n---\nbody", "New");
        assert_eq!(titled(&out), "New");
        assert!(out.contains("tags: [a]"));
    }

    #[test]
    fn set_title_prepends_heading_for_plain_or_empty_notes() {
        // plain first line isn't a heading → prepend, keeping the text
        let out = set_title("just some text\nmore", "New");
        assert_eq!(titled(&out), "New");
        assert!(out.contains("just some text"));
        // empty note
        assert_eq!(titled(&set_title("", "New")), "New");
    }

    #[test]
    fn set_title_retitles_the_body_heading_when_frontmatter_has_no_title() {
        // frontmatter without `title:` + a body heading: retitle the HEADING (not
        // insert a competing frontmatter title), so the visible H1 and the derived
        // title never diverge.
        let out = set_title("---\ntags: [work]\n---\n# Project Plan\ncontent", "Roadmap");
        assert_eq!(out, "---\ntags: [work]\n---\n# Roadmap\ncontent");
        assert_eq!(titled(&out), "Roadmap");
        assert!(!out.contains("title:")); // no frontmatter title injected
        assert!(!out.contains("Project Plan")); // old heading is gone, not stale
    }

    #[test]
    fn set_title_preserves_crlf_line_endings() {
        // retitling a CRLF note must not silently rewrite the whole file to LF.
        assert_eq!(set_title("# Old\r\nbody\r\n", "New"), "# New\r\nbody\r\n");
        assert_eq!(
            set_title("---\r\ntitle: Old\r\n---\r\nbody\r\n", "New"),
            "---\r\ntitle: New\r\n---\r\nbody\r\n"
        );
    }

    #[test]
    fn slugify_basics() {
        assert_eq!(slugify("Hello World"), "hello-world");
        assert_eq!(slugify("  Spaces  & punctuation!! "), "spaces-punctuation");
        assert_eq!(slugify(""), "untitled");
        assert_eq!(slugify("---"), "untitled");
    }

    #[test]
    fn slug_parity_matches_shared_vectors() {
        let raw = include_str!("../../src/test-vectors/parity.json");
        let v: serde_json::Value = serde_json::from_str(raw).unwrap();
        for case in v["slug"].as_array().unwrap() {
            let input = case["in"].as_str().unwrap();
            let expected = case["out"].as_str().unwrap();
            assert_eq!(slugify(input), expected, "slug parity for {input:?}");
        }
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
        let dir = test_dir("scan");
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
        let recs = scan_notebook(&dir).unwrap();
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
    fn scan_allows_a_dot_prefixed_notebook_root() {
        let base = test_dir("hidden-root");
        let root = base.join(".notes");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("visible.md"), "# Visible").unwrap();
        let recs = scan_notebook(&root).unwrap();
        assert_eq!(recs.len(), 1);
        assert_eq!(recs[0].meta.path, "visible.md");
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn scan_reports_an_unreadable_markdown_file_instead_of_dropping_it() {
        let dir = test_dir("scan-error");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("invalid.md"), [0xff, 0xfe]).unwrap();
        assert!(scan_notebook(&dir).is_err());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn atomic_write_round_trip_no_temp_left() {
        let dir = test_dir("atomic");
        let _ = std::fs::remove_dir_all(&dir);
        let file = dir.join("sub").join("note.md");
        atomic_write(&file, "hello\nworld").unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "hello\nworld");
        assert!(fs::read_dir(file.parent().unwrap())
            .unwrap()
            .all(|entry| !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains(".tmp-")));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_preserves_existing_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let dir = test_dir("atomic-mode");
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("note.md");
        fs::write(&file, "old").unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o640)).unwrap();
        atomic_write(&file, "new").unwrap();
        assert_eq!(
            fs::metadata(&file).unwrap().permissions().mode() & 0o777,
            0o640
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn concurrent_unique_creates_never_clobber_each_other() {
        let dir = Arc::new(test_dir("unique-create"));
        fs::create_dir_all(dir.as_ref()).unwrap();
        let barrier = Arc::new(std::sync::Barrier::new(8));
        let handles: Vec<_> = (0..8)
            .map(|i| {
                let dir = dir.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    atomic_create_unique(&dir, "note", &format!("body {i}"))
                })
            })
            .collect();
        let mut paths: Vec<_> = handles
            .into_iter()
            .map(|handle| handle.join().unwrap().unwrap())
            .collect();
        paths.sort();
        paths.dedup();
        assert_eq!(paths.len(), 8);
        let mut bodies: Vec<_> = paths
            .iter()
            .map(|path| fs::read_to_string(path).unwrap())
            .collect();
        bodies.sort();
        assert_eq!(
            bodies,
            (0..8).map(|i| format!("body {i}")).collect::<Vec<_>>()
        );
        let _ = fs::remove_dir_all(dir.as_ref());
    }

    #[test]
    fn unique_rename_and_retitle_preserve_existing_collisions() {
        let dir = test_dir("unique-move");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("target.md"), "existing").unwrap();
        let old = dir.join("old.md");
        fs::write(&old, "original").unwrap();
        let renamed = rename_unique(&old, &dir, "target").unwrap();
        assert_eq!(renamed.file_name().unwrap(), "target-2.md");
        assert_eq!(
            fs::read_to_string(dir.join("target.md")).unwrap(),
            "existing"
        );
        assert_eq!(fs::read_to_string(&renamed).unwrap(), "original");

        let retitled = retitle_unique(&renamed, &dir, "target", "retitled").unwrap();
        assert_eq!(retitled.file_name().unwrap(), "target-3.md");
        assert!(!renamed.exists());
        assert_eq!(fs::read_to_string(&retitled).unwrap(), "retitled");
        assert_eq!(
            fs::read_to_string(dir.join("target.md")).unwrap(),
            "existing"
        );
        let _ = fs::remove_dir_all(dir);
    }
}
