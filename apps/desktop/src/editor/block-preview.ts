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
import { EditorState, Facet, type Range, StateField, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import {
  type Inline,
  type MarkdownBlocks,
  parseInline,
  scanBlocks,
  type TableBlock,
} from "../markdown";
import { modActive } from "./platform";

/** App-level link openers (wikilink → note, url → browser), provided by the
 *  Editor component so table-cell links stay Mod-clickable while rendered. */
export interface LinkHandlers {
  follow(target: string): void;
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
      case "wikilink": {
        const el = document.createElement("span");
        el.className = "cm-wikilink";
        el.dataset.wiki = n.target;
        el.textContent = n.display ?? n.target;
        parent.appendChild(el);
        break;
      }
      case "link": {
        const el = document.createElement("span");
        el.className = "cm-wikilink";
        el.dataset.url = n.url;
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
      const link = target.closest<HTMLElement>("[data-wiki],[data-url]");
      if (link && modActive(e)) {
        const h = view.state.facet(linkHandlers);
        if (h) {
          if (link.dataset.wiki) h.follow(link.dataset.wiki);
          else if (link.dataset.url) h.openUrl(link.dataset.url);
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

function scan(state: EditorState): MarkdownBlocks {
  const lines: string[] = [];
  const it = state.doc.iterLines();
  while (!it.next().done) lines.push(it.value);
  return scanBlocks(lines);
}

function tableRange(doc: Text, t: TableBlock): { from: number; to: number } {
  return { from: doc.line(t.fromLine + 1).from, to: doc.line(t.toLine + 1).to };
}

/** Indexes of tables the selection touches — these show raw source. */
function revealedTables(state: EditorState, blocks: MarkdownBlocks): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < blocks.tables.length; i++) {
    const { from, to } = tableRange(state.doc, blocks.tables[i]);
    for (const r of state.selection.ranges) {
      if (r.to >= from && r.from <= to) {
        out.add(i);
        break;
      }
    }
  }
  return out;
}

function buildDeco(
  state: EditorState,
  blocks: MarkdownBlocks,
  revealed: Set<number>,
): DecorationSet {
  const doc = state.doc;
  const ranges: Range<Decoration>[] = [];
  for (let i = 0; i < blocks.tables.length; i++) {
    if (revealed.has(i)) continue;
    const t = blocks.tables[i];
    const { from, to } = tableRange(doc, t);
    const lineOffsets: number[] = [];
    for (let ln = t.fromLine; ln <= t.toLine; ln++) lineOffsets.push(doc.line(ln + 1).from - from);
    const widget = new TableWidget(t, doc.sliceString(from, to), lineOffsets);
    ranges.push(Decoration.replace({ widget, block: true }).range(from, to));
  }
  for (const f of blocks.fences) {
    for (let ln = f.fromLine; ln <= f.toLine; ln++) {
      const line = doc.line(ln + 1);
      let cls = "cm-codeblock";
      if (ln === f.fromLine) cls += " cm-codeblock-first";
      if (ln === f.toLine && f.closed) cls += " cm-codeblock-last";
      ranges.push(Decoration.line({ class: cls }).range(line.from));
    }
    ranges.push(
      Decoration.widget({ widget: copyWidget, side: 1 }).range(doc.line(f.fromLine + 1).to),
    );
  }
  for (const ln of blocks.quotes) {
    ranges.push(Decoration.line({ class: "cm-blockquote" }).range(doc.line(ln + 1).from));
  }
  return Decoration.set(ranges, true);
}

interface BlockValue {
  blocks: MarkdownBlocks;
  /** Sorted revealed-table indexes — the cheap identity that lets selection
   *  moves skip the decoration rebuild entirely. */
  revealKey: string;
  deco: DecorationSet;
}

const key = (s: Set<number>): string => [...s].sort((a, b) => a - b).join(",");

const blockField = StateField.define<BlockValue>({
  create(state) {
    const blocks = scan(state);
    const revealed = revealedTables(state, blocks);
    return { blocks, revealKey: key(revealed), deco: buildDeco(state, blocks, revealed) };
  },
  update(value, tr) {
    if (tr.docChanged) {
      const blocks = scan(tr.state);
      const revealed = revealedTables(tr.state, blocks);
      return { blocks, revealKey: key(revealed), deco: buildDeco(tr.state, blocks, revealed) };
    }
    if (tr.selection) {
      const revealed = revealedTables(tr.state, value.blocks);
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
const tableEntry = EditorState.transactionFilter.of((tr) => {
  if (tr.docChanged || !tr.selection || tr.isUserEvent("select.pointer")) return tr;
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

export const blockPreview = [blockField, tableEntry];
