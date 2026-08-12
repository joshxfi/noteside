// User-defined conventional shortcuts are always active while the editor has
// focus. Keep their validation CM-free so config parsing, the shortcut editor,
// and the CodeMirror command layer can share one safety policy.

const CHORD_SPLIT = /-(?!$)/;
const NON_TYPING_MODIFIERS = new Set(["mod", "cmd", "meta", "ctrl", "control", "alt"]);
// Every modifier token this app accepts, in full-word spellings (single-letter
// CM aliases like `c-p` are rejected so one spelling rules everywhere). An
// unknown token must fail validation outright: CM6's key normalization THROWS
// on unrecognized modifiers, and that throw happens while building the keymap
// on keydown — one typo'd `bind` line would kill all keyboard handling.
const KNOWN_MODIFIERS = new Set([...NON_TYPING_MODIFIERS, "shift"]);

/** Whether a user-defined chord can coexist with ordinary text editing.
 * Cmd/Ctrl/Alt chords and function keys are safe; bare keys, Shift-only typing
 * keys, Tab, Enter, and arrows would hijack editor input — and every modifier
 * token must be one CM recognizes (see KNOWN_MODIFIERS). */
export function isSafeChord(chord: string): boolean {
  const parts = chord.split(CHORD_SPLIT);
  const key = parts.pop() ?? "";
  if (!parts.every((part) => KNOWN_MODIFIERS.has(part.toLowerCase()))) return false;
  return (
    parts.some((part) => NON_TYPING_MODIFIERS.has(part.toLowerCase())) ||
    /^F(?:[1-9]|1\d|2[0-4])$/i.test(key)
  );
}

/** Drop unsafe bindings while preserving explicit unbinds. Used when loading
 * configs written by versions that allowed bare editor keys. */
export function sanitizeChordOverrides(
  overrides: Record<string, string> | undefined,
): Record<string, string> {
  if (!overrides) return {};
  return Object.fromEntries(
    Object.entries(overrides).filter(([, chord]) => !chord || isSafeChord(chord)),
  );
}
