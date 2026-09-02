// Document-level chord fallback. The editor's CM keymap handles chords while it's
// focused, but in the no-note-open / notebook-picker states there is NO EditorView
// (the EditingSession is empty and setActiveHandlers(null) has run), so a keyboard
// user would have no way to press Mod-N / Mod-P. This hook covers exactly that gap.
//
// It defers in two cases, both load-bearing: (1) `enabled` is false whenever any
// overlay is open — gated on React state, NOT document.activeElement, because the
// which-key palette and similar panels focus tabIndex divs and don't
// stopPropagation; (2) an input/textarea/contenteditable or the editor owns
// focus (the editor's own chord layer handles those, so we never double-dispatch).
import { useEffect, useRef } from "react";
import {
  type AppCommand,
  type ChordOverrides,
  globalChordMap,
  resolveGlobalChord,
} from "./editor/commands";

export function useGlobalChords(opts: {
  enabled: boolean;
  overrides?: ChordOverrides;
  run: (c: AppCommand) => void;
}) {
  // Latest-value mirror for the one window listener — written from an effect,
  // not during render, so a discarded render can't leak into the live handler.
  const ref = useRef(opts);
  useEffect(() => {
    ref.current = opts;
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { enabled, overrides, run } = ref.current;
      if (!enabled) return; // cheapest bail first — this handler sees every keystroke
      // An already-claimed event must never dispatch AGAIN here. The editor's
      // chord layer preventDefaults what it handles, but when that dispatch
      // navigates (Mod-j) the editor REMOUNTS before this window-level
      // listener runs (microtasks drain between listeners in the same bubble
      // chain), so the activeElement guard below sees <body> and would
      // re-dispatch the same keypress — one press, two steps.
      if (e.defaultPrevented) return;
      const el = document.activeElement as HTMLElement | null;
      const editingTarget =
        !!el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable ||
          !!el.closest(".av-editor"));
      if (editingTarget) return;
      const cmd = resolveGlobalChord(e, { enabled, editingTarget }, globalChordMap(overrides));
      if (cmd) {
        e.preventDefault();
        run(cmd);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
