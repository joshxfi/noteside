use serde::{Deserialize, Serialize};

/// Note metadata for the sidebar/list and search results. `id` is the
/// vault-relative path (stable enough for v1; renames produce a new id).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteMeta {
    pub id: String,
    pub path: String,
    pub title: String,
    pub tags: Vec<String>,
    pub created: Option<String>,
    /// File mtime in unix milliseconds; the frontend formats it relatively.
    pub updated: i64,
    pub pinned: bool,
}

/// A full note: metadata plus the raw file text (frontmatter included). The
/// editor edits this text directly — files-as-truth.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteDoc {
    #[serde(flatten)]
    pub meta: NoteMeta,
    pub body: String,
}

/// A fuzzy file/title match. `positions` index into `path` for highlighting.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHit {
    pub id: String,
    pub path: String,
    pub title: String,
    pub tags: Vec<String>,
    pub pinned: bool,
    pub score: u32,
    pub positions: Vec<u32>,
}

/// A single line-level content match. `ranges` are byte offsets into `line`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentHit {
    pub id: String,
    pub path: String,
    pub title: String,
    pub line_number: u32,
    pub line: String,
    pub ranges: Vec<[u32; 2]>,
}
