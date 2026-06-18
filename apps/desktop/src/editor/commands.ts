// commands.ts — the single source of truth for every invocable command. Vim
// ex-commands, the <Space> leader (which-key) palette, the always-on Mod- chord
// keymap, the searchable command palette, the cheatsheet, and button tooltips are
// all DERIVED from this table, so they cannot drift. Adding a command (or rebinding
// one) is a one-line edit here.
//
// Pure + framework-free (only a type import from CodeMirror): node-testable, and
// the chord matcher is reused by both the editor keymap and the document-level
// fallback for the no-note-open state.
import type { KeyBinding } from "@codemirror/view";
import type { AppCommand } from "./exCommands";

/** Editor-scoped actions that need live editor state (not plain AppCommands). */
export type EditorAction =
  | "save"
  | "quit"
  | "saveQuit"
  | "follow"
  | "search"
  | "searchNext"
  | "searchPrev";

export interface Command {
  id: string;
  title: string;
  group: "Find" | "Note" | "View" | "Settings" | "Help";
  /** CM6 chord string, also the canonical form rendered (via chordLabel) and matched. */
  chord?: string;
  /** Vim ex-command names (`:find`, `:files`, …). */
  ex?: string[];
  /** Which-key leader key (after `<Space>`). */
  leader?: string;
  /** Dispatched through the app command handler. */
  command?: AppCommand;
  /** Dispatched through the editor handler (needs live editor state). */
  editor?: EditorAction;
  /** Ask for confirmation before running (destructive). */
  danger?: boolean;
  /** Requires an open note. */
  needsNote?: boolean;
  /** Optional hint shown next to the label in the which-key leader palette. */
  paletteHint?: string;
  /** Show in the searchable command palette (default true). */
  inPalette?: boolean;
  /** Show in the cheatsheet (default true). */
  inCheatsheet?: boolean;
}

