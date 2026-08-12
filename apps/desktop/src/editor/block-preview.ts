// block-preview.ts — the block-level half of live preview: pipe tables render
// as real <table> widgets that reveal back to source the moment the selection
// touches them, fenced code blocks and blockquotes get whole-line styling, and
// an arrow-key entry keymap keeps collapsed tables reachable without a mouse.
//
// This lives in a StateField (not a ViewPlugin like live-preview.ts) because
// block widgets and height-affecting line decorations must be known before the
// viewport is computed — CM6 forbids them from view plugins. To keep the field
// cheap: the pure line scan (markdown.ts scanBlocks) runs only on doc changes;
// a selection move recomputes just the "which tables are revealed" key and
// bails without touching decorations when it hasn't changed (the same
// skip-on-no-change discipline as live-preview's activeLinesKey).
import { EditorState, Facet, Prec, type Range, StateField, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import {
  frontmatterEndLine,
  type Inline,
  type MarkdownBlocks,
  parseInline,
  scanBlocks,
  type TableBlock,
} from "../markdown";

/** App-level URL opener, provided by the Editor component so table-cell links
 *  stay Mod-clickable while rendered. */
export interface LinkHandlers {
  openUrl(url: string): void;
}
export const linkHandlers = Facet.define<LinkHandlers, LinkHandlers | null>({
  combine: (v) => v[0] ?? null,
});

// Rendered rows are capped so a pathological table can't build a giant DOM;
// the cap is surfaced as a "… N more rows" footer, never silently.
const ROW_CAP = 500;

function renderInline(nodes: Inline[], parent: HTMLElement): void {
  for (const n of nodes) {
    switch (n.t) {
      case "text":
        parent.appendChild(document.createTextNode(n.text));
        break;
      case "code": {
        const el = document.createElement("code");
        el.className = "cm-mdtable-code";
        el.textContent = n.text;
        parent.appendChild(el);
        break;
      }
      case "strong":
      case "em":
      case "strike": {
        const el = document.createElement(n.t === "strong" ? "strong" : n.t === "em" ? "em" : "s");
        renderInline(n.children, el);
        parent.appendChild(el);
        break;
      }
      case "link": {
        const el = document.createElement("span");
        el.className = "cm-mdlink";
        el.dataset.url = n.url;
        el.title = n.url; // hover shows the destination — the click affordance is honest
        el.textContent = n.text || n.url;
        parent.appendChild(el);
        break;
      }
    }
  }
}

class TableWidget extends WidgetType {
  constructor(
    readonly table: TableBlock,
    /** The table's exact source slice — the widget's identity for eq(), so
     *  unrelated edits (and offset shifts) reuse the existing DOM. */
    readonly source: string,
    /** Start offset of each table line within `source`, for click mapping. */
    readonly lineOffsets: number[],
  ) {
    super();
  }

  override eq(other: TableWidget): boolean {
    return other.source === this.source;
  }

  override get estimatedHeight(): number {
    return 36 * (Math.min(this.table.rows.length, ROW_CAP) + 1) + 12;
  }

  // All events are handled by the widget itself (cursor placement, Mod-click
  // links); returning true keeps CM's own mouse handling out of the way.
  override ignoreEvent(): boolean {
    return true;
  }

  private cellPos(row: { line: number; cells: { from: number }[] }, col: number): number {
    const lineOff = this.lineOffsets[row.line - this.table.fromLine] ?? 0;
    return lineOff + (row.cells[col]?.from ?? 0);
  }

  override toDOM(view: EditorView): HTMLElement {
    const t = this.table;
    const wrap = document.createElement("div");
    wrap.className = "cm-mdtable-wrap";
    const table = document.createElement("table");
    table.className = "cm-mdtable";
    const cols = t.align.length;
    const addRow = (
      parent: HTMLElement,
      row: { line: number; cells: { text: string; from: number }[] },
      tag: "th" | "td",
    ) => {
      const tr = document.createElement("tr");
      for (let c = 0; c < cols; c++) {
        const el = document.createElement(tag);
        const a = t.align[c];
        if (a) el.style.textAlign = a;
        el.dataset.pos = String(this.cellPos(row, c));
        const cell = row.cells[c];
        if (cell) renderInline(parseInline(cell.text), el);
        tr.appendChild(el);
      }
      parent.appendChild(tr);
    };
    const thead = document.createElement("thead");
    addRow(thead, t.header, "th");
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    for (const row of t.rows.slice(0, ROW_CAP)) addRow(tbody, row, "td");
    table.appendChild(tbody);
    wrap.appendChild(table);
    if (t.rows.length > ROW_CAP) {
      const more = document.createElement("div");
      more.className = "cm-mdtable-more";
      more.textContent = `… ${t.rows.length - ROW_CAP} more rows — click to edit`;
      wrap.appendChild(more);
    }

    wrap.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return; // leave right/middle click to the browser
      e.preventDefault();
      e.stopPropagation();
      const target = e.target as HTMLElement;
      // A rendered table is display content, not editable text — a PLAIN click on
      // a link follows it (no Mod needed, unlike raw source where click must
      // place the caret). Clicking anywhere else in the cell still edits it.
      const link = target.closest<HTMLElement>("[data-url]");
      if (link?.dataset.url) {
        const h = view.state.facet(linkHandlers);
        if (h) {
          h.openUrl(link.dataset.url);
          return;
        }
      }
      // place the cursor at the clicked cell's source position — the field
      // sees the selection enter the table and reveals it for editing
      const base = view.posAtDOM(wrap);
      const rel = Number(target.closest<HTMLElement>("[data-pos]")?.dataset.pos ?? 0);
      view.dispatch({
        selection: { anchor: Math.min(base + rel, view.state.doc.length) },
        scrollIntoView: true,
      });
      view.focus();
    });
    return wrap;
  }
}

