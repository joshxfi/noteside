// The backend contract. Two adapters implement it: `tauri` (real IPC to the
// Rust notebook) and `mock` (in-memory, for browser dev + the landing demo).
import type { Config } from "../settings";

export type GrepMode = "plain" | "regex" | "fuzzy";

export interface NoteMeta {
  id: string;
  path: string;
  title: string;
  tags: string[];
  created: string | null;
  updated: number; // unix ms
  pinned: boolean;
}

export interface NoteDoc extends NoteMeta {
  body: string; // full raw file text (frontmatter included)
}

/** A notebook (folder) the user has opened — the switcher's recents are these. */
export interface NotebookRef {
  path: string;
  name: string; // display name (the folder's basename)
  lastOpened: number; // unix ms; 0 when unknown (e.g. migrated from lastNotebook)
}

export interface FileHit {
  id: string;
  path: string;
  title: string;
  tags: string[];
  pinned: boolean;
  score: number;
  positions: number[]; // indices into `path`
  titlePositions: number[]; // indices into `title`
}

export interface ContentHit {
  id: string;
  path: string;
  title: string;
  lineNumber: number;
  line: string;
  ranges: [number, number][];
}

/** A note that links to the current one (one reference line per source note). */
export interface Backlink {
  id: string;
  title: string;
  lineNumber: number;
  line: string;
}

export interface Backend {
  /** true when backed by the real Rust notebook (vs the in-memory mock). */
  readonly live: boolean;
  pickNotebook(): Promise<string | null>;
  openNotebook(path: string): Promise<NoteMeta[]>;
  currentNotebook(): Promise<string | null>;
  /** Recently-opened notebooks, most-recent first — drives the switcher. */
  listNotebooks(): Promise<NotebookRef[]>;
  /** Record that `path` was opened: move it to the front of the recents list. */
  rememberNotebook(path: string): Promise<void>;
  /** Drop a notebook from the recents list (e.g. its folder no longer exists). */
  removeRecentNotebook(path: string): Promise<void>;
  /** Create a new notebook folder `name` under `parent`; returns its path (then
   *  the caller opens it). The name is sanitized to one path segment. */
  createNotebook(parent: string, name: string): Promise<string>;
  listNotes(): Promise<NoteMeta[]>;
  readNote(path: string): Promise<NoteDoc>;
  /** Preview text from the in-memory notebook index; opening still uses readNote. */
  previewNote(path: string): Promise<NoteDoc>;
  /** Notes that link to `noteId` via [[wikilinks]] — scanned backend-side. */
  backlinks(noteId: string): Promise<Backlink[]>;
  saveNote(path: string, body: string): Promise<NoteMeta>;
  /** Rename a note's file so its slug matches its title. No-op (returns the current
   *  meta) when the filename already represents the title. Title-based [[links]] survive. */
  renameNote(path: string): Promise<NoteMeta>;
  createNote(title?: string): Promise<NoteMeta>;
  /** Copy a note to a "<title> copy" sibling (same directory, retitled so the two
   *  don't share a title); returns the new note's meta. */
  duplicateNote(path: string): Promise<NoteMeta>;
  /** Rename a note by setting its title — rewrites the title in the body and
   *  renames the file to the new slug. Title-based [[links]] follow. */
  retitleNote(path: string, title: string): Promise<NoteMeta>;
  /** Reveal a note's file in the OS file manager. Native only — a no-op in the mock. */
  revealNote(path: string): Promise<void>;
  deleteNote(path: string): Promise<void>;
  /** A user opened this note (finder/sidebar/link/step — NOT watcher reloads).
   *  Feeds the frecency ranking in searchFiles; best-effort, fire-and-forget. */
  recordOpen(path: string): Promise<void>;
  searchFiles(query: string): Promise<FileHit[]>;
  searchContent(query: string, mode: GrepMode): Promise<ContentHit[]>;
  getConfig(): Promise<Partial<Config> | null>;
  setConfig(cfg: Config): Promise<void>;
  getLastNotebook(): Promise<string | null>;
  setLastNotebook(path: string): Promise<void>;
  /** Subscribe to external notebook changes (watcher); resolves to an unsubscribe fn. */
  watchNotebook(onChange: () => void): Promise<() => void>;
}