// Chords deliberately avoid CM defaultKeymap collisions (active in non-vim mode):
// Mod-Shift-k = deleteLine, Mod-Enter = insertBlankLine; and the native
// Mod-z/a/c/v/x/Backspace. (Mod-f IS bound — to in-note search, the non-vim
// equivalent of vim's `/`.) Shifted punctuation (Mod-Shift-,) is avoided because
// CM matches on event.key, where Shift+"," is "<" — so `config` has no chord.
export const COMMANDS: Command[] = [
  // ── Find ──────────────────────────────────────────────────────────
  {
    id: "find",
    title: "Find files & content",
    group: "Find",
    chord: "Mod-p",
    ex: ["find", "files"],
    leader: "f",
    command: "find",
    paletteHint: "files + content",
  },
  {
    id: "grep",
    title: "Search note contents",
    group: "Find",
    chord: "Mod-Shift-f",
    ex: ["grep"],
    leader: "g",
    command: "grep",
  },
  {
    id: "search",
    title: "Find in note",
    group: "Find",
    chord: "Mod-f",
    editor: "search",
    needsNote: true,
    inPalette: false,
  },
  {
    id: "commands",
    title: "Command palette",
    group: "Find",
    chord: "Mod-Shift-p",
    ex: ["commands"],
    command: "commands",
    inPalette: false,
  },
  {
    id: "palette",
    title: "Leader menu",
    group: "Find",
    ex: ["palette"],
    command: "palette",
    inPalette: false,
    inCheatsheet: false,
  },
  {
    id: "backlinks",
    title: "Backlinks to this note",
    group: "Find",
    chord: "Mod-Shift-l",
    ex: ["backlinks", "back"],
    leader: "l",
    command: "backlinks",
    needsNote: true,
    paletteHint: "links here",
  },
  // ── Note ──────────────────────────────────────────────────────────
  {
    id: "new",
    title: "New note",
    group: "Note",
    chord: "Mod-n",
    ex: ["new"],
    leader: "n",
    command: "new",
  },
  {
    id: "save",
    title: "Save note",
    group: "Note",
    chord: "Mod-s",
    ex: ["write", "w"],
    editor: "save",
    needsNote: true,
    inPalette: false,
  },
  {
    id: "saveQuit",
    title: "Save & close note",
    group: "Note",
    ex: ["wq", "xit", "x"],
    editor: "saveQuit",
    needsNote: true,
    inPalette: false,
    inCheatsheet: false,
  },
  {
    id: "quit",
    title: "Close note",
    group: "Note",
    chord: "Mod-w",
    ex: ["quit", "q"],
    leader: "q",
    editor: "quit",
    needsNote: true,
    paletteHint: ":q",
  },
  {
    id: "reopen",
    title: "Reopen closed note",
    group: "Note",
    chord: "Mod-Shift-t",
    ex: ["reopen"],
    command: "reopen",
    paletteHint: "last closed",
  },
  {
    id: "delete",
    title: "Delete note",
    group: "Note",
    ex: ["rm"],
    leader: "d",
    command: "delete",
    danger: true,
    needsNote: true,
  },
  {
    id: "follow",
    title: "Follow link under cursor",
    group: "Note",
    chord: "Alt-Enter",
    ex: ["follow"],
    editor: "follow",
    needsNote: true,
    inPalette: false,
  },
  {
    id: "nextNote",
    title: "Next note",
    group: "Note",
    chord: "Mod-j",
    command: "nextNote",
  },
  {
    id: "prevNote",
    title: "Previous note",
    group: "Note",
    chord: "Mod-k",
    command: "prevNote",
  },
  // ── View ──────────────────────────────────────────────────────────
  {
    id: "nav",
    title: "Toggle sidebar",
    group: "View",
    chord: "Mod-b",
    ex: ["nav"],
    leader: "b",
    command: "nav",
  },
  {
    id: "togglePreview",
    title: "Toggle live preview",
    group: "View",
    chord: "Mod-e",
    ex: ["preview"],
    leader: "p",
    command: "togglePreview",
  },
  // ── Settings / Help ───────────────────────────────────────────────
  {
    id: "settings",
    title: "Settings",
    group: "Settings",
    chord: "Mod-,",
    ex: ["settings", "prefs"],
    leader: ",",
    command: "settings",
  },
  {
    id: "config",
    title: "Edit ~/.notesiderc",
    group: "Settings",
    ex: ["config"],
    leader: "c",
    command: "config",
  },
  {
    id: "cheatsheet",
    title: "Keyboard shortcuts",
    group: "Help",
    chord: "Mod-/",
    ex: ["help"],
    command: "cheatsheet",
  },
];

export const COMMAND_BY_ID: Record<string, Command> = Object.fromEntries(
  COMMANDS.map((c) => [c.id, c]),
);

// ── chord normalization (shared by the CM keymap and the doc-level matcher) ──
const MAC = typeof navigator !== "undefined" && /Mac|iP(hone|ad|od)/.test(navigator.platform || "");
const MOD_ORDER = ["Mod", "Alt", "Shift"];

function normChord(chord: string): string {
  const parts = chord.split("-");
  const key = parts.pop() as string;
  const mods = new Set(
    parts.map((m) => (m === "Cmd" || m === "Meta" || m === "Ctrl" || m === "Control" ? "Mod" : m)),
  );
  const ordered = MOD_ORDER.filter((m) => mods.has(m));
  return [...ordered, key.length === 1 ? key.toLowerCase() : key].join("-");
}

/** Normalize a keyboard event into the same chord form as the table (for matching). */
export function eventChord(e: {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  key: string;
}): string {
  const mods: string[] = [];
  if (e.metaKey || e.ctrlKey) mods.push("Mod");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  const ordered = MOD_ORDER.filter((m) => mods.includes(m));
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  return [...ordered, key].join("-");
}