// One stateless instance — every code block shares it (eq() is always true).
class CopyWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }
  override ignoreEvent(): boolean {
    return true;
  }
  override toDOM(view: EditorView): HTMLElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cm-code-copy";
    btn.textContent = "copy";
    btn.setAttribute("aria-label", "Copy code block");
    btn.addEventListener("mousedown", (e) => e.preventDefault()); // keep editor focus
    btn.addEventListener("click", () => {
      const field = view.state.field(blockField, false);
      if (!field) return;
      const doc = view.state.doc;
      const line = doc.lineAt(view.posAtDOM(btn)).number - 1; // 0-based
      const f = field.blocks.fences.find((x) => x.fromLine === line);
      if (!f) return;
      const first = f.fromLine + 1;
      const last = f.closed ? f.toLine - 1 : f.toLine;
      const text =
        first > last ? "" : doc.sliceString(doc.line(first + 1).from, doc.line(last + 1).to);
      navigator.clipboard
        .writeText(text)
        .then(() => {
          btn.textContent = "copied";
          btn.classList.add("is-copied");
          setTimeout(() => {
            btn.textContent = "copy";
            btn.classList.remove("is-copied");
          }, 1200);
        })
        .catch(() => {}); // clipboard denied — the button just stays quiet
    });
    return btn;
  }
}
const copyWidget = new CopyWidget();

// Frontmatter is bookkeeping the app writes for itself (`pinned:`), not content
// the reader asked for — and the sidebar already shows pin state as an icon. So
// preview hides the block outright rather than rendering it as a widget: a
// widget-less block replace collapses the lines to zero height. It is still
// fully editable — the raw YAML returns the moment the selection touches the
// range, same contract as a table — and the gutter keeps the real line numbers,
// so the block is never secretly gone.
const hideBlock = Decoration.replace({ block: true });

/**
 * Document offset where the note's prose starts, past any frontmatter (0 when
 * there is none). Shared by live-preview (which must not decorate inside the
 * block) and the editor's mount (which parks the cursor here, so opening a
 * pinned note doesn't immediately reveal its raw YAML).
 *
 * Only the first line is read unless the doc really opens with `---`, so this
 * is O(1) for the overwhelmingly common note without frontmatter.
 */
export function bodyStart(doc: Text): number {
  // Lazy line access, not a materialized array: live preview calls this on
  // every keystroke, so it has to cost O(frontmatter) — one line read for the
  // overwhelmingly common note that has none.
  const end = frontmatterEndLine(doc.lines, (i) => doc.line(i + 1).text);
  if (end < 0) return 0;
  // The START of the line after the closing fence, not the fence line's end —
  // that offset is still within the block's range, so a caret parked there
  // would count as touching it and reveal the YAML right back.
  return end + 2 <= doc.lines ? doc.line(end + 2).from : doc.length;
}

