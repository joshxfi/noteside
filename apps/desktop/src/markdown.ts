// markdown.ts — pure line-level markdown models. Like links.ts, this is kept
// free of the editor engine so everything here is unit-testable
// (markdown.test.ts, goto.test.ts) and benchable (perf.bench.ts) in node.
//
// Two consumers: editor/markdown-io.ts splits frontmatter off with
// scanFrontmatter before text reaches the block editor, and editor/goto.ts
// maps grep-hit source lines onto ProseMirror doc children with scanTopBlocks
// (whose block segmentation is pinned against the real markdown parser).

export type Align = "left" | "center" | "right" | null;

export interface TableCell {
  /** Trimmed raw cell source (escapes intact — parseInline resolves them). */
  text: string;
  /** Offset of the cell's first non-space char within its source line, for
   *  mapping a rendered-cell click back to a document position. */
  from: number;
}

/** The leading `---` YAML block `parse_meta` reads note metadata out of. It is
 *  NOT markdown — lezer has no concept of it and would otherwise parse the
 *  fences as a thematic break plus a setext heading. Only the range matters:
 *  preview hides the block wholesale rather than rendering its keys. */
export interface FrontmatterBlock {
  /** 0-based inclusive line range: opening `---` … closing `---`. */
  fromLine: number;
  toLine: number;
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

/**
 * The leading frontmatter block, or null. Mirrors Rust `split_frontmatter` so
 * the editor hides exactly what `parse_meta` reads: the block must open on line
 * 0 with a bare `---` and is closed by the first later line that is `---` after
 * trailing whitespace. Tolerant — an unclosed block is simply not frontmatter.
 */
export function scanFrontmatter(lines: readonly string[]): FrontmatterBlock | null {
  const end = frontmatterEndLine(lines.length, (i) => lines[i]);
  return end < 0 ? null : { fromLine: 0, toLine: end };
}

/**
 * The rule itself, over a lazy line source: 0-based index of the closing `---`,
 * or -1 for "no frontmatter". Callers holding a CodeMirror `Text` use this
 * directly rather than materializing a line array — live preview asks on every
 * keystroke, so it must cost O(frontmatter), not O(document). `at(0)` short-
 * circuits, so a note without frontmatter reads exactly one line.
 */
export function frontmatterEndLine(lineCount: number, at: (i: number) => string): number {
  if (lineCount === 0 || at(0) !== "---") return -1;
  for (let i = 1; i < lineCount; i++) {
    if (at(i).trimEnd() === "---") return i;
  }
  return -1;
}

/** A top-level block's 0-based inclusive source-line range. Implicit empty
 *  paragraphs (from runs of blank lines — the markdown manager materializes
 *  them so extra spacing survives) get a zero-width range on their gap. */
export interface TopBlock {
  fromLine: number;
  toLine: number;
}

const ATX = /^ {0,3}#{1,6}(\s|$)/;
const SETEXT = /^ {0,3}(=+|-+)\s*$/;
const HR = /^ {0,3}((\* *){3,}|(- *){3,}|(_ *){3,})$/;
const HTML_OPEN = /^ {0,3}</;
const MATH_FENCE = /^\s*\$\$\s*$/;
const ORDERED_LEAD = /^ {0,3}\d{1,9}[.)]\s/;
// Link reference definitions ([ref]: url) parse into link attrs, not blocks.
const LINK_DEF = /^ {0,3}\[[^\]]+\]:\s/;
const isBlank = (l: string) => l.trim() === "";

/**
 * Segment a note BODY (frontmatter already split off — see editor/markdown-io)
 * into top-level blocks the way the editor's markdown parser tokenizes, so a
 * source line number (a grep hit) maps onto a ProseMirror doc child index.
 * Approximate by design: goto.test.ts pins agreement with the real parser
 * across the round-trip vectors, and the caller clamps on any divergence.
 */