/** Human-readable chord, platform-aware (⌘⇧F on macOS, Ctrl+Shift+F elsewhere).
 *  `mac` is injectable so the label is deterministic to test on either platform. */
export function chordLabel(chord: string, mac: boolean = MAC): string {
  const parts = chord.split("-").map((p) => {
    if (p === "Mod") return mac ? "⌘" : "Ctrl";
    if (p === "Shift") return mac ? "⇧" : "Shift";
    if (p === "Alt") return mac ? "⌥" : "Alt";
    if (p === ",") return ",";
    if (p === "/") return "/";
    return p.length === 1 ? p.toUpperCase() : p;
  });
  return parts.join(mac ? "" : "+");
}

/** User chord overrides from `~/.notesiderc` `bind` lines: command id → chord ("" = unbound). */
export type ChordOverrides = Record<string, string>;

/** A command's effective chord, applying any user override ("" means unbound). */
export function effectiveChord(c: Command, overrides?: ChordOverrides): string | undefined {
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, c.id)) {
    return overrides[c.id] || undefined;
  }
  return c.chord;
}

/** Copy of `commands` with each chord resolved against overrides (for display). */
export function withChordOverrides(commands: Command[], overrides?: ChordOverrides): Command[] {
  if (!overrides) return commands;
  return commands.map((c) => ({ ...c, chord: effectiveChord(c, overrides) }));
}

/**
 * Build the always-on CM6 chord keymap from the table. `dispatch` runs a command
 * in the editor's context (AppCommands via onCommand, editor actions via onSave/etc).
 */
export function commandChordKeymap(
  dispatch: (cmd: Command) => void,
  overrides?: ChordOverrides,
): KeyBinding[] {
  return COMMANDS.map((c) => ({ c, chord: effectiveChord(c, overrides) }))
    .filter((x) => x.chord)
    .map(({ c, chord }) => ({
      key: chord as string,
      preventDefault: true,
      run: () => {
        dispatch(c);
        return true;
      },
    }));
}

/** Chord → command lookup for the document-level fallback. Only command-kind
 *  commands (no editor state needed) are reachable when no editor is focused. */
export function makeGlobalChordMap(overrides?: ChordOverrides): Map<string, Command> {
  return new Map(
    COMMANDS.filter((c) => c.command)
      .map((c) => ({ c, chord: effectiveChord(c, overrides) }))
      .filter((x) => x.chord)
      .map(({ c, chord }) => [normChord(chord as string), c]),
  );
}
const DEFAULT_GLOBAL_MAP = makeGlobalChordMap();

/** The command a keyboard event triggers when no editor is focused, or undefined. */
export function globalCommandForEvent(
  e: { metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; key: string },
  map: Map<string, Command> = DEFAULT_GLOBAL_MAP,
): Command | undefined {
  return map.get(eventChord(e));
}

/**
 * Decide which AppCommand a key event should trigger at the DOCUMENT level (the
 * fallback for when no editor is mounted, e.g. the empty state). Returns null when
 * an overlay is open (`enabled` false) or an input/editor owns focus
 * (`editingTarget`), or when the chord isn't a global command. Pure — the hook
 * computes `ctx` from React state + the focused element; this is the testable core.
 */
export function resolveGlobalChord(
  e: { metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; key: string },
  ctx: { enabled: boolean; editingTarget: boolean },
  map?: Map<string, Command>,
): AppCommand | null {
  if (!ctx.enabled || ctx.editingTarget) return null;
  return globalCommandForEvent(e, map)?.command ?? null;
}

/** Commands shown in the searchable command palette. */
export const paletteCommands = COMMANDS.filter((c) => c.inPalette !== false);
/** Commands shown in the cheatsheet. */
export const cheatsheetCommands = COMMANDS.filter((c) => c.inCheatsheet !== false);
/** Commands with a which-key leader binding. */
export const leaderCommands = COMMANDS.filter((c) => c.leader);
