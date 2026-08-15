// settings.ts — config model + the ~/.notesiderc serialize/parse logic.
// The SettingsPanel component lives in components/settings-panel.tsx and consumes
// the metadata + helpers exported here. The full color palette is owned by the
// theme (themes.ts) — there is no separate accent knob.
import { DEFAULT_THEME, resolveThemeId } from "./themes";
import { isSafeChord } from "./shortcut";

export interface FontOption {
  id: string;
  label: string;
  stack: string;
  kind?: "serif" | "mono";
}

export interface Config {
  /** A theme id from themes.ts (e.g. "noteside-dark", "catppuccin-mocha"). */
  theme: string;
  editorFont: string;
  fontSize: number;
  lineHeight: number;
  /** Indent width in spaces — what Tab inserts and what CodeMirror indents by. */
  tabWidth: number;
  /** Interface-size multiplier — scales the UI chrome (not the editor). */
  uiScale: number;
  /** Sidebar width in px (drag the sidebar edge; double-click resets). */
  sidebarWidth: number;
  /** Show relative line numbers in the gutter (off = absolute). */
  relativeNumbers: boolean;
  cursor: "block" | "bar" | "underline";
  cursorBlink: boolean;
  /** Render markdown inline (Obsidian-style), hiding markup off the cursor line. */
  livePreview: boolean;
  /** Check GitHub for a newer release on launch (throttled). No auto-install —
   *  a found update just surfaces a badge + the About row's download link. */
  autoUpdateCheck: boolean;
  vimMode: boolean;
  escMap: string;
  /** Raw vim map lines (e.g. "nmap <Space>w :w<CR>"), applied via Vim.map. */
  keymaps: string[];
  /** Non-vim chord overrides from `bind` lines: command id → chord ("" = unbound). */
  chords: Record<string, string>;
  /** Lines the parser did not recognize, kept verbatim and re-emitted on
   *  serialize. The config buffer is a view of this object, not a real file, so
   *  without this a `:w` silently ate anything Noteside didn't understand —
   *  including the user's own comments (issue #24). */
  extraLines: string[];
}

// ---- option metadata ------------------------------------------------
export const EDITOR_FONTS: FontOption[] = [
  { id: "newsreader", label: "Newsreader", stack: '"Newsreader", Georgia, serif', kind: "serif" },
  { id: "spectral", label: "Spectral", stack: '"Spectral", Georgia, serif', kind: "serif" },
  {
    id: "plex-mono",
    label: "IBM Plex Mono",
    stack: '"IBM Plex Mono", ui-monospace, monospace',
    kind: "mono",
  },
  {
    id: "jetbrains",
    label: "JetBrains Mono",
    stack: '"JetBrains Mono", ui-monospace, monospace',
    kind: "mono",
  },
  {
    id: "geist-mono",
    label: "Geist Mono",
    stack: '"Geist Mono", ui-monospace, monospace',
    kind: "mono",
  },
];

// The interface font is fixed to Geist Mono (the `--mono` CSS var in styles.css);
// only the editor font is user-selectable.

export const ESC_PRESETS = [{ label: "Esc", value: "" }];

export const CONFIG_DEFAULTS: Config = {
  theme: DEFAULT_THEME,
  editorFont: "newsreader",
  fontSize: 19,
  lineHeight: 1.75,
  tabWidth: 2, // CodeMirror's own default indentUnit — unchanged for existing users
  uiScale: 1,
  sidebarWidth: 250,
  relativeNumbers: false,
  cursor: "block",
  cursorBlink: true,
  livePreview: true,
  autoUpdateCheck: true,
  // Default OFF (2026-08 pointer-parity reposition): a raw default must not
  // drop a new user into NORMAL mode. Onboarding still offers vim as an equal
  // door, and a stored config always wins over this default.
  vimMode: false,
  escMap: "",
  keymaps: [],
  chords: {},
  extraLines: [],
};

export const TAB_WIDTH_MIN = 1;
export const TAB_WIDTH_MAX = 8;

export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 420;
export const clampSidebarWidth = (w: number): number =>
  Math.round(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, w)));

// The comment lines serializeConfig writes. Held as constants so parseConfig can
// tell OUR boilerplate (regenerated every serialize) from a comment the user
// typed (preserved via extraLines) — one source, so the two can't drift and
// reopening the buffer can never duplicate a header.
const C = {
  header: '" ~/.notesiderc — Noteside configuration',
  howto: '" Edit any line and :w to apply. The Settings panel writes here too.',
  appearance: '" appearance',
  typography: '" typography',
  cursor: '" cursor',
  editor: '" editor',
  updates: '" updates',
  keys: '" keys',
  noEsc: '" imap jj <Esc>          (no insert-mode escape mapping set)',
  noMaps: '" nmap <Space>w :w<CR>   (custom key mappings go here)',
  noBinds: '" bind Ctrl-j find       (use Cmd/Ctrl/Alt or an F-key; bind none <cmd> to unbind)',
  extras: '" kept as written — Noteside does not recognize these lines',
} as const;
const GENERATED_COMMENTS: ReadonlySet<string> = new Set(Object.values(C));

