// vim/motions.ts — position math over ProseMirror docs. Everything here is a
// pure function of (doc, pos) — no view, no DOM — so exec.ts stays
// node-testable. j/k's coords-based vertical motion is the ONE injected piece;
// `lineStep` below is its logical twin (the operator semantics of dj/dk, and
// the fallback when a probe finds nothing).
import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
import type { Motion, TextObject } from "./machine";

export interface LineUnit {
  from: number;
  to: number;
  kind: "node" | "codeline";
}

export interface Range {
  from: number;
  to: number;
}

const clamp = (doc: PMNode, pos: number): number => Math.max(0, Math.min(pos, doc.content.size));

const isCode = ($pos: ResolvedPos): boolean =>
  $pos.parent.isTextblock && !!$pos.parent.type.spec.code;

const isItem = (name: string): boolean =>
  name === "listItem" || name === "taskItem" || name === "tableRow";

/** Inside-start of the first textblock within `node` (at `nodePos`), or null
 *  when the node is a leaf block (rule, image, raw-HTML chip). */
export function firstTextblockInside(node: PMNode, nodePos: number): number | null {
  let n: PMNode | null = node;
  let p = nodePos;
  while (n && !n.isTextblock) {
    if (n.isLeaf) return null;
    n = n.firstChild;
    p += 1;
  }
  return n ? p + 1 : null;
}

/** The LINE-UNIT at pos — the one rule every linewise command shares: the
 *  nearest listItem/taskItem/tableRow ancestor; else a textblock nested in a
 *  wrapper (blockquote, callout) is its own line; else the top-level block.
 *  Inside a code block, the current SOURCE LINE. `from`/`to` are node
 *  boundaries for "node" units, text positions for "codeline".
 *
 *  A boundary position (between blocks, between list items) attaches to the
 *  block AFTER it when there is one — so `lineUnits` can walk forward from a
 *  unit's `to` and land on the next sibling, never on the enclosing list. */
export function lineUnitAt(doc: PMNode, pos: number): LineUnit {
  let $pos = doc.resolve(clamp(doc, pos));
  if (!$pos.parent.isTextblock) {
    const after = $pos.nodeAfter;
    const side = after ?? $pos.nodeBefore;
    if (side) {
      const nodePos = after ? $pos.pos : $pos.pos - side.nodeSize;
      const inner = firstTextblockInside(side, nodePos);
      if (inner !== null) {
        $pos = doc.resolve(inner);
      } else {
        // a leaf block: the leaf itself is the line (or its item/row ancestor)
        const $leaf = doc.resolve(nodePos);
        for (let d = $leaf.depth; d >= 1; d--) {
          if (isItem($leaf.node(d).type.name)) {
            return { from: $leaf.before(d), to: $leaf.after(d), kind: "node" };
          }
        }
        if ($leaf.depth === 0) return { from: nodePos, to: nodePos + side.nodeSize, kind: "node" };
        return { from: $leaf.before(1), to: $leaf.after(1), kind: "node" };
      }
    }
  }
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
    if (isItem($pos.node(d).type.name)) {
      return { from: $pos.before(d), to: $pos.after(d), kind: "node" };
    }
  }
  if ($pos.depth >= 2 && $pos.parent.isTextblock) {
    // a paragraph inside a blockquote/callout is its own line; deleting the
    // last one takes the wrapper with it (deleteRange semantics in exec)
    return { from: $pos.before(), to: $pos.after(), kind: "node" };
  }
  if ($pos.depth === 0) {
    const idx = Math.min($pos.index(0), Math.max(0, doc.childCount - 1));
    let from = 0;
    for (let k = 0; k < idx; k++) from += doc.child(k).nodeSize;
    return { from, to: from + doc.child(idx).nodeSize, kind: "node" };
  }
  return { from: $pos.before(1), to: $pos.after(1), kind: "node" };
}

/** The unit after `unit` in document order, or null at the end. Code lines
 *  step within their block, then out to the next textblock's unit. */
export function nextLineUnit(doc: PMNode, unit: LineUnit): LineUnit | null {
  if (unit.kind === "codeline") {
    const $to = doc.resolve(unit.to);
    if (unit.to < $to.end()) return lineUnitAt(doc, unit.to + 1);
    const next = nextTextblockPos(doc, $to.after());
    return next === null ? null : lineUnitAt(doc, next);
  }
  if (unit.to >= doc.content.size) return null;
  const next = nextTextblockPos(doc, unit.to);
  if (next === null) {
    // only leaf blocks remain
    const $to = doc.resolve(unit.to);
    return $to.nodeAfter ? lineUnitAt(doc, unit.to) : null;
  }
  const cand = lineUnitAt(doc, next);
  return cand.from >= unit.to ? cand : null;
}

