// vim/exec.ts — turns machine intents into ProseMirror transactions. All
// position math comes from motions.ts (pure); the ONE injected behavior is
// vertical j/k motion, which needs the view's coordinate system (aux.vertical).
// App-level intents (mode changes, palette/ex/find hooks, scrolling) are the
// extension's business — this module only ever touches the document.
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Selection, TextSelection } from "@tiptap/pm/state";
import type { Intent, Motion } from "./machine";
import {
  blockStart,
  firstNonBlank,
  lineTextRange,
  lineUnitAt,
  lineUnitSpan,
  type LineUnit,
  paraTarget,
  seekTarget,
  wordTarget,
} from "./motions";
import { getRegister, setRegister } from "./registers";

export interface ExecAux {
  /** j/k — visual-vertical with goal column; needs view coords. */
  vertical: (dir: 1 | -1, count: number, extend: boolean) => void;
  /** star/hash — feed the shared find state with the word under the caret. */
  searchWord: (word: string, dir: 1 | -1) => void;
  notify?: (msg: string) => void;
}

const clampPos = (doc: PMNode, pos: number): number => Math.max(0, Math.min(pos, doc.content.size));

/** Target position for every motion except j/k (vertical is injected). */
export function motionTarget(
  doc: PMNode,
  pos: number,
  motion: Motion,
  count: number,
): number | null {
  switch (motion.t) {
    case "char": {
      let p = pos;
      for (let i = 0; i < count; i++) p += motion.dir;
      return clampPos(doc, p);
    }
    case "word": {
      let p = pos;
      for (let i = 0; i < count; i++) p = wordTarget(doc, p, motion.which);
      return p;
    }
    case "lineStart":
      return lineTextRange(doc, pos).from;
    case "lineFirstNonBlank":
      return firstNonBlank(doc, pos);
    case "lineEnd":
      return lineTextRange(doc, pos).to;
    case "docStart":
      return 0;
    case "docEnd":
      return doc.content.size;
    case "blockJump":
      return blockStart(doc, motion.n);
    case "para":
      return paraTarget(doc, pos, motion.dir, count);
    case "seek":
      return seekTarget(doc, pos, motion.cmd, motion.ch, count);
    case "line":
      return null; // handled by aux.vertical
  }
}

/** Visual-line selection spanning the anchor's and head's line-units. */
function visualLineSelection(doc: PMNode, anchor: number, head: number): Selection {
  const aUnit = lineUnitAt(doc, anchor);
  const hUnit = lineUnitAt(doc, head);
  const forward = hUnit.from >= aUnit.from;
  const a = forward ? aUnit.from : aUnit.to;
  const h = forward ? hUnit.to : hUnit.from;
  return TextSelection.between(doc.resolve(a), doc.resolve(h));
}

/** Expand the current caret onto its line-unit (entering visual mode). */
export function enterVisual(editor: Editor): void {
  const { state, view } = editor;
  const unit = lineUnitAt(state.doc, state.selection.head);
  view.dispatch(
    state.tr
      .setSelection(TextSelection.between(state.doc.resolve(unit.from), state.doc.resolve(unit.to)))
      .scrollIntoView(),
  );
}

/** The visual selection normalized to whole line-units. */
function selectionUnits(doc: PMNode, from: number, to: number): LineUnit {
  const a = lineUnitAt(doc, from);
  const b = lineUnitAt(doc, Math.max(from, to - 1));
  return { from: Math.min(a.from, b.from), to: Math.max(a.to, b.to), kind: a.kind };
}

function yankRange(doc: PMNode, unit: LineUnit): void {
  if (unit.kind === "codeline") {
    setRegister({ type: "lines", text: doc.textBetween(unit.from, unit.to, "\n") });
  } else {
    setRegister({ type: "nodes", fragment: doc.slice(unit.from, unit.to).content });
  }
}

