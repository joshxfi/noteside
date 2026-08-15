// vim/motions.ts — position math over ProseMirror docs. Everything here is a
// pure function of (doc, pos) — no view, no DOM — so exec.ts stays
// node-testable (j/k's coords-based vertical motion is the ONE injected piece).
import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
import type { Motion } from "./machine";

export interface LineUnit {
  from: number;
  to: number;
  kind: "node" | "codeline";
}

const clamp = (doc: PMNode, pos: number): number => Math.max(0, Math.min(pos, doc.content.size));

const isCode = ($pos: ResolvedPos): boolean =>
  $pos.parent.isTextblock && !!$pos.parent.type.spec.code;

/** The LINE-UNIT at pos — the one rule every linewise command shares: the
 *  nearest ancestor that is a listItem/taskItem/tableRow, else the top-level
 *  block; inside a code block, the current SOURCE LINE. `from`/`to` are node
 *  boundaries for "node" units, text positions for "codeline". */
export function lineUnitAt(doc: PMNode, pos: number): LineUnit {
  const $pos = doc.resolve(clamp(doc, pos));
  if (isCode($pos)) {
    const start = $pos.start();
    const text = $pos.parent.textContent;
    const off = $pos.parentOffset;
    const lineStart = text.lastIndexOf("\n", Math.max(0, off - 1)) + 1;
    let lineEnd = text.indexOf("\n", off);
    if (lineEnd === -1) lineEnd = text.length;
    if (lineEnd < lineStart) lineEnd = lineStart; // caret sitting on the \n
    return { from: start + lineStart, to: start + lineEnd, kind: "codeline" };
  }
  for (let d = $pos.depth; d >= 1; d--) {
    const name = $pos.node(d).type.name;
    if (name === "listItem" || name === "taskItem" || name === "tableRow") {
      return { from: $pos.before(d), to: $pos.after(d), kind: "node" };
    }
  }
  if ($pos.depth === 0) {
    // between top-level blocks: attach to the following block when possible
    const idx = Math.min($pos.index(0), Math.max(0, doc.childCount - 1));
    let from = 0;
    for (let k = 0; k < idx; k++) from += doc.child(k).nodeSize;
    return { from, to: from + doc.child(idx).nodeSize, kind: "node" };
  }
  return { from: $pos.before(1), to: $pos.after(1), kind: "node" };
}

/** `count` consecutive line-units starting at pos (for dd/yy with counts). */
export function lineUnitSpan(doc: PMNode, pos: number, count: number): LineUnit {
  const first = lineUnitAt(doc, pos);
  let last = first;
  for (let k = 1; k < count; k++) {
    const nextPos = last.to + (last.kind === "codeline" ? 1 : 1);
    if (nextPos > doc.content.size) break;
    const next = lineUnitAt(doc, nextPos);
    if (next.from < last.to) break; // didn't advance
    last = next;
  }
  return { from: first.from, to: last.to, kind: first.kind };
}

/** The caret's textblock range (start/end of the current "line" for 0/^/$),
 *  code blocks narrowing to the current source line. */
export function lineTextRange(doc: PMNode, pos: number): { from: number; to: number } {
  const $pos = doc.resolve(clamp(doc, pos));
  if (isCode($pos)) {
    const u = lineUnitAt(doc, pos);
    return { from: u.from, to: u.to };
  }
  if (!$pos.parent.isTextblock) {
    const u = lineUnitAt(doc, pos);
    return { from: Math.min(u.from + 1, doc.content.size), to: Math.max(u.to - 1, 0) };
  }
  return { from: $pos.start(), to: $pos.end() };
}

const lineText = (doc: PMNode, range: { from: number; to: number }): string =>
  doc.textBetween(range.from, range.to, "\n", " ");

const WORD_CHAR = /[\p{L}\p{N}_]/u;

