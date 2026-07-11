// settings.ts — config model + the ~/.notesiderc serialize/parse logic.
// The SettingsPanel component lives in components/settings-panel.tsx and consumes
// the metadata + helpers exported here. The full color palette is owned by the
// theme (themes.ts) — there is no separate accent knob.
import { DEFAULT_THEME, resolveThemeId } from "./themes";

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
  uiFont: string;
  fontSize: number;
  lineHeight: number;
  /** Interface-size multiplier — scales the UI chrome (not the editor). */
  uiScale: number;
  /** Show relative line numbers in the gutter (off = absolute). */
  relativeNumbers: boolean;
  cursor: "block" | "bar" | "underline";
  cursorBlink: boolean;
  /** Render markdown inline (Obsidian-style), hiding markup off the cursor line. */
  livePreview: boolean;
  vimMode: boolean;
  escMap: string;
  /** Raw vim map lines (e.g. "nmap <Space>w :w<CR>"), applied via Vim.map. */
  keymaps: string[];
  /** Non-vim chord overrides from `bind` lines: command id → chord ("" = unbound). */
  chords: Record<string, string>;
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

export const UI_FONTS: FontOption[] = [
  { id: "plex-mono", label: "IBM Plex Mono", stack: '"IBM Plex Mono", ui-monospace, monospace' },
  { id: "jetbrains", label: "JetBrains Mono", stack: '"JetBrains Mono", ui-monospace, monospace' },
  { id: "space-mono", label: "Space Mono", stack: '"Space Mono", ui-monospace, monospace' },
  { id: "geist-mono", label: "Geist Mono", stack: '"Geist Mono", ui-monospace, monospace' },
];

export const ESC_PRESETS = [{ label: "Esc", value: "" }];

export const CONFIG_DEFAULTS: Config = {
  theme: DEFAULT_THEME,
  editorFont: "newsreader",
  uiFont: "plex-mono",
  fontSize: 19,
  lineHeight: 1.75,
  uiScale: 1,
  relativeNumbers: false,
  cursor: "block",
  cursorBlink: true,
  livePreview: true,
  vimMode: true,
  escMap: "",
  keymaps: [],
  chords: {},
};

const byId = <T extends { id: string }>(list: T[], id: string): T =>
  list.find((x) => x.id === id) || list[0];

export const fontStack = (id: string, which: "editor" | "ui"): string =>
  byId(which === "editor" ? EDITOR_FONTS : UI_FONTS, id).stack;

// ---- config file <-> object ----------------------------------------
export function serializeConfig(c: Config): string {
  const eLabel = byId(EDITOR_FONTS, c.editorFont).label;
  const uLabel = byId(UI_FONTS, c.uiFont).label;
  const L: string[] = [];
  L.push('" ~/.notesiderc — Noteside configuration');
  L.push('" Edit any line and :w to apply. The Settings panel writes here too.');
  L.push("");
  L.push('" appearance');
  L.push(`set theme        = ${c.theme}`);
  L.push("");
  L.push('" typography');
  L.push(`set editor-font  = ${eLabel}`);
  L.push(`set ui-font      = ${uLabel}`);
  L.push(`set font-size    = ${c.fontSize}`);
  L.push(`set line-height  = ${c.lineHeight}`);
  L.push(`set ui-scale     = ${Math.round(c.uiScale * 100)}%`);
  L.push("");
  L.push('" cursor');
  L.push(`set cursor       = ${c.cursor}`);
  L.push(`set cursor-blink = ${c.cursorBlink ? "on" : "off"}`);
  L.push("");
  L.push('" editor');
  L.push(`set live-preview = ${c.livePreview ? "on" : "off"}`);
  L.push(`set relative-numbers = ${c.relativeNumbers ? "on" : "off"}`);
  L.push("");
  L.push('" keys');
  L.push(`set vim          = ${c.vimMode ? "on" : "off"}`);
  if (c.escMap) L.push(`imap ${c.escMap} <Esc>`);
  else L.push('" imap jj <Esc>          (no insert-mode escape mapping set)');
  if (c.keymaps.length) for (const km of c.keymaps) L.push(km);
  else L.push('" nmap <Space>w :w<CR>   (custom key mappings go here)');
  const binds = Object.entries(c.chords);
  if (binds.length) for (const [id, chord] of binds) L.push(`bind ${chord || "none"} ${id}`);
  else L.push('" bind Ctrl-j find       (rebind a chord; bind none <cmd> to unbind)');
  L.push("");
  return L.join("\n");
}