/** The unit before `unit`, or null at the start. */
export function prevLineUnit(doc: PMNode, unit: LineUnit): LineUnit | null {
  if (unit.kind === "codeline") {
    const $from = doc.resolve(unit.from);
    if (unit.from > $from.start()) return lineUnitAt(doc, unit.from - 1);
    const prev = prevTextblockEnd(doc, $from.before());
    return prev === null ? null : lineUnitAt(doc, prev);
  }
  if (unit.from <= 0) return null;
  const prev = prevTextblockEnd(doc, unit.from);
  const cand = prev === null ? lineUnitAt(doc, unit.from - 1) : lineUnitAt(doc, prev);
  return cand.to <= unit.from ? cand : null;
}

/** `count` consecutive line-units starting at pos (dd/yy/cc with counts),
 *  or walking UP when dir is -1 (dk: the current unit plus count-1 above). */
export function lineUnits(doc: PMNode, pos: number, count: number, dir: 1 | -1 = 1): LineUnit[] {
  const first = lineUnitAt(doc, pos);
  const units = [first];
  let cur = first;
  for (let k = 1; k < count; k++) {
    const next = dir === 1 ? nextLineUnit(doc, cur) : prevLineUnit(doc, cur);
    if (!next) break;
    units.push(next);
    cur = next;
  }
  if (dir === -1) units.reverse();
  return units;
}

/** Every unit from the one at `a` through the one at `b` (either order). */
export function lineUnitsBetween(doc: PMNode, a: number, b: number): LineUnit[] {
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  const last = lineUnitAt(doc, hi);
  const units = [lineUnitAt(doc, lo)];
  let cur = units[0];
  while (cur.from < last.from) {
    const next = nextLineUnit(doc, cur);
    if (!next || next.from <= cur.from) break;
    units.push(next);
    cur = next;
  }
  return units;
}

/** Legacy shape: the span covering `count` units from pos. */
export function lineUnitSpan(doc: PMNode, pos: number, count: number): LineUnit {
  const units = lineUnits(doc, pos, count);
  return { from: units[0].from, to: units[units.length - 1].to, kind: units[0].kind };
}

/** The caret's textblock range (start/end of the current "line" for 0/^/$),
 *  code blocks narrowing to the current source line. */
export function lineTextRange(doc: PMNode, pos: number): Range {
  const $pos = doc.resolve(clamp(doc, pos));
  if (isCode($pos)) {
    const u = lineUnitAt(doc, pos);
    return { from: u.from, to: u.to };
  }
  if (!$pos.parent.isTextblock) {
    const u = lineUnitAt(doc, pos);
    const inner = firstTextblockInside(doc.nodeAt(u.from) ?? doc, u.from);
    if (inner === null) return { from: u.from, to: u.from };
    return lineTextRange(doc, inner);
  }
  return { from: $pos.start(), to: $pos.end() };
}

const lineText = (doc: PMNode, range: Range): string =>
  doc.textBetween(range.from, range.to, "\n", " ");

/** vim's normal-mode cursor rule: never PAST the last character of a
 *  non-empty line (inside a code block: of the current source line). The
 *  block caret sits ON a character, so `$` lands on the last one and `x`
 *  there steps back instead of parking in the void. */
