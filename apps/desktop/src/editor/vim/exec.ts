// vim/exec.ts — turns machine intents into ProseMirror transactions. STATE in,
// TRANSACTION out: nothing here touches a view, so every edit is node-tested
// against the real schema (exec.test.ts). The two injected behaviors are j/k
// (view coordinates — env.vertical, with motions.lineStep as the logical
// fallback and the operator semantics) and o/O (the glue routes those through
// the editor's own split commands — see index.ts). Mode changes, app hooks,
// scrolling, undo/redo and `.` are the extension's business.
import { Fragment, Slice, type Node as PMNode, type NodeType } from "@tiptap/pm/model";
import { liftListItem, sinkListItem } from "@tiptap/pm/schema-list";
import { EditorState, Selection, TextSelection, type Transaction } from "@tiptap/pm/state";
import { ReplaceStep, replaceStep } from "@tiptap/pm/transform";
import type { Intent, Motion, Operator, VisualKind } from "./machine";
import {
  blockStart,
  clampNormalPos,
  firstNonBlank,
  firstTextblockInside,
  type LineUnit,
  lineStep,
  lineTextRange,
  lineUnitAt,
  lineUnits,
  lineUnitsBetween,
  matchPairTarget,
  nextTextblockPos,
  paraTarget,
  prevTextblockEnd,
  type Range,
  seekTarget,
  textblockPosNear,
  textObjectRange,
  wordTarget,
} from "./motions";
import { getRegister, type RegisterContent, setRegister } from "./registers";

/** The vim-side visual selection: cursor positions (the char under `head` is
 *  INCLUDED, vim-style); the ProseMirror selection is derived from it. */
export interface VisualSel {
  anchor: number;
  head: number;
  kind: VisualKind;
}

export interface ExecEnv {
  vsel: VisualSel | null;
  tabWidth: number;
  /** j/k by view coordinates (sticky goal column). null → logical lineStep. */
  vertical?: (from: number, dir: 1 | -1, count: number) => number | null;
}

export interface ExecResult {
  tr: Transaction | null;
  /** New visual selection: null clears it; undefined leaves it alone. */
  vsel?: VisualSel | null;
  /** o/O — the glue opens the line through the editor's split commands. */
  openLine?: "below" | "above";
  /** * / # — the glue feeds the shared find engine. */
  searchWord?: { word: string; dir: 1 | -1 };
  notify?: string;
}

const clampPos = (doc: PMNode, pos: number): number => Math.max(0, Math.min(pos, doc.content.size));

const isCodeAt = (doc: PMNode, pos: number): boolean => {
  const $pos = doc.resolve(clampPos(doc, pos));
  return $pos.parent.isTextblock && !!$pos.parent.type.spec.code;
};

const isItemType = (name: string): boolean => name === "listItem" || name === "taskItem";

/** Collapse the caret at pos under the normal-mode rule (on a character). */
function normalCaret(tr: Transaction, pos: number, bias: 1 | -1 = 1): Transaction {
  const near = Selection.near(tr.doc.resolve(clampPos(tr.doc, pos)), bias);
  const head = clampNormalPos(tr.doc, near.head);
  return tr.setSelection(head === near.head ? near : TextSelection.create(tr.doc, head));
}

/** Collapse the caret at pos for insert mode (may sit past the last char). */
function insertCaret(tr: Transaction, pos: number): Transaction {
  return tr.setSelection(Selection.near(tr.doc.resolve(clampPos(tr.doc, pos)), 1));
}

// ── visual selection ──────────────────────────────────────────────────

/** The charwise visual range: both cursor characters included. */
export function visualCharRange(doc: PMNode, v: VisualSel): Range {
  const lo = Math.min(v.anchor, v.head);
  const hi = Math.max(v.anchor, v.head);
  const end = Math.min(hi + 1, lineTextRange(doc, hi).to);
  return { from: lo, to: Math.max(lo, end) };
}

/** The ProseMirror selection that displays a visual selection. */
export function visualSelection(doc: PMNode, v: VisualSel): Selection {
  if (v.kind === "line") {
    const a = lineUnitAt(doc, v.anchor);
    const h = lineUnitAt(doc, v.head);
    const forward = h.from >= a.from;
    return TextSelection.between(
      doc.resolve(forward ? a.from : a.to),
      doc.resolve(forward ? h.to : h.from),
    );
  }
  const r = visualCharRange(doc, v);
  const forward = v.head >= v.anchor;
  return TextSelection.between(
    doc.resolve(forward ? r.from : r.to),
    doc.resolve(forward ? r.to : r.from),
  );
}