export function parseConfig(text: string, base: Config): Config {
  const c: Config = { ...base };
  c.escMap = ""; // an imap line re-enables it
  c.keymaps = []; // collected fresh from the map lines below
  c.chords = {}; // collected fresh from the bind lines below
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "");
  const matchFont = (list: FontOption[], val: string): string | null => {
    const n = norm(val);
    const f = list.find((x) => norm(x.label) === n || x.id === n);
    return f ? f.id : null;
  };
  for (const raw of String(text).split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith('"') || line.startsWith("#")) continue;
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^imap\s+(\S+)\s+<esc>/i))) {
      c.escMap = m[1];
      continue;
    }
    // `bind <chord> <command-id>` rebinds a non-vim chord; `bind none <id>` unbinds it.
    if ((m = line.match(/^bind\s+(\S+)\s+(\S+)\s*$/i))) {
      c.chords[m[2]] = /^none$/i.test(m[1]) ? "" : m[1];
      continue;
    }
    if (/^(n|v|i|o)?(nore)?map\s+\S+\s+.+$/i.test(line)) {
      c.keymaps.push(line);
      continue;
    }
    if ((m = line.match(/^set\s+([\w-]+)\s*=?\s*(.+?)\s*$/i))) {
      const key = m[1].toLowerCase(),
        val = m[2].trim();
      if (key === "theme") {
        // Accept a theme id, an alias (light/dark), or a label. Dark/light-ish
        // strings ("dark mode") keep the pre-themes parser's tolerance; anything
        // else leaves the current value (an unknown theme name won't crash).
        const id = resolveThemeId(val);
        if (id) c.theme = id;
        else if (/dark/i.test(val)) c.theme = "noteside-dark";
        else if (/light/i.test(val)) c.theme = "noteside-light";
      } else if (key === "editor-font") {
        const id = matchFont(EDITOR_FONTS, val);
        if (id) c.editorFont = id;
      } else if (key === "ui-font") {
        const id = matchFont(UI_FONTS, val);
        if (id) c.uiFont = id;
      } else if (key === "font-size") {
        const v = parseInt(val, 10);
        if (!isNaN(v)) c.fontSize = Math.max(16, Math.min(28, v));
      } else if (key === "line-height") {
        const v = parseFloat(val);
        if (!isNaN(v)) c.lineHeight = Math.max(1.4, Math.min(2.1, Math.round(v * 100) / 100));
      } else if (key === "ui-scale" || key === "interface-size") {
        const v = parseFloat(val); // accepts "110%", "110", or "1.1"
        if (!isNaN(v)) {
          const frac = v > 3 ? v / 100 : v;
          c.uiScale = Math.max(0.9, Math.min(1.3, Math.round(frac * 20) / 20));
        }
      } else if (key === "cursor") {
        const nv = norm(val);
        if (nv === "block" || nv === "bar" || nv === "underline") c.cursor = nv;
      } else if (key === "cursor-blink") c.cursorBlink = /^(on|true|yes|1)$/i.test(val);
      else if (key === "live-preview" || key === "preview")
        c.livePreview = /^(on|true|yes|1)$/i.test(val);
      else if (key === "relative-numbers" || key === "relativenumber" || key === "rnu")
        c.relativeNumbers = /^(on|true|yes|1)$/i.test(val);
      else if (key === "vim" || key === "vim-mode") c.vimMode = /^(on|true|yes|1)$/i.test(val);
    }
  }
  return c;
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
