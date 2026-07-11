// markdown.ts — pure block + inline models for the live-preview markdown
// renderer. Like links.ts, this is kept free of CodeMirror/React so the table
// scanner and the cell tokenizer are unit-testable (markdown.test.ts) and
// benchable (perf.bench.ts) in node. The editor side (editor/block-preview.ts)
// maps these line-indexed blocks onto document positions and widgets.
//
// The scanner is line-based on purpose (the same philosophy as the wikilink
// regex scan): it re-derives every block from the raw lines in one pass, so the
// result is deterministic, independent of lezer's incremental parse state, and
// cheap enough to run on every document change (see the scanBlocks bench).

export type Align = "left" | "center" | "right" | null;

export interface TableCell {
  /** Trimmed raw cell source (escapes intact — parseInline resolves them). */
  text: string;
  /** Offset of the cell's first non-space char within its source line, for
   *  mapping a rendered-cell click back to a document position. */
  from: number;
}

export interface TableRow {
  /** 0-based line index within the scanned text. */
  line: number;
  cells: TableCell[];
}

export interface TableBlock {
  /** 0-based inclusive line range: header row … last body row. */
  fromLine: number;
  toLine: number;
  align: Align[];
  header: TableRow;
  rows: TableRow[];
}

export interface FenceBlock {
  /** 0-based inclusive line range: opening fence … closing fence (or the last
   *  scanned line when the fence is never closed). */
  fromLine: number;
  toLine: number;
  closed: boolean;
  lang: string;
}

export interface MarkdownBlocks {
  tables: TableBlock[];
  fences: FenceBlock[];
  /** 0-based indexes of `>`-prefixed blockquote lines. */
  quotes: number[];
}

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const QUOTE = /^ {0,3}>/;
const DELIM_CELL = /^:?-+:?$/;
// A list-item lead-in (`- | a |`) is a list, not a table header.
const LIST_LEAD = /^ {0,3}(?:[-*+]|\d{1,9}[.)])\s/;

const indentOf = (line: string): number => {
  let n = 0;
  while (n < line.length && line[n] === " ") n++;
  return n;
};

/** Split a row into cells on unescaped pipes, per GFM: an optional leading and
 *  trailing pipe are stripped; `\|` does not delimit. Returns null when the
 *  line has no unescaped pipe at all (not a table row). */
export function splitRow(line: string): TableCell[] | null {
  const segs: { from: number; to: number }[] = [];
  let start = 0;
  let sawPipe = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\") {
      i++; // the escaped char can't open a cell boundary
    } else if (ch === "|") {
      sawPipe = true;
      segs.push({ from: start, to: i });
      start = i + 1;
    }
  }
  if (!sawPipe) return null;
  segs.push({ from: start, to: line.length });
  const blank = (s: { from: number; to: number }) => line.slice(s.from, s.to).trim() === "";
  const trimmed = line.trim();
  if (segs.length > 1 && trimmed.startsWith("|") && blank(segs[0])) segs.shift();
  if (segs.length > 1 && trimmed.endsWith("|") && blank(segs[segs.length - 1])) segs.pop();
  return segs.map((s) => {
    const raw = line.slice(s.from, s.to);
    const lead = raw.length - raw.trimStart().length;
    return { text: raw.trim(), from: s.from + lead };
  });
}

/** Parse a delimiter row (`| :--- | ---: |`) into per-column alignments, or
 *  null when the line isn't a valid GFM delimiter row. */
export function parseDelimRow(line: string): Align[] | null {
  if (indentOf(line) > 3) return null;
  const cells = splitRow(line);
  if (!cells || cells.length === 0) return null;
  const align: Align[] = [];
  for (const c of cells) {
    if (!DELIM_CELL.test(c.text)) return null;
    const l = c.text.startsWith(":");
    const r = c.text.endsWith(":");
    align.push(l && r ? "center" : r ? "right" : l ? "left" : null);
  }
  return align;
}

/** One pass over the note's lines: pipe tables (header + delimiter + rows),
 *  fenced code blocks, and blockquote lines. Table detection is skipped inside
 *  fences, on quote lines, and on list items; rows run until a blank line, a
 *  quote, a fence opener, or a line without an unescaped pipe. */
export function scanBlocks(lines: readonly string[]): MarkdownBlocks {
  const tables: TableBlock[] = [];
  const fences: FenceBlock[] = [];
  const quotes: number[] = [];
  let fence: { start: number; marker: string; lang: string } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fence) {
      const m = FENCE.exec(line);
      if (
        m &&
        m[1][0] === fence.marker[0] &&
        m[1].length >= fence.marker.length &&
        m[2].trim() === ""
      ) {
        fences.push({ fromLine: fence.start, toLine: i, closed: true, lang: fence.lang });
        fence = null;
      }
      continue;
    }
    if (line.length === 0) continue;
    if (line.includes("`") || line.includes("~")) {
      const m = FENCE.exec(line);
      // a backtick fence's info string may not contain a backtick (~~~ may)
      if (m && !(m[1][0] === "`" && m[2].includes("`"))) {
        fence = { start: i, marker: m[1], lang: (m[2].trim().split(/\s+/)[0] ?? "").trim() };
        continue;
      }
    }
    if (QUOTE.test(line)) {
      quotes.push(i);
      continue;
    }
    if (!line.includes("|") || indentOf(line) > 3 || i + 1 >= lines.length) continue;
    if (LIST_LEAD.test(line)) continue;
    const align = parseDelimRow(lines[i + 1]);
    if (!align) continue;
    const header = splitRow(line);
    if (!header || header.length !== align.length) continue;
    const rows: TableRow[] = [];
    let j = i + 2;
    for (; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() === "" || QUOTE.test(l) || FENCE.test(l) || !l.includes("|")) break;
      const cells = splitRow(l);
      if (!cells) break;
      rows.push({ line: j, cells });
    }
    tables.push({ fromLine: i, toLine: j - 1, align, header: { line: i, cells: header }, rows });
    i = j - 1;
  }
  if (fence) {
    fences.push({
      fromLine: fence.start,
      toLine: lines.length - 1,
      closed: false,
      lang: fence.lang,
    });
  }
  return { tables, fences, quotes };
}