/** Word-motion target for w/b/e, hopping textblocks at the edges. */
export function wordTarget(doc: PMNode, pos: number, which: "w" | "b" | "e"): number {
  const range = lineTextRange(doc, pos);
  const text = lineText(doc, range);
  let off = clamp(doc, pos) - range.from;

  const isWord = (i: number) => i >= 0 && i < text.length && WORD_CHAR.test(text[i]);
  const isWs = (i: number) => i >= 0 && i < text.length && /\s/.test(text[i]);

  if (which === "w") {
    let i = off;
    if (i < text.length) {
      while (i < text.length && !isWs(i) && isWord(i) === isWord(off)) i++;
      while (i < text.length && isWs(i)) i++;
    }
    if (i < text.length || range.to >= doc.content.size)
      return range.from + Math.min(i, text.length);
    // hop to the start of the next textblock
    const next = nextTextblockPos(doc, range.to);
    return next ?? range.from + text.length;
  }
  if (which === "b") {
    let i = off - 1;
    while (i >= 0 && isWs(i)) i--;
    if (i < 0) {
      const prev = prevTextblockEnd(doc, range.from);
      return prev ?? range.from;
    }
    const startWord = isWord(i);
    while (i >= 0 && !isWs(i) && isWord(i) === startWord) i--;
    return range.from + i + 1;
  }
  // e
  let i = off + 1;
  while (i < text.length && isWs(i)) i++;
  if (i >= text.length) {
    const next = nextTextblockPos(doc, range.to);
    return next ?? range.from + Math.max(0, text.length - 1);
  }
  const startWord = isWord(i);
  while (i + 1 < text.length && !isWs(i + 1) && isWord(i + 1) === startWord) i++;
  return range.from + i;
}

function nextTextblockPos(doc: PMNode, after: number): number | null {
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.isTextblock && pos + 1 > after + 1) {
      found = pos + 1;
      return false;
    }
    return true;
  });
  return found;
}

function prevTextblockEnd(doc: PMNode, before: number): number | null {
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (node.isTextblock && pos + node.nodeSize - 1 < before) {
      found = pos + node.nodeSize - 1;
    }
    return pos < before; // no need to descend past the target
  });
  return found;
}

/** f/t/F/T within the current line. Returns null when the char isn't found. */
export function seekTarget(
  doc: PMNode,
  pos: number,
  cmd: "f" | "t" | "F" | "T",
  ch: string,
  count: number,
): number | null {
  const range = lineTextRange(doc, pos);
  const text = lineText(doc, range);
  const off = clamp(doc, pos) - range.from;
  const forward = cmd === "f" || cmd === "t";
  let i = off;
  for (let n = 0; n < count; n++) {
    i = forward ? text.indexOf(ch, i + 1) : text.lastIndexOf(ch, i - 1);
    if (i === -1) return null;
  }
  if (cmd === "t") i -= 1;
  if (cmd === "T") i += 1;
  if (i < 0 || i > text.length) return null;
  return range.from + i;
}

/** The Nth (1-based, clamped) top-level block's inner start — N G / N gg. */
export function blockStart(doc: PMNode, n: number): number {
  const idx = Math.max(0, Math.min(n - 1, doc.childCount - 1));
  let pos = 0;
  for (let k = 0; k < idx; k++) pos += doc.child(k).nodeSize;
  return pos + 1;
}

/** Previous/next top-level block start for { and }. */
export function paraTarget(doc: PMNode, pos: number, dir: 1 | -1, count: number): number {
  const $pos = doc.resolve(clamp(doc, pos));
  const idx = $pos.depth === 0 ? $pos.index(0) : $pos.index(0);
  const target = Math.max(0, Math.min(idx + dir * count, doc.childCount - 1));
  return blockStart(doc, target + 1);
}

/** First non-blank offset of the current line (vim ^). */
export function firstNonBlank(doc: PMNode, pos: number): number {
  const range = lineTextRange(doc, pos);
  const text = lineText(doc, range);
  const i = text.search(/\S/);
  return range.from + (i === -1 ? 0 : i);
}

export type { Motion };