export function clampNormalPos(doc: PMNode, pos: number): number {
  const $pos = doc.resolve(clamp(doc, pos));
  if (!$pos.parent.isTextblock) return $pos.pos;
  const off = $pos.parentOffset;
  if (isCode($pos)) {
    const text = $pos.parent.textContent;
    const atLineEnd = off === text.length || text[off] === "\n";
    if (atLineEnd && off > 0 && text[off - 1] !== "\n") return $pos.pos - 1;
    return $pos.pos;
  }
  const size = $pos.parent.content.size;
  if (off === size && size > 0) return $pos.pos - 1;
  return $pos.pos;
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;

/** Word-motion target for w/b/e, hopping textblocks at the edges. */
export function wordTarget(doc: PMNode, pos: number, which: "w" | "b" | "e"): number {
  const range = lineTextRange(doc, pos);
  const text = lineText(doc, range);
  const off = clamp(doc, pos) - range.from;

  const isWord = (i: number) => i >= 0 && i < text.length && WORD_CHAR.test(text[i]);
  const isWs = (i: number) => i >= 0 && i < text.length && /\s/.test(text[i]);

  if (which === "w") {
    let i = off;
    if (i < text.length) {
      while (i < text.length && !isWs(i) && isWord(i) === isWord(off)) i++;
      while (i < text.length && isWs(i)) i++;
    }
    if (i < text.length) return range.from + i;
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

/** Inside-start of the first textblock whose node position is ≥ `after`. */
export function nextTextblockPos(doc: PMNode, after: number): number | null {
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.isTextblock && pos >= after) {
      found = pos + 1;
      return false;
    }
    return pos + node.nodeSize > after; // skip subtrees that end before `after`
  });
  return found;
}

/** Inside-end of the last textblock that ends before `before`. */
export function prevTextblockEnd(doc: PMNode, before: number): number | null {
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (node.isTextblock && pos + node.nodeSize - 1 < before) {
      found = pos + node.nodeSize - 1;
    }
    return pos < before; // no need to descend past the target
  });
  return found;
}

/** Inside-start of the first textblock at or after `pos`, else the last one
 *  before it — every motion lands in a textblock. */
export function textblockPosNear(doc: PMNode, pos: number): number {
  const $pos = doc.resolve(clamp(doc, pos));
  if ($pos.parent.isTextblock) return $pos.pos;
  return nextTextblockPos(doc, $pos.pos) ?? prevTextblockEnd(doc, $pos.pos) ?? 0;
}

/** Logical vertical step: the line `count` visual lines away (code lines
 *  within their block, else the next/previous textblock), keeping the column. */
export function lineStep(doc: PMNode, pos: number, dir: 1 | -1, count: number): number | null {
  const startRange = lineTextRange(doc, pos);
  const col = clamp(doc, pos) - startRange.from;
  let unit = lineUnitAt(doc, pos);
  let moved = false;
  for (let i = 0; i < count; i++) {
    const next = dir === 1 ? nextLineUnit(doc, unit) : prevLineUnit(doc, unit);
    if (!next) break;
    unit = next;
    moved = true;
  }
  if (!moved) return null;
  const inner =
    unit.kind === "codeline"
      ? unit.from
      : (firstTextblockInside(doc.nodeAt(unit.from) ?? doc, unit.from) ?? unit.from);
  const range = lineTextRange(doc, inner);
  return Math.min(range.from + col, range.to);
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

/** The Nth (1-based, clamped) top-level block's first textblock start —
 *  N G / N gg / :N. A leaf block (rule) yields the nearest textblock. */
export function blockStart(doc: PMNode, n: number): number {
  const idx = Math.max(0, Math.min(n - 1, doc.childCount - 1));
  let pos = 0;
  for (let k = 0; k < idx; k++) pos += doc.child(k).nodeSize;
  const inner = firstTextblockInside(doc.child(idx), pos);
  return inner ?? textblockPosNear(doc, pos);
}

/** Previous/next top-level block start for { and }. */
export function paraTarget(doc: PMNode, pos: number, dir: 1 | -1, count: number): number {
  const $pos = doc.resolve(clamp(doc, pos));
  const idx = $pos.index(0);
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

const OPEN: Record<string, string> = { "(": ")", "[": "]", "{": "}", "<": ">" };
const CLOSE: Record<string, string> = { ")": "(", "]": "[", "}": "{", ">": "<" };

/** The matching bracket's offset within `text`, or -1. */
function matchBracket(text: string, i: number): number {
  const ch = text[i];
  if (OPEN[ch]) {
    let depth = 0;
    for (let k = i; k < text.length; k++) {
      if (text[k] === ch) depth++;
      else if (text[k] === OPEN[ch] && --depth === 0) return k;
    }
    return -1;
  }
  if (CLOSE[ch]) {
    let depth = 0;
    for (let k = i; k >= 0; k--) {
      if (text[k] === ch) depth++;
      else if (text[k] === CLOSE[ch] && --depth === 0) return k;
    }
  }
  return -1;
}

/** vim %: the bracket under the cursor (or the first one after it on the
 *  line) jumps to its match. Line-local. */
export function matchPairTarget(doc: PMNode, pos: number): number | null {
  const range = lineTextRange(doc, pos);
  const text = lineText(doc, range);
  let i = clamp(doc, pos) - range.from;
  while (i < text.length && !OPEN[text[i]] && !CLOSE[text[i]]) i++;
  if (i >= text.length) return null;
  const m = matchBracket(text, i);
  return m === -1 ? null : range.from + m;
}

/** Character class for word objects: 0 blank, 1 word, 2 punctuation. */
const cls = (c: string): number => (/\s/.test(c) ? 0 : WORD_CHAR.test(c) ? 1 : 2);

/** iw / aw over the current line. `around` takes trailing (else leading)
 *  whitespace along, or — on whitespace — the following word. */
function wordObject(text: string, off: number, around: boolean): [number, number] | null {
  if (text.length === 0) return null;
  const i = Math.min(off, text.length - 1);
  const k = cls(text[i]);
  let s = i;
  while (s > 0 && cls(text[s - 1]) === k) s--;
  let e = i + 1;
  while (e < text.length && cls(text[e]) === k) e++;
  if (!around) return [s, e];
  if (k === 0) {
    let e2 = e;
    if (e2 < text.length) {
      const k2 = cls(text[e2]);
      while (e2 < text.length && cls(text[e2]) === k2) e2++;
    }
    return [s, e2];
  }
  let e2 = e;
  while (e2 < text.length && cls(text[e2]) === 0) e2++;
  if (e2 > e) return [s, e2];
  let s2 = s;
  while (s2 > 0 && cls(text[s2 - 1]) === 0) s2--;
  return [s2, e];
}

/** i" / a" (also ' and `): the quote pair around the cursor, else the first
 *  pair after it on the line. Backslash-escaped quotes don't count. */
function quoteObject(
  text: string,
  off: number,
  q: string,
  around: boolean,
): [number, number] | null {
  const qs: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === q && text[i - 1] !== "\\") qs.push(i);
  }
  let pair: [number, number] | null = null;
  for (let k = 0; k + 1 < qs.length; k += 2) {
    if (qs[k] <= off && off <= qs[k + 1]) {
      pair = [qs[k], qs[k + 1]];
      break;
    }
  }
  if (!pair) {
    for (let k = 0; k + 1 < qs.length; k += 2) {
      if (qs[k] > off) {
        pair = [qs[k], qs[k + 1]];
        break;
      }
    }
  }
  if (!pair) return null;
  if (!around) return [pair[0] + 1, pair[1]];
  let e = pair[1] + 1;
  while (e < text.length && /\s/.test(text[e])) e++;
  return [pair[0], e];
}

