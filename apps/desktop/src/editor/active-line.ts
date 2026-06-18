// A drop-in replacement for CodeMirror's highlightActiveLine that paints the
// active-line band ONLY when the selection is empty (a caret). CM's built-in
// highlights the head line of every range — including non-empty ones — so in vim
// visual mode the cursor line gets a lighter band that competes with the
// selection. Suppressing it while a range is selected matches how editors render
// visual selections (selection only; the gutter still marks the line). The active-
// line gutter highlighter is kept separately and is unaffected.
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

const lineDeco = Decoration.line({ class: "cm-activeLine" });

export const activeLineHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.getDeco(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet) this.decorations = this.getDeco(update.view);
    }
    getDeco(view: EditorView): DecorationSet {
      const sel = view.state.selection;
      // no active-line band while anything is selected (e.g. vim visual mode)
      if (sel.ranges.some((r) => !r.empty)) return Decoration.none;
      const froms = [...new Set(sel.ranges.map((r) => view.lineBlockAt(r.head).from))];
      return Decoration.set(
        froms.map((from) => lineDeco.range(from)),
        true,
      );
    }
  },
  { decorations: (v) => v.decorations },
);
