// active-block.ts — the active-line highlight, re-homed onto blocks: the
// caret's TOP-LEVEL block gets .av-active-block (backed by the --active-line
// token). One node decoration, rebuilt only when the active block actually
// changes — cursor motion inside a block reuses the previous set, so
// selection-only updates stay free (the CM-era perf posture).
import { Extension } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { DecorationSet, Decoration } from "@tiptap/pm/view";

interface ActiveBlockState {
  from: number;
  to: number;
  set: DecorationSet;
}

const key = new PluginKey<ActiveBlockState>("nsActiveBlock");

// Only plain DOM-rendered blocks may carry the decoration: a node decoration
// on a custom-NodeView block (code, tables, html chips, math) makes
// ProseMirror RECREATE that NodeView on every caret entry/exit — wiping its
// transient DOM state (the copy button's "copied" flash) and churning work.
// Those blocks carry their own visual framing anyway.
const DECORATABLE = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "taskList",
  "callout",
]);

function compute(state: EditorState): ActiveBlockState {
  const $head = state.selection.$head;
  if ($head.depth === 0) return { from: -1, to: -1, set: DecorationSet.empty };
  const node = $head.node(1);
  if (!DECORATABLE.has(node.type.name)) return { from: -1, to: -1, set: DecorationSet.empty };
  const from = $head.before(1);
  const to = from + node.nodeSize;
  return {
    from,
    to,
    set: DecorationSet.create(state.doc, [Decoration.node(from, to, { class: "av-active-block" })]),
  };
}

export const ActiveBlock = Extension.create({
  name: "nsActiveBlock",
  addProseMirrorPlugins() {
    return [
      new Plugin<ActiveBlockState>({
        key,
        state: {
          init: (_cfg, state) => compute(state),
          apply(tr, prev, _old, state) {
            if (!tr.docChanged && !tr.selectionSet) return prev;
            const next = compute(state);
            // same block, unmoved doc — keep the old set (no redraw)
            if (!tr.docChanged && next.from === prev.from && next.to === prev.to) return prev;
            return next;
          },
        },
        props: {
          decorations(state) {
            return key.getState(state)?.set;
          },
        },
      }),
    ];
  },
});
