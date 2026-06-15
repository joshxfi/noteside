// Bridges Vim ex-commands (`:w`, `:q`, `:find`, …) to the app. The Vim object is
// a global singleton, so commands are defined once and dispatch to whichever
// editor is currently mounted via a module-level handler registry.
import { Vim } from "@replit/codemirror-vim";
import type { EditorView } from "@codemirror/view";

export type AppCommand = "find" | "grep" | "nav" | "settings" | "config";

export interface EditorHandlers {
  view: EditorView;
  save: () => void;
  quit: () => void;
  saveQuit: () => void;
  command: (c: AppCommand) => void;
}

let active: EditorHandlers | null = null;
export function setActiveHandlers(h: EditorHandlers | null) {
  active = h;
}

let defined = false;
export function defineExCommands() {
  if (defined) return;
  defined = true;

  // `:w` / `:write`, `:wq`/`:x`, `:q`/`:quit` — note we intentionally leave `:set`
  // to codemirror-vim (vim options) and expose the Settings panel as `:settings`.
  Vim.defineEx("write", "w", () => active?.save());
  Vim.defineEx("wq", "wq", () => active?.saveQuit());
  Vim.defineEx("xit", "x", () => active?.saveQuit());
  Vim.defineEx("quit", "q", () => active?.quit());
  Vim.defineEx("find", "find", () => active?.command("find"));
  Vim.defineEx("files", "files", () => active?.command("find"));
  Vim.defineEx("grep", "grep", () => active?.command("grep"));
  Vim.defineEx("nav", "nav", () => active?.command("nav"));
  Vim.defineEx("settings", "settings", () => active?.command("settings"));
  Vim.defineEx("prefs", "prefs", () => active?.command("settings"));
  Vim.defineEx("config", "config", () => active?.command("config"));
}