// ── inline tokenizer ───────────────────────────────────────────────────────
// Just enough inline markdown for rendered table cells: code spans, strong,
// em, strikethrough, wikilinks, and http(s)/mailto links. Everything the
// tokenizer doesn't recognize stays literal text — cells never lose content.

export type Inline =
  | { t: "text"; text: string }
  | { t: "code"; text: string }
  | { t: "strong"; children: Inline[] }
  | { t: "em"; children: Inline[] }
  | { t: "strike"; children: Inline[] }
  | { t: "wikilink"; target: string; display: string | null }
  | { t: "link"; text: string; url: string };

// Sticky regexes, lastIndex set before every exec. parseInline recurses, but
// each exec completes before the recursive call, so the shared state is safe
// (the same non-reentrancy argument as links.ts's module-level /g regexes).
const WIKI_Y = /\[\[([^[\]|\n]+?)(?:\|([^[\]|\n]+?))?\]\]/y;
const LINK_Y = /\[([^\]\n]*)\]\(([^()\s]+)\)/y;
const URL_SCHEME = /^(?:https?|mailto):/i;
const MAX_DEPTH = 6;

const isSpace = (ch: string | undefined): boolean => ch === undefined || /\s/.test(ch);
const isWordy = (ch: string | undefined): boolean => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

/** Find the closing delimiter for an emphasis run: the next `mark` whose
 *  preceding char isn't whitespace (a `* ` can't close). */
function findClose(src: string, mark: string, from: number): number {
  let at = src.indexOf(mark, from);
  while (at !== -1) {
    if (!isSpace(src[at - 1])) return at;
    at = src.indexOf(mark, at + mark.length);
  }
  return -1;
}

export function parseInline(src: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text) {
      out.push({ t: "text", text });
      text = "";
    }
  };
  const wrap = (t: "strong" | "em" | "strike", inner: string) => {
    flush();
    out.push({ t, children: parseInline(inner, depth + 1) });
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "\\" && i + 1 < src.length) {
      text += src[i + 1];
      i++;
      continue;
    }
    if (depth < MAX_DEPTH) {
      if (ch === "`") {
        let run = 1;
        while (src[i + run] === "`") run++;
        const close = src.indexOf("`".repeat(run), i + run);
        if (close !== -1) {
          let code = src.slice(i + run, close);
          // GFM: strip one space from both ends when both are present
          if (code.length > 1 && code.startsWith(" ") && code.endsWith(" "))
            code = code.slice(1, -1);
          flush();
          out.push({ t: "code", text: code });
          i = close + run - 1;
          continue;
        }
      } else if (ch === "[" && src[i + 1] === "[") {
        WIKI_Y.lastIndex = i;
        const m = WIKI_Y.exec(src);
        if (m) {
          flush();
          out.push({ t: "wikilink", target: m[1].trim(), display: m[2] ? m[2].trim() : null });
          i += m[0].length - 1;
          continue;
        }
      } else if (ch === "[" || (ch === "!" && src[i + 1] === "[")) {
        const at = ch === "!" ? i + 1 : i;
        LINK_Y.lastIndex = at;
        const m = LINK_Y.exec(src);
        if (m) {
          flush();
          // images render as their alt text; non-web link targets keep just
          // the label (the widget can't open a relative path anyway)
          if (ch === "!" || !URL_SCHEME.test(m[2])) out.push({ t: "text", text: m[1] });
          else out.push({ t: "link", text: m[1], url: m[2] });
          i = at + m[0].length - 1;
          continue;
        }
      } else if (ch === "*" || ch === "_" || ch === "~") {
        const doubled = src[i + 1] === ch;
        // openers need a following non-space; intraword _ never opens
        const open = !isSpace(src[i + (doubled ? 2 : 1)]) && !(ch === "_" && isWordy(src[i - 1]));
        if (open && ch !== "~" && doubled && src[i + 2] === ch) {
          // ***bold italic*** — the triple run closes on the next triple
          const close = findClose(src, ch.repeat(3), i + 3);
          if (close !== -1) {
            flush();
            out.push({
              t: "strong",
              children: [{ t: "em", children: parseInline(src.slice(i + 3, close), depth + 1) }],
            });
            i = close + 2;
            continue;
          }
        }
        if (open && doubled) {
          const close = findClose(src, ch + ch, i + 2);
          if (close !== -1) {
            wrap(ch === "~" ? "strike" : "strong", src.slice(i + 2, close));
            i = close + 1;
            continue;
          }
        }
        if (open && !doubled && ch !== "~") {
          const close = findClose(src, ch, i + 1);
          if (close !== -1) {
            wrap("em", src.slice(i + 1, close));
            i = close;
            continue;
          }
        }
      }
    }
    text += ch;
  }
  flush();
  return out;
}