function deleteRange(editor: Editor, unit: LineUnit): void {
  const { state, view } = editor;
  const doc = state.doc;
  let { from, to } = unit;
  if (unit.kind === "codeline") {
    // take one boundary newline with the line, vim-style
    const $from = doc.resolve(from);
    const blockEnd = $from.end();
    if (to < blockEnd) to += 1;
    else if (from > $from.start()) from -= 1;
    view.dispatch(state.tr.delete(from, to).scrollIntoView());
    return;
  }
  if (from === 0 && to === doc.content.size) {
    // deleting every block: leave one empty paragraph (block+ schema)
    const para = state.schema.nodes.paragraph.createAndFill();
    if (para) view.dispatch(state.tr.replaceWith(0, doc.content.size, para).scrollIntoView());
    return;
  }
  const tr = state.tr.delete(from, to);
  tr.setSelection(Selection.near(tr.doc.resolve(clampPos(tr.doc, from)), 1));
  view.dispatch(tr.scrollIntoView());
}

function pasteRegister(editor: Editor, before: boolean, count: number, aux: ExecAux): void {
  const reg = getRegister();
  if (!reg) return;
  const { state, view } = editor;
  const doc = state.doc;
  const head = state.selection.head;

  if (reg.type === "text") {
    editor.commands.insertContent(reg.text.repeat(count));
    return;
  }

  const unit = lineUnitAt(doc, head);
  if (reg.type === "lines") {
    const $head = doc.resolve(clampPos(doc, head));
    if ($head.parent.isTextblock && $head.parent.type.spec.code) {
      const insertAt = before ? unit.from : unit.to;
      const text = Array.from({ length: count }, () => reg.text).join("\n");
      const tr = before
        ? state.tr.insertText(text + "\n", insertAt)
        : state.tr.insertText("\n" + text, insertAt);
      view.dispatch(tr.scrollIntoView());
      return;
    }
    // pasting code lines outside a code block: they become paragraphs
    const paras = reg.text
      .split("\n")
      .map((l) => state.schema.nodes.paragraph.create(null, l ? [state.schema.text(l)] : []));
    const at = before ? unit.from : unit.to;
    const tr = state.tr.insert(at, paras);
    tr.setSelection(Selection.near(tr.doc.resolve(at + 1), 1));
    view.dispatch(tr.scrollIntoView());
    return;
  }

  // node fragment — insert as sibling line-units
  const at = before ? unit.from : unit.to;
  try {
    let tr = state.tr;
    for (let i = 0; i < count; i++) tr = tr.insert(at, reg.fragment);
    tr.setSelection(Selection.near(tr.doc.resolve(at + 1), 1));
    view.dispatch(tr.scrollIntoView());
  } catch {
    // schema rejected it (e.g. a table row outside a table) — honest no-op
    aux.notify?.("can't paste that here");
  }
}

