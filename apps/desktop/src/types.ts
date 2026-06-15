// Shared types for the Noteside desktop app.

export type GitStatus = "modified" | "untracked" | "staged" | "deleted" | "renamed" | null;

export interface Note {
  id: string;
  title: string;
  path: string;
  tag: string;
  updated: string;
  git: GitStatus;
  frecency: number;
  body: string;
}

export type Mode = "normal" | "insert" | "visual" | "command" | "search";

export interface Pos {
  row: number;
  col: number;
}

export interface Register {
  text: string;
  linewise: boolean;
}

export interface Snapshot {
  lines: string[];
  row: number;
  col: number;
}

export interface VimState {
  lines: string[];
  row: number;
  col: number;
  desired: number;
  mode: Mode;
  pending: string; // 'g' | 'd' | 'r'
  count: string;
  cmd: string;
  lastSearch: string;
  anchor: Pos | null;
  register: Register;
  history: Snapshot[];
  redo: Snapshot[];
  message: string;
  keylog: string[];
  iseq: string;
}

export interface KeyMods {
  ctrl?: boolean;
  meta?: boolean;
  alt?: boolean;
}

export type VimAction =
  | "save"
  | "quit"
  | "savequit"
  | "settings"
  | "config"
  | "nav"
  | "find"
  | "grep"
  | null;

export interface HandleOpts {
  escMap?: string;
  vimMode?: boolean;
}

export interface SelRange {
  s: Pos;
  e: Pos;
}