const byId = <T extends { id: string }>(list: T[], id: string): T =>
  list.find((x) => x.id === id) || list[0];

export const fontStack = (id: string): string => byId(EDITOR_FONTS, id).stack;

// ---- config file <-> object ----------------------------------------
export function serializeConfig(c: Config): string {
  const eLabel = byId(EDITOR_FONTS, c.editorFont).label;
  const L: string[] = [];
  L.push(C.header);
  L.push(C.howto);
  L.push("");
  L.push(C.appearance);
  L.push(`set theme        = ${c.theme}`);
  L.push(`set sidebar-width = ${c.sidebarWidth}`);
  L.push("");
  L.push(C.typography);
  L.push(`set editor-font  = ${eLabel}`);
  L.push(`set font-size    = ${c.fontSize}`);
  L.push(`set line-height  = ${c.lineHeight}`);
  L.push(`set tab-width    = ${c.tabWidth}`);
  L.push(`set ui-scale     = ${Math.round(c.uiScale * 100)}%`);
  L.push("");
  L.push(C.cursor);
  L.push(`set cursor       = ${c.cursor}`);
  L.push(`set cursor-blink = ${c.cursorBlink ? "on" : "off"}`);
  L.push("");
  // live-preview and relative-numbers are ACCEPTED-BUT-INERT since the block
  // editor (no source preview, no gutter): parseConfig still understands every
  // spelling so old configs never error, but the keys are no longer emitted.
  L.push(C.updates);
  L.push(`set auto-update  = ${c.autoUpdateCheck ? "on" : "off"}`);
  L.push("");
  L.push(C.keys);
  L.push(`set vim          = ${c.vimMode ? "on" : "off"}`);
  if (c.escMap) L.push(`imap ${c.escMap} <Esc>`);
  else L.push(C.noEsc);
  if (c.keymaps.length) for (const km of c.keymaps) L.push(km);
  else L.push(C.noMaps);
  const binds = Object.entries(c.chords).filter(([, chord]) => !chord || isSafeChord(chord));
  if (binds.length) for (const [id, chord] of binds) L.push(`bind ${chord || "none"} ${id}`);
  else L.push(C.noBinds);
  // Anything Noteside didn't understand goes back out verbatim, so a round-trip
  // through the buffer is never lossy.
  if (c.extraLines.length) {
    L.push("");
    L.push(C.extras);
    for (const line of c.extraLines) L.push(line);
  }
  L.push("");
  return L.join("\n");
}

