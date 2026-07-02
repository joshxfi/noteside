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
// wikilink decorations (same reveal-on-cursor-line behaviour). Ranges are
// clamped to the viewport (a contiguous superset of visibleRanges) — both
// consumers only query visible lines, and an unclamped whole-buffer selection
// (ggVG) would otherwise materialize one Set entry per document line.
export function activeLines(view: EditorView): Set<number> {
  const lines = new Set<number>();
  const { doc } = view.state;
  const { from: vFrom, to: vTo } = view.viewport;
  for (const r of view.state.selection.ranges) {
    if (r.to < vFrom || r.from > vTo) continue;
    const first = doc.lineAt(Math.max(r.from, vFrom)).number;
    const last = doc.lineAt(Math.min(r.to, vTo)).number;
    for (let n = first; n <= last; n++) lines.add(n);
  }
  return lines;
}

// A cheap identity for the current active-line set, letting the decoration
// plugins skip a full viewport rebuild on selection moves that stayed on the
// same lines (every h/l keypress). Sorted so multi-cursor range order is moot.
export function activeLinesKey(view: EditorView): string {
  return [...activeLines(view)].sort((a, b) => a - b).join(",");
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
    activeKey: string;
    constructor(view: EditorView) {
      this.activeKey = activeLinesKey(view);
      this.decorations = buildDecorations(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) {
        this.activeKey = activeLinesKey(u.view);
        this.decorations = buildDecorations(u.view);
      } else if (u.selectionSet) {
        // Pure selection move (post-update state): rebuild only when the set of
        // revealed lines actually changed — not on every within-line h/l step.
        const key = activeLinesKey(u.view);
        if (key === this.activeKey) return;
        this.activeKey = key;
        this.decorations = buildDecorations(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
