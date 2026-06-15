// Document-level chord fallback. The editor's CM keymap handles chords while it's
// focused, but in the no-note-open / notebook-picker states there is NO EditorView
// (the EditingSession is empty and setActiveHandlers(null) has run), so a keyboard
// user would have no way to press Mod-N / Mod-P. This hook covers exactly that gap.
//
// It defers in two cases, both load-bearing: (1) `enabled` is false whenever any
// overlay is open — gated on React state, NOT document.activeElement, because the
// which-key palette and backlinks panels focus tabIndex divs and don't
// stopPropagation; (2) an input/textarea/contenteditable or the CM editor owns
// focus (the editor's own keymap handles those, so we never double-dispatch).
import { useEffect, useRef } from "react";
import { type ChordOverrides, makeGlobalChordMap, resolveGlobalChord } from "./editor/commands";
import type { AppCommand } from "./editor/exCommands";

export function useGlobalChords(opts: {
  enabled: boolean;
  overrides?: ChordOverrides;
  run: (c: AppCommand) => void;
}) {
  const ref = useRef(opts);
  ref.current = opts;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { enabled, overrides, run } = ref.current;
      const el = document.activeElement as HTMLElement | null;
      const editingTarget =
        !!el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable ||
          !!el.closest(".cm-editor"));
      const cmd = resolveGlobalChord(e, { enabled, editingTarget }, makeGlobalChordMap(overrides));
      if (cmd) {
        e.preventDefault();
        run(cmd);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
