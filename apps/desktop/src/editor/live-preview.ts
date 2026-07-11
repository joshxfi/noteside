// Obsidian-style "live preview": render markdown formatting in place by hiding
// the raw markup characters (`#`, `**`, `` ` ``, `[`…`](url)`, `>`, fences) on
// every line the cursor is NOT on, and revealing them again the moment the
// cursor enters that line. List bullets, task checkboxes, and horizontal rules
// render as small inline widgets under the same rule. The document itself is
// never rewritten — we only add decorations — so every vim motion still
// operates on the real source text. Everything here is line-height-neutral
// (inline widgets and styling only); block-level rendering that affects
// vertical layout (tables, code-block line styling) lives in block-preview.ts,
// which is a StateField for exactly that reason.
import { syntaxTree } from "@codemirror/language";
import type { Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";

const hide = Decoration.replace({});
const codeLangMark = Decoration.mark({ class: "cm-code-lang" });
const taskDoneLine = Decoration.line({ class: "cm-task-done" });
// The `code` chip is a decoration (not a t.monospace highlight style) because
// that tag also covers fenced-code text, which must not get per-span chips.
const inlineCodeMark = Decoration.mark({ class: "cm-inline-code" });

class BulletWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }
  override toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "cm-list-bullet";
    el.textContent = "•";
    return el;
  }
  // let the editor handle clicks (cursor placement), like plain text
  override ignoreEvent(): boolean {
    return false;
  }
}
const bullet = new BulletWidget();

class HrWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }
  override toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "cm-hr";
    return el;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}
const hr = new HrWidget();

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  override eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked;
  }
  override toDOM(view: EditorView): HTMLElement {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-task-box";
    box.checked = this.checked;
    box.setAttribute("aria-label", this.checked ? "Mark task not done" : "Mark task done");
    box.addEventListener("mousedown", (e) => e.preventDefault()); // keep editor focus
    box.addEventListener("click", (e) => {
      e.preventDefault();
      // The widget replaces the 3-char `[x]` marker, so its DOM position IS the
      // marker's from — no offsets are baked in (eq() may keep an old instance's
      // DOM alive across edits that shift positions).
      const pos = view.posAtDOM(box);
      const cur = view.state.sliceDoc(pos, pos + 3);
      if (!/^\[[ xX]\]$/.test(cur)) return;
      view.dispatch({
        changes: { from: pos, to: pos + 3, insert: cur === "[ ]" ? "[x]" : "[ ]" },
        userEvent: "input.toggle-task",
      });
    });
    return box;
  }
  override ignoreEvent(): boolean {
    return true; // the checkbox handles its own clicks
  }
}
const checkbox = { checked: new CheckboxWidget(true), unchecked: new CheckboxWidget(false) };

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

const BULLET_CHARS = "-*+";

function buildDecorations(view: EditorView): DecorationSet {
  // Collected then sorted by Decoration.set (not a RangeSetBuilder): line
  // decorations anchor at line starts we've already iterated past, so adds
  // aren't position-ordered. Viewport-sized N keeps the sort trivial.
  const ranges: Range<Decoration>[] = [];
  const active = activeLines(view);
  const { doc } = view.state;
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.from === node.to) return;
        const { name } = node;
        // cheap name gate before any doc/tree work
        let kind:
          | "mark"
          | "fence-mark"
          | "code-lang"
          | "inline-code"
          | "list-mark"
          | "task"
          | "hr"
          | "escape"
          | null = null;
        switch (name) {
          case "HeaderMark":
          case "EmphasisMark":
          case "StrikethroughMark":
            kind = "mark";
            break;
          case "InlineCode":
            kind = "inline-code";
            break;
          case "CodeMark": {
            const p = node.node.parent?.name;
            if (p === "InlineCode") kind = "mark";
            else if (p === "FencedCode") kind = "fence-mark";
            break;
          }
          case "LinkMark":
          case "URL": {
            const p = node.node.parent?.name;
            if (p === "Link" || p === "Image") kind = "mark";
            break;
          }
          case "QuoteMark":
            kind = "mark";
            break;
          case "CodeInfo":
            kind = "code-lang";
            break;
          case "ListMark":
            kind = "list-mark";
            break;
          case "TaskMarker":
            kind = "task";
            break;
          case "HorizontalRule":
            kind = "hr";
            break;
          case "Escape":
            kind = "escape";
            break;
        }
        if (!kind) return;
        const lineObj = doc.lineAt(node.from);
        if (active.has(lineObj.number)) {
          // reveal on cursor line — but a done task still dims its text, so
          // toggling state is visible even mid-edit
          if (kind === "task" && /[xX]/.test(doc.sliceString(node.from + 1, node.from + 2))) {
            ranges.push(taskDoneLine.range(lineObj.from));
          }
          return;
        }
        switch (kind) {
          case "mark": {
            // Swallow the single space after a heading's `#`s so the text sits flush.
            let end = node.to;
            if (name === "HeaderMark" && doc.sliceString(node.to, node.to + 1) === " ") {
              end = node.to + 1;
            }
            ranges.push(hide.range(node.from, end));
            break;
          }
          case "fence-mark":
            ranges.push(hide.range(node.from, node.to));
            break;
          case "code-lang":
            ranges.push(codeLangMark.range(node.from, node.to));
            break;
          case "inline-code":
            ranges.push(inlineCodeMark.range(node.from, node.to));
            break;
          case "list-mark": {
            if (!BULLET_CHARS.includes(doc.sliceString(node.from, node.from + 1))) break;
            // a task item's bullet disappears entirely (the checkbox stands in);
            // a plain bullet renders as `•`
            if (node.node.parent?.getChild("Task")) {
              const end = doc.sliceString(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
              ranges.push(hide.range(node.from, end));
            } else {
              ranges.push(Decoration.replace({ widget: bullet }).range(node.from, node.to));
            }
            break;
          }
          case "task": {
            const done = /[xX]/.test(doc.sliceString(node.from + 1, node.from + 2));
            if (done) ranges.push(taskDoneLine.range(lineObj.from));
            ranges.push(
              Decoration.replace({ widget: done ? checkbox.checked : checkbox.unchecked }).range(
                node.from,
                node.to,
              ),
            );
            break;
          }
          case "hr":
            ranges.push(Decoration.replace({ widget: hr }).range(node.from, node.to));
            break;
          case "escape":
            ranges.push(hide.range(node.from, node.from + 1));
            break;
        }
      },
    });
  }
  return Decoration.set(ranges, true);
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
