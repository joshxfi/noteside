// Bridges Vim ex-commands (`:w`, `:q`, `:find`, …) to the app. The Vim object is
// a global singleton, so commands are defined once and dispatch to whichever
// editor is currently mounted via a module-level handler registry.
import { Vim } from "@replit/codemirror-vim";
import type { EditorView } from "@codemirror/view";
import { wikilinkAt } from "../links";

export type AppCommand =
  | "find"
  | "grep"
  | "nav"
  | "settings"
  | "config"
  | "new"
  | "delete"
  | "palette"
  | "togglePreview"
  | "backlinks";

export interface EditorHandlers {
  view: EditorView;
  save: () => void;
  quit: () => void;
  saveQuit: () => void;
  command: (c: AppCommand) => void;
  followLink: (target: string) => void;
}

let active: EditorHandlers | null = null;
export function setActiveHandlers(h: EditorHandlers | null) {
  active = h;
}

// Insert-mode escape mapping (e.g. "jj" -> <Esc>), synced from Settings. Vim is
// a global singleton, so the mapping applies to whatever editor is mounted.
let currentEscMap = "";
export function setInsertEscape(seq: string) {
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
export function setUserKeymaps(lines: string[]) {
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
  Vim.defineEx("new", "new", () => active?.command("new"));
  Vim.defineEx("rm", "rm", () => active?.command("delete"));
  Vim.defineEx("palette", "palette", () => active?.command("palette"));
  Vim.defineEx("preview", "preview", () => active?.command("togglePreview"));
  Vim.defineEx("backlinks", "back", () => active?.command("backlinks"));

  // `:follow` (and `gf`) jumps to the note named by the [[wikilink]] under the
  // cursor. Reads the raw line/column, so it works regardless of live-preview.
  Vim.defineEx("follow", "follow", () => {
    const v = active?.view;
    if (!active || !v) return;
    const head = v.state.selection.main.head;
    const ln = v.state.doc.lineAt(head);
    const target = wikilinkAt(ln.text, head - ln.from);
    if (target) active.followLink(target);
  });
  Vim.map("gf", ":follow<CR>", "normal");

  // Leader: <Space> opens the command palette (which-key style).
  Vim.map("<Space>", ":palette<CR>", "normal");

  // Highlight all matches of the last search (vim :set hlsearch); :noh clears.
  try {
    Vim.setOption("hlsearch", true);
  } catch {
    /* option may be unavailable; ignore */
  }
}