export function scanTopBlocks(lines: readonly string[]): TopBlock[] {
  const blocks: TopBlock[] = [];
  // Implicit empty paragraphs for a blank-line run: interior gaps of B blanks
  // yield floor((B+1)/2)−1, boundary (leading/trailing) gaps floor(B/2) —
  // mirrors the manager's paragraph-separator counting.
  const pushEmpties = (gapStart: number, blanks: number, boundary: boolean) => {
    const n = boundary ? Math.floor(blanks / 2) : Math.max(0, Math.floor((blanks + 1) / 2) - 1);
    for (let k = 0; k < n; k++) blocks.push({ fromLine: gapStart, toLine: gapStart });
  };

  let i = 0;
  // leading gap
  let lead = 0;
  while (i < lines.length && isBlank(lines[i])) {
    lead++;
    i++;
  }
  if (lead > 0) pushEmpties(0, lead, true);

  while (i < lines.length) {
    const from = i;
    const line = lines[i];
    let emit = true;

    if (LINK_DEF.test(line)) {
      // definition run — consumed by the parser, no doc child
      emit = false;
      i++;
      while (i < lines.length && LINK_DEF.test(lines[i])) i++;
    } else if (FENCE.test(line)) {
      const marker = (FENCE.exec(line) as RegExpExecArray)[1];
      i++;
      while (i < lines.length) {
        const m = FENCE.exec(lines[i]);
        if (m && m[1][0] === marker[0] && m[1].length >= marker.length && m[2].trim() === "") {
          i++;
          break;
        }
        i++;
      }
    } else if (MATH_FENCE.test(line)) {
      i++;
      while (i < lines.length && !MATH_FENCE.test(lines[i])) i++;
      if (i < lines.length) i++;
    } else if (ATX.test(line)) {
      i++;
    } else if (HR.test(line)) {
      i++;
    } else if (QUOTE.test(line)) {
      // quote run + lazy continuation lines, until a blank line
      i++;
      while (i < lines.length && !isBlank(lines[i])) i++;
    } else if (LIST_LEAD.test(line)) {
      // a list swallows items, indented continuations, and interior blank
      // runs whose next non-blank line still belongs to the SAME KIND of list
      // (a bullet run and an ordered run are two doc children)
      const ordered = ORDERED_LEAD.test(line);
      i++;
      for (;;) {
        while (i < lines.length && !isBlank(lines[i])) i++;
        let j = i;
        while (j < lines.length && isBlank(lines[j])) j++;
        if (
          j < lines.length &&
          ((LIST_LEAD.test(lines[j]) && indentOf(lines[j]) === 0
            ? ORDERED_LEAD.test(lines[j]) === ordered
            : LIST_LEAD.test(lines[j])) ||
            indentOf(lines[j]) >= 2)
        ) {
          i = j;
          continue;
        }
        break;
      }
    } else if (
      i + 1 < lines.length &&
      splitRow(line) !== null &&
      !LIST_LEAD.test(line) &&
      parseDelimRow(lines[i + 1]) !== null
    ) {
      // pipe table: header + delimiter + rows
      i += 2;
      while (i < lines.length && !isBlank(lines[i]) && splitRow(lines[i]) !== null) i++;
    } else if (HTML_OPEN.test(line)) {
      i++;
      while (i < lines.length && !isBlank(lines[i])) i++;
    } else {
      // paragraph: until a blank line or an interrupter; a setext underline
      // folds the run into one heading block
      i++;
      while (i < lines.length) {
        const next = lines[i];
        if (isBlank(next)) break;
        if (SETEXT.test(next)) {
          i++;
          break;
        }
        if (ATX.test(next) || FENCE.test(next) || QUOTE.test(next) || HR.test(next)) break;
        if (
          i + 1 < lines.length &&
          splitRow(next) !== null &&
          parseDelimRow(lines[i + 1]) !== null
        ) {
          break;
        }
        i++;
      }
    }
    if (emit) blocks.push({ fromLine: from, toLine: i - 1 });

    // interior / trailing gap
    let blanks = 0;
    const gapStart = i;
    while (i < lines.length && isBlank(lines[i])) {
      blanks++;
      i++;
    }
    if (blanks > 0) pushEmpties(gapStart, blanks, i >= lines.length);
  }
  return blocks;
}
