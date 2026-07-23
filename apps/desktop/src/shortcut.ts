// User-defined conventional shortcuts are always active while the editor has
// focus. Keep their validation CM-free so config parsing, the shortcut editor,
// and the CodeMirror command layer can share one safety policy.

const CHORD_SPLIT = /-(?!$)/;
const NON_TYPING_MODIFIERS = new Set(["mod", "cmd", "meta", "ctrl", "control", "alt"]);

/** Whether a user-defined chord can coexist with ordinary text editing.
 * Cmd/Ctrl/Alt chords and function keys are safe; bare keys, Shift-only typing
 * keys, Tab, Enter, and arrows would hijack editor input. */
export function isSafeChord(chord: string): boolean {
  const parts = chord.split(CHORD_SPLIT);
  const key = parts.pop() ?? "";
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