function openLine(editor: Editor, above: boolean): void {
  const { state, view } = editor;
  const doc = state.doc;
  const head = state.selection.head;
  const $head = doc.resolve(clampPos(doc, head));

  if ($head.parent.isTextblock && $head.parent.type.spec.code) {
    const range = lineUnitAt(doc, head);
    const at = above ? range.from : range.to;
    const tr = state.tr.insertText("\n", at);
    tr.setSelection(TextSelection.create(tr.doc, above ? at : at + 1));
    view.dispatch(tr.scrollIntoView());
    return;
  }

  // Route through the SAME split commands a real Enter uses — inserting a node
  // and moving the selection into it inside one keydown makes WebKit's DOM
  // observer bounce the caret back to where it was.
  const unit = lineUnitAt(doc, head);
  const unitNode = doc.nodeAt(unit.from);
  const isItem =
    unitNode && (unitNode.type.name === "listItem" || unitNode.type.name === "taskItem");
  const edge = above
    ? Selection.near(doc.resolve(Math.min(unit.from + 1, doc.content.size)), 1)
    : Selection.near(doc.resolve(Math.max(unit.to - 1, 0)), -1);
  view.dispatch(state.tr.setSelection(edge));
  const split = isItem
    ? editor.commands.splitListItem(unitNode.type.name)
    : editor.commands.splitBlock();
  if (!split) return;
  if (above) {
    // the split left an empty unit ABOVE with the caret still on the original —
    // move up onto the new empty line
    const s = editor.state;
    editor.view.dispatch(
      s.tr.setSelection(
        Selection.near(s.doc.resolve(Math.min(unit.from + 1, s.doc.content.size)), 1),
      ),
    );
  }
  editor.view.dispatch(editor.state.tr.scrollIntoView());
  // WebKit fires a stale selectionchange after this keydown handler, bouncing
  // the caret back to the pre-split position — reassert on the next task.
  const intended = editor.state.selection.head;
  setTimeout(() => {
    if (editor.isDestroyed) return;
    const v = editor.view;
    if (intended > v.state.doc.content.size) return;
    if (v.state.selection.head !== intended) {
      v.dispatch(v.state.tr.setSelection(Selection.near(v.state.doc.resolve(intended), 1)));
    }
    // WebKit: selectionToDOM into a node inserted during a keydown silently
    // fails, and typed text then follows the stale DOM caret — collapse the
    // DOM selection there by hand; ProseMirror reads it back on the next sync.
    try {
      const at = v.domAtPos(intended);
      window.getSelection()?.collapse(at.node, at.offset);
    } catch {
      /* position vanished (undo/reload) — nothing to fix */
    }
  }, 0);
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

/** Apply one DOCUMENT intent. Returns false for intents exec doesn't own
 *  (mode/app/scroll/find — the extension handles those). */
export function execIntent(editor: Editor, intent: Intent, aux: ExecAux): boolean {
  const { state, view } = editor;
  const doc = state.doc;
  const head = state.selection.head;

  switch (intent.kind) {
    case "move": {
      if (intent.motion.t === "line") {
        aux.vertical(intent.motion.dir, intent.count, intent.extend);
        return true;
      }
      const target = motionTarget(doc, head, intent.motion, intent.count);
      if (target === null) return true; // e.g. a failed seek — vim no-ops
      const tr = state.tr.setSelection(
        intent.extend
          ? visualLineSelection(doc, state.selection.anchor, target)
          : Selection.near(doc.resolve(clampPos(doc, target)), target >= head ? 1 : -1),
      );
      view.dispatch(tr.scrollIntoView());
      return true;
    }
    case "deleteLines": {
      const span = lineUnitSpan(doc, head, intent.count);
      yankRange(doc, span);
      deleteRange(editor, span);
      return true;
    }
    case "yankLines": {
      yankRange(doc, lineUnitSpan(doc, head, intent.count));
      return true;
    }
    case "deleteMotion": {
      const target = motionTarget(doc, head, intent.motion, 1);
      if (target === null) return true;
      const inclusive = intent.motion.t === "word" && intent.motion.which === "e";
      const from = Math.min(head, target);
      const to = Math.max(head, target) + (inclusive ? 1 : 0);
      if (from === to) return true;
      setRegister({ type: "text", text: doc.textBetween(from, to, "\n", " ") });
      view.dispatch(state.tr.delete(from, clampPos(doc, to)).scrollIntoView());
      return true;
    }
    case "deleteChar": {
      const range = lineTextRange(doc, head);
      const to = Math.min(head + intent.count, range.to);
      if (to <= head) return true;
      setRegister({ type: "text", text: doc.textBetween(head, to, "\n", " ") });
      view.dispatch(state.tr.delete(head, to).scrollIntoView());
      return true;
    }
    case "deleteSelection":
    case "yankSelection": {
      const { from, to } = state.selection;
      const span = selectionUnits(doc, from, to);
      yankRange(doc, span);
      if (intent.kind === "deleteSelection") deleteRange(editor, span);
      return true;
    }
    case "pasteSelection": {
      const { from, to } = state.selection;
      const span = selectionUnits(doc, from, to);
      deleteRange(editor, span);
      pasteRegister(editor, true, 1, aux);
      return true;
    }
    case "paste":
      pasteRegister(editor, intent.before, intent.count, aux);
      return true;
    case "insert": {
      if (intent.where === "below" || intent.where === "above") {
        openLine(editor, intent.where === "above");
        return true;
      }
      let target = head;
      if (intent.where === "after") target = Math.min(head + 1, lineTextRange(doc, head).to);
      else if (intent.where === "lineStart") target = firstNonBlank(doc, head);
      else if (intent.where === "lineEnd") target = lineTextRange(doc, head).to;
      if (target !== head) {
        view.dispatch(
          state.tr
            .setSelection(Selection.near(doc.resolve(clampPos(doc, target))))
            .scrollIntoView(),
        );
      }
      return true;
    }
    case "undo":
      editor.commands.undo();
      return true;
    case "redo":
      editor.commands.redo();
      return true;
    case "searchWord": {
      const word = wordAtCaret(doc, head);
      if (word) aux.searchWord(word, intent.dir);
      return true;
    }
    default:
      return false;
  }
}
