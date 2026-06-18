// Obsidian-style "live preview": render markdown formatting in place by hiding
// the raw markup characters (`#`, `**`, `` ` ``, `[`…`](url)`) on every line the
// cursor is NOT on, and revealing them again the moment the cursor enters that
// line. The document itself is never rewritten — we only add `replace`
// decorations — so every vim motion still operates on the real source text.
import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

const hide = Decoration.replace({});

// Lines touched by any selection range stay in "source" form so editing — and
// vim column math — always sees the literal characters. Shared with the
// wikilink decorations (same reveal-on-cursor-line behaviour).
export function activeLines(view: EditorView): Set<number> {
  const lines = new Set<number>();
  const { doc } = view.state;
  for (const r of view.state.selection.ranges) {
    const first = doc.lineAt(r.from).number;
    const last = doc.lineAt(r.to).number;
    for (let n = first; n <= last; n++) lines.add(n);
  }
  return lines;
}

// Which markup nodes to collapse. Parent checks keep us from eating fenced-code
// fences (only inline backticks) or autolink URLs (only `[text](url)` targets).
function isMarkup(name: string, parent: string | undefined): boolean {
  switch (name) {
    case "HeaderMark":
    case "EmphasisMark":
    case "StrikethroughMark":
      return true;
    case "CodeMark":
      return parent === "InlineCode";
    case "LinkMark":
    case "URL":
      return parent === "Link" || parent === "Image";
    default:
      return false;
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const active = activeLines(view);
  const { doc } = view.state;
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.from === node.to) return;
        if (!isMarkup(node.name, node.node.parent?.name)) return;
        if (active.has(doc.lineAt(node.from).number)) return; // reveal on cursor line
        // Swallow the single space after a heading's `#`s so the text sits flush.
        let end = node.to;
        if (node.name === "HeaderMark" && doc.sliceString(node.to, node.to + 1) === " ") {
          end = node.to + 1;
        }
        builder.add(node.from, end, hide);
      },
    });
  }
  return builder.finish();
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged) {
        this.decorations = buildDecorations(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
