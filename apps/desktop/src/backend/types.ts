// The backend contract. Two adapters implement it: `tauri` (real IPC to the
// Rust vault) and `mock` (in-memory, for browser dev + the landing demo).
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

export interface FileHit {
  id: string;
  path: string;
  title: string;
  tags: string[];
  pinned: boolean;
  score: number;
  positions: number[]; // indices into `path`
}

export interface ContentHit {
  id: string;
  path: string;
  title: string;
  lineNumber: number;
  line: string;
  ranges: [number, number][];
}

export interface Backend {
  /** true when backed by the real Rust vault (vs the in-memory mock). */
  readonly live: boolean;
  pickVault(): Promise<string | null>;
  openVault(path: string): Promise<NoteMeta[]>;
  currentVault(): Promise<string | null>;
  listNotes(): Promise<NoteMeta[]>;
  readNote(path: string): Promise<NoteDoc>;
  saveNote(path: string, body: string): Promise<NoteMeta>;
  createNote(title?: string): Promise<NoteMeta>;
  deleteNote(path: string): Promise<void>;
  searchFiles(query: string): Promise<FileHit[]>;
  searchContent(query: string, mode: GrepMode): Promise<ContentHit[]>;
  getConfig(): Promise<Partial<Config> | null>;
  setConfig(cfg: Config): Promise<void>;
  getLastVault(): Promise<string | null>;
  setLastVault(path: string): Promise<void>;
  /** Subscribe to external vault changes (watcher); resolves to an unsubscribe fn. */
  watchVault(onChange: () => void): Promise<() => void>;
}