/** i( / a( and friends: the innermost enclosing pair (the cursor may sit on
 *  either bracket). Line-local, depth-aware. */
function bracketObject(
  text: string,
  off: number,
  open: string,
  around: boolean,
): [number, number] | null {
  const close = OPEN[open];
  const i = Math.min(off, Math.max(0, text.length - 1));
  let o = -1;
  let c = -1;
  if (text[i] === open) {
    o = i;
    c = matchBracket(text, i);
  } else if (text[i] === close) {
    c = i;
    o = matchBracket(text, i);
  } else {
    let depth = 0;
    for (let k = i; k >= 0; k--) {
      if (text[k] === close) depth++;
      else if (text[k] === open) {
        if (depth === 0) {
          o = k;
          break;
        }
        depth--;
      }
    }
    if (o !== -1) c = matchBracket(text, o);
  }
  if (o === -1 || c === -1) return null;
  return around ? [o, c + 1] : [o + 1, c];
}

/** Charwise text-object range at pos, or null when there is none. `p`
 *  (paragraph) is linewise and resolved by the caller through lineUnitAt. */
export function textObjectRange(
  doc: PMNode,
  pos: number,
  obj: TextObject,
  around: boolean,
): Range | null {
  const range = lineTextRange(doc, pos);
  const text = lineText(doc, range);
  const off = clamp(doc, pos) - range.from;
  let r: [number, number] | null;
  switch (obj) {
    case "w":
      r = wordObject(text, off, around);
      break;
    case '"':
    case "'":
    case "`":
      r = quoteObject(text, off, obj, around);
      break;
    case "(":
    case "[":
    case "{":
    case "<":
      r = bracketObject(text, off, obj, around);
      break;
    default:
      return null;
  }
  return r ? { from: range.from + r[0], to: range.from + r[1] } : null;
}

export type { Motion };