/** Adopt a ranged ProseMirror selection (a mouse drag) as a charwise visual
 *  selection such that visualCharRange gives back exactly that range. */
export function adoptSelection(sel: Selection): VisualSel {
  if (sel.head >= sel.anchor) {
    return { anchor: sel.anchor, head: Math.max(sel.anchor, sel.head - 1), kind: "char" };
  }
  return { anchor: Math.max(sel.head, sel.anchor - 1), head: sel.head, kind: "char" };
}

/** The units a visual selection covers. */
function visualUnits(doc: PMNode, v: VisualSel): LineUnit[] {
  return lineUnitsBetween(doc, v.anchor, v.head);
}

// ── motions ───────────────────────────────────────────────────────────

const LINEWISE = new Set<Motion["t"]>(["line", "docStart", "docEnd", "blockJump", "para"]);
const isLinewise = (m: Motion): boolean => LINEWISE.has(m.t) || (m.t === "object" && m.obj === "p");

/** Target position for a cursor motion (null = the motion failed; vim beeps).
 *  `forOp` confines word motions to the textblock and makes j/k logical. */
export function motionTarget(
  doc: PMNode,
  pos: number,
  motion: Motion,
  count: number,
  env?: Pick<ExecEnv, "vertical">,
  forOp = false,
): number | null {
  switch (motion.t) {
    case "char": {
      const r = lineTextRange(doc, pos);
      return motion.dir === 1 ? Math.min(pos + count, r.to) : Math.max(pos - count, r.from);
    }
    case "line": {
      if (!forOp && env?.vertical) {
        const v = env.vertical(pos, motion.dir, count);
        if (v !== null) return v;
      }
      return lineStep(doc, pos, motion.dir, count);
    }
    case "word": {
      let p = pos;
      for (let i = 0; i < count; i++) p = wordTarget(doc, p, motion.which);
      if (forOp) {
        const r = lineTextRange(doc, pos);
        if (p > r.to) p = r.to;
        if (p < r.from) p = r.from;
      }
      return p;
    }
    case "lineStart":
      return lineTextRange(doc, pos).from;
    case "lineFirstNonBlank":
      return firstNonBlank(doc, pos);
    case "lineEnd":
      return lineTextRange(doc, pos).to;
    case "docStart":
      return firstNonBlank(doc, nextTextblockPos(doc, 0) ?? 0);
    case "docEnd": {
      const end = prevTextblockEnd(doc, doc.content.size + 1);
      return end === null ? doc.content.size : firstNonBlank(doc, end);
    }
    case "blockJump":
      return firstNonBlank(doc, blockStart(doc, motion.n));
    case "para":
      return paraTarget(doc, pos, motion.dir, count);
    case "seek":
      return seekTarget(doc, pos, motion.cmd, motion.ch, count);
    case "matchPair":
      return matchPairTarget(doc, pos);
    case "object": {
      const r = textObjectRange(doc, pos, motion.obj, motion.around);
      return r ? r.from : null;
    }
  }
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;
const cls = (c: string): number => (/\s/.test(c) ? 0 : WORD_CHAR.test(c) ? 1 : 2);

/** The charwise range an operator + motion covers, applying vim's
 *  inclusive/exclusive rules, the `cw`→`ce` special case, and the
 *  textblock confinement (operators never cross a block boundary charwise). */
function operatorRange(
  doc: PMNode,
  head: number,
  motion: Motion,
  count: number,
  op: Operator,
): Range | null {
  const r = lineTextRange(doc, head);
  if (motion.t === "object") {
    return motion.obj === "p" ? null : textObjectRange(doc, head, motion.obj, motion.around);
  }
  if (op === "c" && motion.t === "word" && motion.which === "w") {
    // "cw" on a non-blank changes to the END of the word (no trailing blank),
    // and c2w to the end of the second word — vim's documented special case
    const text = doc.textBetween(r.from, r.to, "\n", " ");
    const off = head - r.from;
    if (off < text.length && cls(text[off]) !== 0) {
      let e = off;
      for (let n = 0; n < count; n++) {
        if (n > 0) while (e < text.length && cls(text[e]) === 0) e++;
        if (e >= text.length) break;
        const k = cls(text[e]);
        while (e < text.length && cls(text[e]) === k) e++;
      }
      return { from: head, to: r.from + e };
    }
  }
  const target = motionTarget(doc, head, motion, count, undefined, true);
  if (target === null) return null;
  const inclusive =
    (motion.t === "word" && motion.which === "e") ||
    (motion.t === "seek" && (motion.cmd === "f" || motion.cmd === "t")) ||
    motion.t === "matchPair";
  const from = Math.min(head, target);
  let to = Math.max(head, target);
  if (inclusive) to = Math.min(to + 1, lineTextRange(doc, to).to);
  return { from, to };
}

/** The units a linewise operator motion covers (dj dk dG dgg d} dip …). */
function operatorUnits(doc: PMNode, head: number, motion: Motion, count: number): LineUnit[] {
  switch (motion.t) {
    case "line":
      return lineUnits(doc, head, count + 1, motion.dir);
    case "docEnd":
      return lineUnitsBetween(doc, head, doc.content.size);
    case "docStart":
      return lineUnitsBetween(doc, 0, head);
    case "blockJump":
      return lineUnitsBetween(doc, head, blockStart(doc, motion.n));
    case "para": {
      // to the block boundary: the current unit up to (not including) the target
      const target = paraTarget(doc, head, motion.dir, count);
      const units = lineUnitsBetween(doc, head, target);
      const cur = lineUnitAt(doc, head);
      const kept = units.filter((u) =>
        motion.dir === 1
          ? u.from < lineUnitAt(doc, target).from
          : u.from > lineUnitAt(doc, target).from || u.from === cur.from,
      );
      return kept.length ? kept : [cur];
    }
    default:
      return lineUnits(doc, head, count);
  }
}

// ── registers ─────────────────────────────────────────────────────────

function yankUnits(doc: PMNode, units: LineUnit[]): void {
  const first = units[0];
  const last = units[units.length - 1];
  if (first.kind === "codeline") {
    setRegister({
      type: "lines",
      text: units.map((u) => doc.textBetween(u.from, u.to, "\n")).join("\n"),
    });
  } else {
    setRegister({ type: "nodes", fragment: doc.slice(first.from, last.to).content });
  }
}

function yankRange(doc: PMNode, r: Range): void {
  setRegister({ type: "text", text: doc.textBetween(r.from, r.to, "\n", " ") });
}

// ── linewise edits ────────────────────────────────────────────────────

/** Delete one unit as it stands in tr.doc (a code line takes one boundary
 *  newline with it; a node unit uses deleteRange, so the sole item of a list,
 *  the last row of a table, or the last paragraph of a quote takes the empty
 *  wrapper along instead of violating the schema). */
function deleteUnit(tr: Transaction, unit: LineUnit): void {
  const doc = tr.doc;
  if (unit.kind === "codeline") {
    let { from, to } = unit;
    const $from = doc.resolve(from);
    if (to < $from.end()) to += 1;
    else if (from > $from.start()) from -= 1;
    tr.delete(from, to);
    return;
  }
  tr.deleteRange(unit.from, unit.to);
}

/** Delete units back to front (earlier positions stay valid), re-resolving
 *  each against the current document. */
function deleteUnits(tr: Transaction, units: LineUnit[]): void {
  for (let i = units.length - 1; i >= 0; i--) {
    const from = tr.mapping.map(units[i].from, 1);
    if (from >= tr.doc.content.size && units[i].kind === "node") continue;
    deleteUnit(tr, lineUnitAt(tr.doc, Math.min(from, tr.doc.content.size)));
  }
}

/** An empty node standing in for `node` after cc/S: same block flavor. */
function emptyLike(node: PMNode, schema: PMNode["type"]["schema"]): PMNode {
  const para = schema.nodes.paragraph.create();
  if (isItemType(node.type.name)) return node.type.create(node.attrs, para);
  if (node.isTextblock) return node.type.create(node.attrs);
  return para;
}

/** cc / S / cj — clear the units to one empty line of the first unit's kind. */
function changeUnits(tr: Transaction, units: LineUnit[]): ExecResult {
  const doc = tr.doc;
  const first = units[0];
  const last = units[units.length - 1];
  if (first.kind === "codeline") {
    tr.delete(first.from, last.to);
    return { tr: insertCaret(tr, first.from) };
  }
  const node = doc.nodeAt(first.from);
  if (!node) return { tr: null };
  if (node.type.name === "tableRow") {
    // "change the row" = clear its cells; the row structure stays
    for (let i = units.length - 1; i >= 0; i--) {
      const row = tr.doc.nodeAt(units[i].from);
      if (!row) continue;
      let pos = units[i].from + 1 + row.content.size;
      for (let c = row.childCount - 1; c >= 0; c--) {
        const cell = row.child(c);
        pos -= cell.nodeSize;
        tr.replaceWith(
          pos + 1,
          pos + cell.nodeSize - 1,
          tr.doc.type.schema.nodes.paragraph.create(),
        );
      }
    }
    return { tr: insertCaret(tr, first.from + 1) };
  }
  const replacement = emptyLike(node, doc.type.schema);
  try {
    tr.replaceWith(first.from, last.to, replacement);
  } catch {
    deleteUnits(tr, units);
    const at = Math.min(first.from, tr.doc.content.size);
    tr.insert(at, doc.type.schema.nodes.paragraph.create());
  }
  return { tr: insertCaret(tr, first.from + 1) };
}

/** >> / << on list items — PM's own sink/lift over a selection spanning the
 *  units, grafted onto a transaction over the caller's state. */
function shiftItems(
  state: EditorState,
  range: Range,
  op: ">" | "<",
  itemType: NodeType,
): Transaction | null {
  const sel = TextSelection.between(
    state.doc.resolve(range.from + 1),
    state.doc.resolve(Math.max(range.from + 1, range.to - 1)),
  );
  const tmp = EditorState.create({ doc: state.doc, selection: sel });
  let out: Transaction | null = null;
  const ok = (op === ">" ? sinkListItem : liftListItem)(itemType)(tmp, (t) => {
    out = t;
  });
  if (!ok || !out) return null;
  const tr = state.tr.setSelection(sel);
  for (const step of (out as Transaction).steps) tr.step(step);
  return tr;
}

function shiftUnits(
  state: EditorState,
  units: LineUnit[],
  op: ">" | "<",
  tabWidth: number,
): ExecResult {
  const doc = state.doc;
  const first = units[0];
  const last = units[units.length - 1];
  if (first.kind === "codeline") {
    const tr = state.tr;
    const pad = " ".repeat(tabWidth);
    for (let i = units.length - 1; i >= 0; i--) {
      const u = units[i];
      if (op === ">") {
        tr.insertText(pad, u.from);
      } else {
        const text = tr.doc.textBetween(u.from, u.to, "\n");
        const n = Math.min(tabWidth, text.length - text.trimStart().length);
        if (n > 0) tr.delete(u.from, u.from + n);
      }
    }
    return { tr: normalCaret(tr, firstNonBlank(tr.doc, first.from)) };
  }
  const node = doc.nodeAt(first.from);
  if (!node || !isItemType(node.type.name)) return { tr: null };
  const tr = shiftItems(state, { from: first.from, to: last.to }, op, node.type);
  if (!tr) return { tr: null };
  return { tr: normalCaret(tr, firstNonBlank(tr.doc, tr.selection.from)) };
}

/** Run an operator over whole units (dd/yy/cc/>>/<<, dj/dG/…, visual-line). */
function operateUnits(
  state: EditorState,
  units: LineUnit[],
  op: Operator,
  env: ExecEnv,
  head: number,
): ExecResult {
  if (units.length === 0) return { tr: null };
  const doc = state.doc;
  const first = units[0];
  if (op === ">" || op === "<") return shiftUnits(state, units, op, env.tabWidth);
  yankUnits(doc, units);
  const tr = state.tr;
  if (op === "y") {
    // the cursor lands on the first yanked line (yk moves up; yy/yj stay)
    if (first.from < lineUnitAt(doc, head).from) {
      normalCaret(tr, firstNonBlank(doc, textblockPosNear(doc, first.from)));
      return { tr };
    }
    return { tr: null };
  }
  if (op === "c") return changeUnits(tr, units);
  deleteUnits(tr, units);
  const at = Math.min(first.from, tr.doc.content.size);
  return { tr: normalCaret(tr, firstNonBlank(tr.doc, textblockPosNear(tr.doc, at))) };
}

/** Run an operator over a charwise range (dw ce y$ x, visual-char d/c/y). */
function operateChars(state: EditorState, r: Range, op: Operator): ExecResult {
  if (r.from >= r.to) return { tr: null };
  yankRange(state.doc, r);
  const tr = state.tr;
  if (op === "y") return { tr: normalCaret(tr, r.from) };
  tr.delete(r.from, r.to);
  return { tr: op === "c" ? insertCaret(tr, r.from) : normalCaret(tr, r.from) };
}

// ── paste ─────────────────────────────────────────────────────────────

function tryInsert(tr: Transaction, at: number, frag: Fragment): boolean {
  const before = tr.steps.length;
  try {
    tr.insert(at, frag);
  } catch {
    return false;
  }
  return tr.steps.length > before;
}

/** Items outside a list get their list back; anything else stays as is. */
function wrapItems(frag: Fragment, schema: PMNode["type"]["schema"]): Fragment | null {
  if (frag.childCount === 0) return null;
  let kind: string | null = null;
  for (let i = 0; i < frag.childCount; i++) {
    const n = frag.child(i).type.name;
    if (!isItemType(n) || (kind && kind !== n)) return null;
    kind = n;
  }
  const list = kind === "taskItem" ? schema.nodes.taskList : schema.nodes.bulletList;
  return list ? Fragment.from(list.create(null, frag)) : null;
}

/** Insert block units at a unit boundary, falling back to a wrapped list and
 *  then to the top-level boundary before giving up. */
function pasteNodes(
  tr: Transaction,
  at: number,
  head: number,
  before: boolean,
  frag: Fragment,
): ExecResult {
  const schema = tr.doc.type.schema;
  const $head = tr.doc.resolve(clampPos(tr.doc, head));
  const topAt = $head.depth === 0 ? at : before ? $head.before(1) : $head.after(1);
  const wrapped = wrapItems(frag, schema);
  const ok =
    tryInsert(tr, at, frag) ||
    (wrapped !== null && tryInsert(tr, at, wrapped)) ||
    (topAt !== at && tryInsert(tr, topAt, frag)) ||
    (wrapped !== null && topAt !== at && tryInsert(tr, topAt, wrapped));
  if (!ok) return { tr: null, notify: "can't paste that here" };
  const lastStep = tr.steps[tr.steps.length - 1];
  const start = lastStep instanceof ReplaceStep ? lastStep.from : at;
  return { tr: normalCaret(tr, firstNonBlank(tr.doc, textblockPosNear(tr.doc, start))) };
}

/** p / P at the cursor; `linewiseTarget` makes charwise text land as its own
 *  line (pasting over a visual-line selection). */
function pasteAt(
  tr: Transaction,
  head: number,
  reg: RegisterContent,
  before: boolean,
  count: number,
  linewiseTarget = false,
): ExecResult {
  const doc = tr.doc;
  const schema = doc.type.schema;
  if (reg.type === "text") {
    const text = reg.text.repeat(Math.max(1, count));
    if (linewiseTarget) {
      const unit = lineUnitAt(doc, head);
      const at = before ? unit.from : unit.to;
      if (isCodeAt(doc, head)) {
        tr.insertText(before ? text + "\n" : "\n" + text, at);
        return { tr: normalCaret(tr, before ? at : at + 1) };
      }
      const para = schema.nodes.paragraph.create(null, text ? [schema.text(text)] : []);
      return pasteNodes(tr, at, head, before, Fragment.from(para));
    }
    const r = lineTextRange(doc, head);
    const at = before || head >= r.to ? head : head + 1;
    tr.insertText(text, at);
    return { tr: normalCaret(tr, at + text.length - 1) };
  }
  const unit = lineUnitAt(doc, head);
  const at = before ? unit.from : unit.to;
  if (reg.type === "lines") {
    const text = Array.from({ length: Math.max(1, count) }, () => reg.text).join("\n");
    if (isCodeAt(doc, head)) {
      tr.insertText(before ? text + "\n" : "\n" + text, at);
      return { tr: normalCaret(tr, before ? at : at + 1) };
    }
    // code lines pasted outside a code block become paragraphs
    const paras = text
      .split("\n")
      .map((l) => schema.nodes.paragraph.create(null, l ? [schema.text(l)] : []));
    return pasteNodes(tr, at, head, before, Fragment.from(paras));
  }
  let frag = reg.fragment;
  for (let i = 1; i < count; i++) frag = frag.append(reg.fragment);
  return pasteNodes(tr, at, head, before, frag);
}

// ── small edits ───────────────────────────────────────────────────────

/** Rewrite every text node inside the range (back to front, so a length
 *  change never shifts a pending position). Marks survive. */
function mapText(tr: Transaction, r: Range, fn: (s: string) => string): void {
  const slices: { from: number; to: number; text: string }[] = [];
  tr.doc.nodesBetween(r.from, r.to, (node, pos) => {
    if (!node.isText || !node.text) return true;
    const from = Math.max(r.from, pos);
    const to = Math.min(r.to, pos + node.nodeSize);
    if (from < to) slices.push({ from, to, text: node.text.slice(from - pos, to - pos) });
    return false;
  });
  for (let i = slices.length - 1; i >= 0; i--) {
    const s = slices[i];
    const next = fn(s.text);
    if (next !== s.text) tr.insertText(next, s.from, s.to);
  }
}

const CASE_FN = {
  toggle: (s: string) =>
    Array.from(s, (c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join(""),
  upper: (s: string) => s.toUpperCase(),
  lower: (s: string) => s.toLowerCase(),
};

/** J once, from the textblock at pos. Returns the join position, or null when
 *  there is nothing joinable (last line; a different structure below). */
function joinOnce(tr: Transaction, pos: number): number | null {
  const doc = tr.doc;
  const $pos = doc.resolve(clampPos(doc, pos));
  if (!$pos.parent.isTextblock) return null;
  if ($pos.parent.type.spec.code) {
    const u = lineUnitAt(doc, $pos.pos);
    const start = $pos.start();
    const text = $pos.parent.textContent;
    const nl = u.to - start;
    if (nl >= text.length) return null; // last source line
    let e = nl + 1;
    while (e < text.length && (text[e] === " " || text[e] === "\t")) e++;
    const leftEmpty = u.to === u.from;
    const leftWs = !leftEmpty && /\s/.test(text[nl - 1]);
    const rightEmpty = e >= text.length || text[e] === "\n";
    const sep = leftEmpty || leftWs || rightEmpty ? "" : " ";
    if (sep) tr.insertText(sep, u.to, start + e);
    else tr.delete(u.to, start + e);
    return u.to;
  }
  const curEnd = $pos.end();
  const nextStart = nextTextblockPos(doc, $pos.after());
  if (nextStart === null) return null;
  const $next = doc.resolve(nextStart);
  const d = $pos.depth;
  const siblings = $next.depth === d && $pos.node(d - 1) === $next.node(d - 1);
  const siblingItems =
    $next.depth === d &&
    d >= 2 &&
    isItemType($pos.node(d - 1).type.name) &&
    isItemType($next.node(d - 1).type.name) &&
    $pos.node(d - 2) === $next.node(d - 2);
  if (!siblings && !siblingItems) return null;
  const step = replaceStep(doc, curEnd, nextStart, Slice.empty);
  if (
    !(step instanceof ReplaceStep) ||
    step.from !== curEnd ||
    step.slice.size >= nextStart - curEnd
  ) {
    return null;
  }
  tr.step(step);
  const $j = tr.doc.resolve(curEnd);
  if (!$j.parent.isTextblock) return null;
  const rest = tr.doc.textBetween(curEnd, $j.end(), "\n", " ");
  let n = 0;
  while (n < rest.length && (rest[n] === " " || rest[n] === "\t")) n++;
  const leftEmpty = $j.parentOffset === 0;
  const leftWs = !leftEmpty && /\s/.test(tr.doc.textBetween(curEnd - 1, curEnd, "\n", " "));
  const rightEmpty = rest.trim() === "";
  const sep = leftEmpty || leftWs || rightEmpty ? "" : " ";
  if (sep) tr.insertText(sep, curEnd, curEnd + n);
  else if (n > 0) tr.delete(curEnd, curEnd + n);
  return curEnd;
}

const WORD_AT = /[\p{L}\p{N}_]/u;

function wordAtCaret(doc: PMNode, pos: number): string | null {
  const range = lineTextRange(doc, pos);
  const text = doc.textBetween(range.from, range.to, "\n", " ");
  let i = clampPos(doc, pos) - range.from;
  if (i >= text.length || !WORD_AT.test(text[i])) {
    while (i < text.length && !WORD_AT.test(text[i])) i++;
  }
  if (i >= text.length) return null;
  let start = i;
  while (start > 0 && WORD_AT.test(text[start - 1])) start--;
  let end = i;
  while (end + 1 < text.length && WORD_AT.test(text[end + 1])) end++;
  return text.slice(start, end + 1);
}

// ── the dispatcher ────────────────────────────────────────────────────

/** Apply one DOCUMENT intent to `state`. Returns null for intents exec
 *  doesn't own (mode/app/scroll/find/undo/repeat — the extension's). */
export function execIntent(state: EditorState, intent: Intent, env: ExecEnv): ExecResult | null {
  const doc = state.doc;
  const vsel = env.vsel;
  const head = vsel ? vsel.head : state.selection.head;

  switch (intent.kind) {
    case "move": {
      const m = intent.motion;
      if (vsel) {
        let next: VisualSel;
        if (m.t === "object") {
          if (m.obj === "p") {
            const u = lineUnitAt(doc, head);
            const inner = firstTextblockInside(doc.nodeAt(u.from) ?? doc, u.from) ?? u.from;
            next = { anchor: inner, head: inner, kind: "line" };
          } else {
            const r = textObjectRange(doc, head, m.obj, m.around);
            if (!r || r.from >= r.to) return { tr: null };
            next = { ...vsel, anchor: r.from, head: Math.max(r.from, r.to - 1) };
          }
        } else {
          const target = motionTarget(doc, head, m, intent.count, env);
          if (target === null) return { tr: null };
          next = { ...vsel, head: clampNormalPos(doc, textblockPosNear(doc, target)) };
        }
        return {
          tr: state.tr.setSelection(visualSelection(doc, next)).scrollIntoView(),
          vsel: next,
        };
      }
      const target = motionTarget(doc, head, m, intent.count, env);
      if (target === null) return { tr: null }; // a failed seek — vim no-ops
      return { tr: normalCaret(state.tr, target, target >= head ? 1 : -1).scrollIntoView() };
    }

    case "operate": {
      const { op, motion, count } = intent;
      if (isLinewise(motion)) {
        const units =
          motion.t === "object" ? lineUnits(doc, head, 1) : operatorUnits(doc, head, motion, count);
        return operateUnits(state, units, op, env, head);
      }
      if (op === ">" || op === "<")
        return shiftUnits(state, lineUnits(doc, head, 1), op, env.tabWidth);
      const r = operatorRange(doc, head, motion, count, op);
      if (!r) return { tr: null };
      const res = operateChars(state, r, op);
      return res.tr ? { ...res, tr: res.tr.scrollIntoView() } : res;
    }

    case "operateLines":
      return operateUnits(state, lineUnits(doc, head, intent.count), intent.op, env, head);

    case "operateSelection": {
      if (!vsel) return { tr: null };
      const res =
        vsel.kind === "line" || intent.op === ">" || intent.op === "<"
          ? operateUnits(state, visualUnits(doc, vsel), intent.op, env, head)
          : operateChars(state, visualCharRange(doc, vsel), intent.op);
      if (!res.tr && intent.op !== "c") {
        // nothing changed — still collapse the selection to the cursor
        return { tr: normalCaret(state.tr, Math.min(vsel.anchor, vsel.head)), vsel: null };
      }
      return { ...res, vsel: null };
    }

    case "deleteChar": {
      const r = lineTextRange(doc, head);
      const range = intent.before
        ? { from: Math.max(r.from, head - intent.count), to: head }
        : { from: head, to: Math.min(r.to, head + intent.count) };
      if (range.from >= range.to) return { tr: null };
      yankRange(doc, range);
      const tr = state.tr.delete(range.from, range.to);
      return { tr: normalCaret(tr, range.from).scrollIntoView() };
    }

    case "paste": {
      const reg = getRegister();
      if (!reg) return { tr: null };
      const res = pasteAt(state.tr, head, reg, intent.before, intent.count);
      return res.tr ? { ...res, tr: res.tr.scrollIntoView() } : res;
    }

    case "pasteSelection": {
      if (!vsel) return { tr: null };
      const reg = getRegister();
      if (!reg) return { tr: normalCaret(state.tr, Math.min(vsel.anchor, vsel.head)), vsel: null };
      const tr = state.tr;
      if (vsel.kind === "line") {
        const units = visualUnits(doc, vsel);
        deleteUnits(tr, units);
        const at = Math.min(units[0].from, tr.doc.content.size);
        const res = pasteAt(tr, at, reg, true, 1, true);
        return { ...res, tr: res.tr ?? normalCaret(tr, at), vsel: null };
      }
      const r = visualCharRange(doc, vsel);
      tr.delete(r.from, r.to);
      const res = pasteAt(tr, r.from, reg, true, 1);
      return { ...res, tr: res.tr ?? normalCaret(tr, r.from), vsel: null };
    }

    case "replaceChar": {
      const r = lineTextRange(doc, head);
      if (head + intent.count > r.to) return { tr: null };
      const tr = state.tr.insertText(intent.ch.repeat(intent.count), head, head + intent.count);
      return { tr: normalCaret(tr, head + intent.count - 1) };
    }

    case "caseChange": {
      let r: Range;
      if (intent.selection && vsel) {
        if (vsel.kind === "line") {
          const units = visualUnits(doc, vsel);
          r = { from: units[0].from, to: units[units.length - 1].to };
        } else {
          r = visualCharRange(doc, vsel);
        }
      } else {
        const line = lineTextRange(doc, head);
        r = { from: head, to: Math.min(line.to, head + intent.count) };
      }
      if (r.from >= r.to) return { tr: null, vsel: intent.selection ? null : undefined };
      const tr = state.tr;
      mapText(tr, r, CASE_FN[intent.to]);
      if (intent.selection) return { tr: normalCaret(tr, r.from), vsel: null };
      return { tr: normalCaret(tr, r.to) };
    }

    case "join": {
      const tr = state.tr;
      let pos: number;
      let joins: number;
      if (intent.selection && vsel) {
        const units = visualUnits(doc, vsel);
        const u = units[0];
        pos =
          u.kind === "codeline"
            ? u.from
            : (firstTextblockInside(doc.nodeAt(u.from) ?? doc, u.from) ?? u.from);
        joins = Math.max(1, units.length - 1);
      } else {
        pos = head;
        joins = Math.max(1, intent.count - 1);
      }
      let last: number | null = null;
      for (let i = 0; i < joins; i++) {
        const j = joinOnce(tr, pos);
        if (j === null) break;
        last = j;
        pos = j;
      }
      if (last === null) {
        return intent.selection ? { tr: normalCaret(state.tr, pos), vsel: null } : { tr: null };
      }
      return {
        tr: normalCaret(tr, last).scrollIntoView(),
        vsel: intent.selection ? null : undefined,
      };
    }

    case "insert": {
      if (intent.where === "below" || intent.where === "above") {
        return { tr: null, openLine: intent.where };
      }
      const r = lineTextRange(doc, head);
      let target = head;
      if (intent.where === "after") target = Math.min(head + 1, r.to);
      else if (intent.where === "lineStart") target = firstNonBlank(doc, head);
      else if (intent.where === "lineEnd") target = r.to;
      if (target === state.selection.head && state.selection.empty) return { tr: null };
      return { tr: insertCaret(state.tr, target).scrollIntoView() };
    }

    case "visualSwap": {
      if (!vsel) return { tr: null };
      const next = { ...vsel, anchor: vsel.head, head: vsel.anchor };
      return { tr: state.tr.setSelection(visualSelection(doc, next)).scrollIntoView(), vsel: next };
    }

    case "searchWord": {
      const word = wordAtCaret(doc, head);
      return word ? { tr: null, searchWord: { word, dir: intent.dir } } : { tr: null };
    }

    default:
      return null;
  }
}