export function parseConfig(text: string, base: Config): Config {
  const c: Config = { ...base };
  c.escMap = ""; // an imap line re-enables it
  c.keymaps = []; // collected fresh from the map lines below
  c.chords = {}; // collected fresh from the bind lines below
  c.extraLines = []; // ditto — every line no rule below claims
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "");
  const matchFont = (list: FontOption[], val: string): string | null => {
    const n = norm(val);
    const f = list.find((x) => norm(x.label) === n || x.id === n);
    return f ? f.id : null;
  };
  // Both spellings recognized explicitly, so a typo ("set vim = onn") is a
  // parse FAILURE (line preserved + reported), never a silent false.
  const parseBool = (v: string): boolean | null =>
    /^(on|true|yes|1)$/i.test(v) ? true : /^(off|false|no|0)$/i.test(v) ? false : null;
  for (const raw of String(text).split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    // Our own boilerplate is regenerated on serialize, so drop it; a comment the
    // USER wrote falls through to extraLines and survives.
    if (GENERATED_COMMENTS.has(line)) continue;
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^imap\s+(\S+)\s+<esc>/i))) {
      c.escMap = m[1];
      continue;
    }
    // `bind <chord> <command-id>` rebinds a non-vim chord; `bind none <id>` unbinds it.
    if ((m = line.match(/^bind\s+(\S+)\s+(\S+)\s*$/i))) {
      if (/^none$/i.test(m[1])) c.chords[m[2]] = "";
      else if (isSafeChord(m[1])) c.chords[m[2]] = m[1];
      continue;
    }
    if (/^(n|v|i|o)?(nore)?map\s+\S+\s+.+$/i.test(line)) {
      c.keymaps.push(line);
      continue;
    }
    if ((m = line.match(/^set\s+([\w-]+)\s*=?\s*(.+?)\s*$/i))) {
      const key = m[1].toLowerCase(),
        val = m[2].trim();
      // A recognized key whose VALUE fails to resolve is not consumed either:
      // claiming the line would delete it from the buffer on the next open while
      // the toast said "config applied" — the same silent-eat issue #24 fixed
      // for unknown keys. It falls through to extraLines and the error toast.
      let known = true;
      if (key === "theme") {
        // Accept a theme id, an alias (light/dark), or a label. Dark/light-ish
        // strings ("dark mode") keep the pre-themes parser's tolerance; anything
        // else leaves the current value (an unknown theme name won't crash).
        const id = resolveThemeId(val);
        if (id) c.theme = id;
        else if (/dark/i.test(val)) c.theme = "noteside-dark";
        else if (/light/i.test(val)) c.theme = "noteside-light";
        else known = false;
      } else if (key === "editor-font") {
        const id = matchFont(EDITOR_FONTS, val);
        if (id) c.editorFont = id;
        else known = false;
      } else if (key === "font-size") {
        const v = parseInt(val, 10);
        if (!isNaN(v)) c.fontSize = Math.max(16, Math.min(28, v));
        else known = false;
      } else if (key === "line-height") {
        const v = parseFloat(val);
        if (!isNaN(v)) c.lineHeight = Math.max(1.4, Math.min(2.1, Math.round(v * 100) / 100));
        else known = false;
        // vim's own spellings are accepted: someone reaching for indent width
        // types `set tabstop=4` long before they read our key list (issue #24).
      } else if (["tab-width", "tabwidth", "tabstop", "ts", "shiftwidth", "sw"].includes(key)) {
        const v = parseInt(val, 10);
        if (!isNaN(v)) c.tabWidth = Math.max(TAB_WIDTH_MIN, Math.min(TAB_WIDTH_MAX, v));
        else known = false;
      } else if (key === "sidebar-width" || key === "sidebarwidth") {
        const v = parseInt(val, 10);
        if (!isNaN(v)) c.sidebarWidth = clampSidebarWidth(v);
        else known = false;
      } else if (key === "ui-scale" || key === "interface-size") {
        const v = parseFloat(val); // accepts "110%", "110", or "1.1"
        if (!isNaN(v)) {
          const frac = v > 3 ? v / 100 : v;
          c.uiScale = Math.max(0.9, Math.min(1.3, Math.round(frac * 20) / 20));
        } else known = false;
      } else if (key === "cursor") {
        const nv = norm(val);
        if (nv === "block" || nv === "bar" || nv === "underline") c.cursor = nv;
        else known = false;
      } else if (key === "cursor-blink") {
        const b = parseBool(val);
        if (b !== null) c.cursorBlink = b;
        else known = false;
      } else if (key === "live-preview" || key === "preview") {
        const b = parseBool(val);
        if (b !== null) c.livePreview = b;
        else known = false;
      } else if (key === "auto-update" || key === "auto-updates" || key === "update-check") {
        const b = parseBool(val);
        if (b !== null) c.autoUpdateCheck = b;
        else known = false;
      } else if (key === "relative-numbers" || key === "relativenumber" || key === "rnu") {
        const b = parseBool(val);
        if (b !== null) c.relativeNumbers = b;
        else known = false;
      } else if (key === "vim" || key === "vim-mode") {
        const b = parseBool(val);
        if (b !== null) c.vimMode = b;
        else known = false;
      } else known = false;
      if (known) continue;
    }
    // No rule claimed this line — keep it exactly as written (indentation and
    // all) so `:w` never eats something the user typed.
    c.extraLines.push(raw.replace(/\s+$/, ""));
  }
  return c;
}

/** The preserved lines that are actual directives, not comments — i.e. the ones
 *  the user probably expected to DO something. Drives the "not recognized"
 *  toast, so a silent partial apply can't masquerade as a clean one. */
export function unrecognizedDirectives(c: Config): string[] {
  return c.extraLines.filter((l) => {
    const t = l.trim();
    return t !== "" && !t.startsWith('"') && !t.startsWith("#");
  });
}

export const byIdHelper = byId;

/**
 * First launch = the user has never stored a config *and* has no remembered
 * notebook. Gates the one-time onboarding choice (vim vs. plain keyboard); once
 * a choice is made the config is persisted, so `stored` is non-null thereafter
 * and existing users (who always have a last notebook) never see it.
 */
export const isFirstLaunch = (
  stored: Partial<Config> | null,
  lastNotebook: string | null,
): boolean => !stored && !lastNotebook;
