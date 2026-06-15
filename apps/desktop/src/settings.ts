// settings.ts — config model + the ~/.notesiderc serialize/parse logic.
// The SettingsPanel component lives in components/SettingsPanel.tsx and consumes
// the metadata + helpers exported here.

export interface AccentOption {
  id: string;
  label: string;
  value: string;
}
export interface FontOption {
  id: string;
  label: string;
  stack: string;
  kind?: "serif" | "mono";
}

export interface Config {
  theme: "light" | "dark";
  accent: string;
  editorFont: string;
  uiFont: string;
  fontSize: number;
  lineHeight: number;
  cursor: "block" | "bar" | "underline";
  cursorBlink: boolean;
  vimMode: boolean;
  escMap: string;
  /** Raw vim map lines (e.g. "nmap <Space>w :w<CR>"), applied via Vim.map. */
  keymaps: string[];
}

// ---- option metadata ------------------------------------------------
export const ACCENTS: AccentOption[] = [
  { id: "terracotta", label: "Terracotta", value: "oklch(0.60 0.122 42)" },
  { id: "ochre", label: "Ochre", value: "oklch(0.66 0.105 78)" },
  { id: "sage", label: "Sage", value: "oklch(0.585 0.075 150)" },
  { id: "dusk", label: "Dusk", value: "oklch(0.58 0.078 255)" },
  { id: "plum", label: "Plum", value: "oklch(0.565 0.095 350)" },
];

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
];

export const UI_FONTS: FontOption[] = [
  { id: "plex-mono", label: "IBM Plex Mono", stack: '"IBM Plex Mono", ui-monospace, monospace' },
  { id: "jetbrains", label: "JetBrains Mono", stack: '"JetBrains Mono", ui-monospace, monospace' },
  { id: "space-mono", label: "Space Mono", stack: '"Space Mono", ui-monospace, monospace' },
];

export const ESC_PRESETS = [{ label: "Esc", value: "" }];

export const CONFIG_DEFAULTS: Config = {
  theme: "light",
  accent: "plum",
  editorFont: "newsreader",
  uiFont: "plex-mono",
  fontSize: 19,
  lineHeight: 1.75,
  cursor: "block",
  cursorBlink: true,
  vimMode: true,
  escMap: "",
  keymaps: [],
};

const byId = <T extends { id: string }>(list: T[], id: string): T =>
  list.find((x) => x.id === id) || list[0];

export const accentValue = (id: string): string => byId(ACCENTS, id).value;
export const fontStack = (id: string, which: "editor" | "ui"): string =>
  byId(which === "editor" ? EDITOR_FONTS : UI_FONTS, id).stack;

// ---- config file <-> object ----------------------------------------
export function serializeConfig(c: Config): string {
  const eLabel = byId(EDITOR_FONTS, c.editorFont).label;
  const uLabel = byId(UI_FONTS, c.uiFont).label;
  const aLabel = byId(ACCENTS, c.accent).label;
  const L: string[] = [];
  L.push('" ~/.notesiderc — Noteside configuration');
  L.push('" Edit any line and :w to apply. The Settings panel writes here too.');
  L.push("");
  L.push('" appearance');
  L.push(`set theme        = ${c.theme}`);
  L.push(`set accent       = ${aLabel.toLowerCase()}`);
  L.push("");
  L.push('" typography');
  L.push(`set editor-font  = ${eLabel}`);
  L.push(`set ui-font      = ${uLabel}`);
  L.push(`set font-size    = ${c.fontSize}`);
  L.push(`set line-height  = ${c.lineHeight}`);
  L.push("");
  L.push('" cursor');
  L.push(`set cursor       = ${c.cursor}`);
  L.push(`set cursor-blink = ${c.cursorBlink ? "on" : "off"}`);
  L.push("");
  L.push('" keys');
  L.push(`set vim          = ${c.vimMode ? "on" : "off"}`);
  if (c.escMap) L.push(`imap ${c.escMap} <Esc>`);
  else L.push('" imap jj <Esc>          (no insert-mode escape mapping set)');
  if (c.keymaps.length) for (const km of c.keymaps) L.push(km);
  else L.push('" nmap <Space>w :w<CR>   (custom key mappings go here)');
  L.push("");
  return L.join("\n");
}

export function parseConfig(text: string, base: Config): Config {
  const c: Config = { ...base };
  c.escMap = ""; // an imap line re-enables it
  c.keymaps = []; // collected fresh from the map lines below
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
    if (/^(n|v|i|o)?(nore)?map\s+\S+\s+.+$/i.test(line)) {
      c.keymaps.push(line);
      continue;
    }
    if ((m = line.match(/^set\s+([\w-]+)\s*=?\s*(.+?)\s*$/i))) {
      const key = m[1].toLowerCase(),
        val = m[2].trim();
      if (key === "theme") c.theme = /dark/i.test(val) ? "dark" : "light";
      else if (key === "accent") {
        const a = ACCENTS.find((x) => x.id === norm(val) || norm(x.label) === norm(val));
        if (a) c.accent = a.id;
      } else if (key === "editor-font") {
        const id = matchFont(EDITOR_FONTS, val);
        if (id) c.editorFont = id;
      } else if (key === "ui-font") {
        const id = matchFont(UI_FONTS, val);
        if (id) c.uiFont = id;
      } else if (key === "font-size") {
        const v = parseInt(val, 10);
        if (!isNaN(v)) c.fontSize = Math.max(14, Math.min(28, v));
      } else if (key === "line-height") {
        const v = parseFloat(val);
        if (!isNaN(v)) c.lineHeight = Math.max(1.4, Math.min(2.1, Math.round(v * 100) / 100));
      } else if (key === "cursor") {
        const nv = norm(val);
        if (nv === "block" || nv === "bar" || nv === "underline") c.cursor = nv;
      } else if (key === "cursor-blink") c.cursorBlink = /^(on|true|yes|1)$/i.test(val);
      else if (key === "vim" || key === "vim-mode") c.vimMode = /^(on|true|yes|1)$/i.test(val);
    }
  }
  return c;
}

export const byIdHelper = byId;