function scan(state: EditorState): MarkdownBlocks {
  const lines: string[] = [];
  const it = state.doc.iterLines();
  while (!it.next().done) lines.push(it.value);
  return scanBlocks(lines);
}

function lineRange(doc: Text, fromLine: number, toLine: number): { from: number; to: number } {
  return { from: doc.line(fromLine + 1).from, to: doc.line(toLine + 1).to };
}

function tableRange(doc: Text, t: TableBlock): { from: number; to: number } {
  return lineRange(doc, t.fromLine, t.toLine);
}

function touched(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((r) => r.to >= from && r.from <= to);
}

/** Collapsed blocks the selection touches — these show raw source instead. */
interface Revealed {
  tables: Set<number>;
  frontmatter: boolean;
}

function revealedBlocks(state: EditorState, blocks: MarkdownBlocks): Revealed {
  const tables = new Set<number>();
  for (let i = 0; i < blocks.tables.length; i++) {
    const { from, to } = tableRange(state.doc, blocks.tables[i]);
    if (touched(state, from, to)) tables.add(i);
  }
  const fm = blocks.frontmatter;
  let frontmatter = false;
  if (fm) {
    const { from, to } = lineRange(state.doc, fm.fromLine, fm.toLine);
    frontmatter = touched(state, from, to);
  }
  return { tables, frontmatter };
}

// Hoisted line-decoration specs: buildDeco runs on every doc change, so per-line
// Decoration.line allocations would churn on large code-heavy notes. Same
// discipline as live-preview's hoisted specs — only the Range objects are fresh.
const codeblockLine = Decoration.line({ class: "cm-codeblock" });
const codeblockFirst = Decoration.line({ class: "cm-codeblock cm-codeblock-first" });
const codeblockLast = Decoration.line({ class: "cm-codeblock cm-codeblock-last" });
const codeblockOnly = Decoration.line({
  class: "cm-codeblock cm-codeblock-first cm-codeblock-last",
});
const blockquoteLine = Decoration.line({ class: "cm-blockquote" });
const copyButton = Decoration.widget({ widget: copyWidget, side: 1 });

function buildDeco(state: EditorState, blocks: MarkdownBlocks, revealed: Revealed): DecorationSet {
  const doc = state.doc;
  const ranges: Range<Decoration>[] = [];
  const fm = blocks.frontmatter;
  if (fm && !revealed.frontmatter) {
    const { from, to } = lineRange(doc, fm.fromLine, fm.toLine);
    ranges.push(hideBlock.range(from, to));
  }
  for (let i = 0; i < blocks.tables.length; i++) {
    if (revealed.tables.has(i)) continue;
    const t = blocks.tables[i];
    const { from, to } = tableRange(doc, t);
    const lineOffsets: number[] = [];
    for (let ln = t.fromLine; ln <= t.toLine; ln++) lineOffsets.push(doc.line(ln + 1).from - from);
    const widget = new TableWidget(t, doc.sliceString(from, to), lineOffsets);
    ranges.push(Decoration.replace({ widget, block: true }).range(from, to));
  }
  for (const f of blocks.fences) {
    for (let ln = f.fromLine; ln <= f.toLine; ln++) {
      const first = ln === f.fromLine;
      const last = ln === f.toLine && f.closed;
      const deco =
        first && last
          ? codeblockOnly
          : first
            ? codeblockFirst
            : last
              ? codeblockLast
              : codeblockLine;
      ranges.push(deco.range(doc.line(ln + 1).from));
    }
    ranges.push(copyButton.range(doc.line(f.fromLine + 1).to));
  }
  for (const ln of blocks.quotes) {
    ranges.push(blockquoteLine.range(doc.line(ln + 1).from));
  }
  return Decoration.set(ranges, true);
}

interface BlockValue {
  blocks: MarkdownBlocks;
  /** Cheap identity of everything currently revealed — lets selection moves
   *  skip the decoration rebuild entirely. */
  revealKey: string;
  deco: DecorationSet;
}

const key = (r: Revealed): string =>
  (r.frontmatter ? "f" : "") + [...r.tables].sort((a, b) => a - b).join(",");

