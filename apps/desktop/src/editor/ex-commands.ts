// Bridges Vim ex-commands (`:w`, `:q`, `:find`, …) to the app. The Vim object is
// a global singleton, so commands are defined once and dispatch to whichever
// editor is currently mounted via a module-level handler registry.
import { Vim } from "@replit/codemirror-vim";
import type { EditorView } from "@codemirror/view";
import { urlAt } from "../links";
import { COMMANDS, type Command } from "./commands";
import { registerVimApplier } from "./vim-config";

export type AppCommand =
  | "find"
  | "grep"
  | "notebooks"
  | "nav"
  | "settings"
  | "theme"
  | "config"
  | "new"
  | "delete"
  | "duplicate"
  | "reveal"
  | "rename"
  | "palette"
  | "commands"
  | "togglePreview"
  | "reopen"
  | "nextNote"
  | "prevNote"
  | "fontUp"
  | "fontDown"
  | "fontReset"
  | "uiUp"
  | "uiDown"
  | "uiReset"
  | "cheatsheet";

export interface EditorHandlers {
  view: EditorView;
  save: () => void;
  quit: () => void;
  saveQuit: () => void;
  command: (c: AppCommand) => void;
  openUrl: (url: string) => void;
}

let active: EditorHandlers | null = null;
export function setActiveHandlers(h: EditorHandlers | null) {
  active = h;
}

// Insert-mode escape mapping (e.g. "jj" -> <Esc>), synced from Settings. Vim is
// a global singleton, so the mapping applies to whatever editor is mounted.
// App sets these through the CM-free vim-config bridge (this chunk is lazy).
let currentEscMap = "";
function applyInsertEscape(seq: string) {
  if (seq === currentEscMap) return;
  if (currentEscMap) {
    try {
      Vim.unmap(currentEscMap, "insert");
    } catch {
      /* ignore */
    }
  }
  currentEscMap = seq;
  if (seq) {
    try {
      Vim.map(seq, "<Esc>", "insert");
    } catch {
      /* ignore */
    }
  }
}

// User keymaps from ~/.notesiderc (e.g. "nmap <Space>w :w<CR>"), applied via Vim.
let appliedKeymaps: { lhs: string; ctx: string }[] = [];
function keymapCtx(cmd: string): string {
  const c = cmd.toLowerCase();
  if (c.startsWith("v")) return "visual";
  if (c.startsWith("i")) return "insert";
  return "normal";
}
function applyUserKeymaps(lines: string[]) {
  for (const { lhs, ctx } of appliedKeymaps) {
    try {
      Vim.unmap(lhs, ctx);
    } catch {
      /* ignore */
    }
  }
  appliedKeymaps = [];
  for (const raw of lines) {
    const m = raw.trim().match(/^(\w+)\s+(\S+)\s+(.+)$/);
    if (!m) continue;
    const [, cmd, lhs, rhs] = m;
    const ctx = keymapCtx(cmd);
    try {
      if (cmd.toLowerCase().includes("noremap")) Vim.noremap(lhs, rhs, ctx);
      else Vim.map(lhs, rhs, ctx);
      appliedKeymaps.push({ lhs, ctx });
    } catch {
      /* ignore invalid mapping */
    }
  }
}
registerVimApplier({ escMap: applyInsertEscape, keymaps: applyUserKeymaps });

// `:follow` (and `gx`): open the http(s)/mailto URL under the cursor (bare or a
// markdown `[text](url)` target) in the browser. Reads the raw line/column, so
// it works regardless of live-preview.
function runFollow() {
  const v = active?.view;
  if (!active || !v) return;
  const head = v.state.selection.main.head;
  const ln = v.state.doc.lineAt(head);
  const url = urlAt(ln.text, head - ln.from);
  if (url) active.openUrl(url);
}

function runEx(c: Command) {
  if (c.command) active?.command(c.command);
  else if (c.editor === "save") active?.save();
  else if (c.editor === "quit") active?.quit();
  else if (c.editor === "saveQuit") active?.saveQuit();
  else if (c.editor === "follow") runFollow();
}

let defined = false;
export function defineExCommands() {
  if (defined) return;
  defined = true;

  // Every command's `:ex` names dispatch through the shared handler registry.
  // (`:set` is intentionally left to codemirror-vim for vim options.)
  for (const c of COMMANDS) {
    if (!c.ex) continue;
    for (const name of c.ex) Vim.defineEx(name, name, () => runEx(c));
  }

  // `gx` opens the URL under the cursor; `<Space>` opens the leader palette.
  Vim.map("gx", ":follow<CR>", "normal");
  Vim.map("<Space>", ":palette<CR>", "normal");

  // Highlight all matches of the last search (vim :set hlsearch); :noh clears.
  try {
    Vim.setOption("hlsearch", true);
  } catch {
    /* option may be unavailable; ignore */
  }
}