const blockField = StateField.define<BlockValue>({
  create(state) {
    const blocks = scan(state);
    const revealed = revealedBlocks(state, blocks);
    return { blocks, revealKey: key(revealed), deco: buildDeco(state, blocks, revealed) };
  },
  update(value, tr) {
    if (tr.docChanged) {
      const blocks = scan(tr.state);
      const revealed = revealedBlocks(tr.state, blocks);
      return { blocks, revealKey: key(revealed), deco: buildDeco(tr.state, blocks, revealed) };
    }
    if (tr.selection) {
      const revealed = revealedBlocks(tr.state, value.blocks);
      const k = key(revealed);
      if (k === value.revealKey) return value;
      return {
        blocks: value.blocks,
        revealKey: k,
        deco: buildDeco(tr.state, value.blocks, revealed),
      };
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

// Vertical cursor motion moves by VISUAL position, so a collapsed table — one
// atomic block widget — gets skipped like a closed vim fold: CM's own
// cursorLineUp/Down hops it, and codemirror-vim's j/k explicitly prefer the
// hopped position (moveByLines → findPosV → moveVertically) — leaving no
// keyboard path into the table. Rather than intercepting keys per mode (vim
// handles its keys internally, out of keymap reach), this filter watches for
// the skip's exact signature — a lone empty caret jumping from one line
// adjacent to a collapsed table to the line adjacent on the other side in a
// single selection-only step — and redirects the caret onto the table's edge
// row instead. The field then reveals the source in the same transaction, so
// the caret lands visibly in the raw table.
//
// The signature alone is ambiguous: gg/G, paragraph motions, and search jumps
// that happen to travel between those two lines look identical at the
// transaction level. So a keydown OBSERVER (highest precedence, always passes
// the event on — never a key binding, vim's keys stay out of keymap reach)
// records whether the current event turn is a bare vertical step; the keymap
// handlers dispatch synchronously in that same turn, so the filter reads the
// flag before any other event can overwrite it. An update listener clears it,
// keeping stale flags away from later programmatic selection jumps.
let verticalStepKey = false;
const verticalStepWatcher = [
  Prec.highest(
    EditorView.domEventHandlers({
      keydown(e) {
        verticalStepKey =
          !e.metaKey &&
          !e.ctrlKey &&
          !e.altKey &&
          !e.shiftKey &&
          (e.key === "j" || e.key === "k" || e.key === "ArrowDown" || e.key === "ArrowUp");
        return false; // observe only — the key continues to vim/keymaps
      },
      // A j/k that produced no transaction (caret already at the doc edge)
      // must not leave the flag armed for a later programmatic jump.
      keyup() {
        verticalStepKey = false;
        return false;
      },
    }),
  ),
  EditorView.updateListener.of(() => {
    verticalStepKey = false;
  }),
];

const tableEntry = EditorState.transactionFilter.of((tr) => {
  if (tr.docChanged || !tr.selection || tr.isUserEvent("select.pointer")) return tr;
  if (!verticalStepKey) return tr; // only a vertical STEP may enter a table
  const field = tr.startState.field(blockField, false);
  if (!field || field.blocks.tables.length === 0) return tr;
  const prev = tr.startState.selection;
  const next = tr.newSelection;
  if (prev.ranges.length !== 1 || next.ranges.length !== 1) return tr;
  if (!prev.main.empty || !next.main.empty) return tr;
  const doc = tr.startState.doc; // no doc change — line numbers are stable
  const prevLine = doc.lineAt(prev.main.head).number;
  const nextLine = doc.lineAt(next.main.head).number;
  if (prevLine === nextLine) return tr;
  for (const t of field.blocks.tables) {
    const first = t.fromLine + 1; // 1-based
    const last = t.toLine + 1;
    // a lone cursor outside the table implies it's collapsed (never revealed)
    if (prevLine === last + 1 && nextLine === first - 1) {
      return [tr, { selection: { anchor: doc.line(last).from }, scrollIntoView: true }];
    }
    if (prevLine === first - 1 && nextLine === last + 1) {
      return [tr, { selection: { anchor: doc.line(first).from }, scrollIntoView: true }];
    }
  }
  return tr;
});

export const blockPreview = [blockField, tableEntry, verticalStepWatcher];
