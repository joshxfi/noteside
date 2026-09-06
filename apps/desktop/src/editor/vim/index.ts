// vim/index.ts — the vim layer as a Tiptap extension. Priority 1500: the app
// chord layer (2000) outranks it, Tiptap's content keymaps and input rules sit
// below. Normal/visual mode swallow every bare printable (nothing may type);
// insert mode watches ONLY Esc (Ctrl-[) and the escMap sequence, so typing,
// the slash menu, and input rules behave exactly as they do for non-vim users.
//
// The pure machine (machine.ts) decides WHAT a key means; exec.ts turns
// document intents into transactions over the current state; this file owns
// the glue: mode state, the vim-side visual selection, the block-caret
// decoration, vertical j/k (view coords), the normal-mode cursor clamp, undo
// grouping, `.` recording, scrolling, o/O, and the app hooks.
import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Plugin, PluginKey, Selection, TextSelection, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { FIND_META, findNext, findPrev, setFindQuery } from "../find";
import { IS_MAC } from "../platform";
import { adoptSelection, execIntent, visualSelection, type VisualSel } from "./exec";
import {
  feedKey,
  initialVimState,
  isChangeIntent,
  pendingLabel,
  withCount,
  type Intent,
  type VimMode,
  type VimState,
  type VisualKind,
} from "./machine";
import { clampNormalPos, lineUnitAt, textblockPosNear } from "./motions";

export interface VimOptions {
  /** Insert-escape sequence (e.g. "jk"); read live per keypress. */
  getEscMap: () => string;
  /** Code-block indent width for >> / <<; read live. */
  getTabWidth: () => number;
  onModeChange: (mode: VimMode) => void;
  /** showcmd — the pending count/operator/prefix ("2d", "ci"), "" when idle. */
  onPending?: (label: string) => void;
  hooks: {
    palette: () => void;
    exBar: () => void;
    follow: () => void;
    findBar: () => void;
    notify: (msg: string) => void;
  };
}

const ESC_WINDOW_MS = 350;
const key = new PluginKey("nsVim");
const caretKey = new PluginKey("nsVimCaret");

/** Visual-vertical j/k with a sticky goal column, via view coordinates. The
 *  probe steps outward past the inter-line leading (line-height gaps would
 *  otherwise bounce posAtCoords back onto the same line). Returns the new
 *  head, or null when nothing moved. */
function verticalProbe(
  editor: Editor,
  from: number,
  dir: 1 | -1,
  count: number,
  goal: { x: number | null },
): number | null {
  const view = editor.view;
  let head = from;
  for (let i = 0; i < count; i++) {
    const coords = view.coordsAtPos(head);
    if (goal.x === null) goal.x = coords.left;
    const h = Math.max(8, coords.bottom - coords.top);
    let moved: number | null = null;
    for (const dy of [h * 0.75, h * 1.5, h * 2.5, h * 4, h * 8]) {
      const y = dir === 1 ? coords.bottom + dy : coords.top - dy;
      const next = view.posAtCoords({ left: goal.x, top: y });
      if (!next) continue;
      // A probe can land on a STRUCTURE position instead of a caret one: the
      // leading between blocks (doc-level boundary), a node's own position
      // (WebKit's elementFromPoint below a table's last row returns the TABLE
      // — snapping that forward sent j back to row 1, an infinite cycle), or
      // a list's item seam. Normalize with the motion's bias, then accept
      // only if it actually ADVANCES in the motion's direction. In-textblock
      // probes pass through near() unchanged, keeping the goal column exact.
      const norm = TextSelection.near(view.state.doc.resolve(next.pos), dir).head;
      if (dir === 1 ? norm > head : norm < head) {
        moved = norm;
        break;
      }
    }
    if (moved === null) break;
    head = moved;
  }
  return head === from ? null : head;
}

function scroller(editor: Editor): HTMLElement | null {
  return editor.view.dom.closest(".av-editor-scroll");
}

/** Ctrl-d/u/f/b: scroll, and carry the caret along when it left the view. */
function scrollPage(editor: Editor, dir: 1 | -1, page: "half" | "full"): void {
  const el = scroller(editor);
  if (!el) return;
  el.scrollBy({ top: dir * el.clientHeight * (page === "half" ? 0.5 : 1), behavior: "auto" });
  const view = editor.view;
  const r = el.getBoundingClientRect();
  const c = view.coordsAtPos(view.state.selection.head);
  if (c.top >= r.top && c.bottom <= r.bottom) return;
  const y = Math.min(Math.max(c.top, r.top + 8), r.bottom - 8);
  const p = view.posAtCoords({ left: c.left, top: y });
  if (!p) return;
  const pos = clampNormalPos(view.state.doc, textblockPosNear(view.state.doc, p.pos));
  view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(pos))));
}

/** zz / zt / zb. */
function scrollCaret(editor: Editor, where: "center" | "top" | "bottom"): void {
  const el = scroller(editor);
  if (!el) return;
  const view = editor.view;
  const c = view.coordsAtPos(view.state.selection.head);
  const r = el.getBoundingClientRect();
  const target =
    where === "center" ? r.top + r.height / 2 : where === "top" ? r.top + 24 : r.bottom - 24;
  el.scrollBy({ top: c.top - target, behavior: "auto" });
}

/** Force the DOM selection to match state. A selectionchange task queued
 *  BEFORE our dispatch (a click, a stale native caret) otherwise fires after
 *  the keydown handler, and ProseMirror's observer "repairs" the state
 *  selection back to wherever the DOM still pointed — teleporting the caret
 *  out from under a motion. Handlers read the LIVE DOM, so making it match
 *  state now defuses every queued stale event. */
function syncDomSelection(editor: Editor): void {
  const view = editor.view;
  if (!view.hasFocus()) return;
  try {
    const { anchor, head } = view.state.selection;
    const sel = window.getSelection();
    if (!sel) return;
    const $head = view.domAtPos(head);
    if (anchor === head) {
      sel.collapse($head.node, $head.offset);
    } else {
      const $anchor = view.domAtPos(anchor);
      sel.setBaseAndExtent($anchor.node, $anchor.offset, $head.node, $head.offset);
    }
  } catch {
    /* atom boundaries etc. — PM's own sync already handled those */
  }
}

/** WebKit fires a stale selectionchange after a keydown that inserted a node
 *  and selected into it, bouncing the caret back — reassert on the next task
 *  and collapse the DOM selection by hand (selectionToDOM into a node
 *  inserted during a keydown silently fails there). */
function reassertCaret(editor: Editor): void {
  const intended = editor.state.selection.head;
  setTimeout(() => {
    if (editor.isDestroyed) return;
    const v = editor.view;
    if (intended > v.state.doc.content.size) return;
    if (v.state.selection.head !== intended) {
      v.dispatch(v.state.tr.setSelection(Selection.near(v.state.doc.resolve(intended), 1)));
    }
    try {
      const at = v.domAtPos(intended);
      window.getSelection()?.collapse(at.node, at.offset);
    } catch {
      /* position vanished (undo/reload) — nothing to fix */
    }
  }, 0);
}

/** o / O — open a line below/above the current unit. Routes through the SAME
 *  split commands a real Enter uses (inserting a node and moving the
 *  selection into it inside one keydown makes WebKit's DOM observer bounce
 *  the caret back). In a table the line is a ROW; in a code block a source
 *  line. Called with the mode already switched to insert, so the normal-mode
 *  clamp never fights the intermediate selection placements. */
function openLine(editor: Editor, above: boolean): void {
  const { state, view } = editor;
  const doc = state.doc;
  const head = Math.min(state.selection.head, doc.content.size);
  const $head = doc.resolve(head);
  const unit = lineUnitAt(doc, head);

  if ($head.parent.isTextblock && $head.parent.type.spec.code) {
    const at = above ? unit.from : unit.to;
    const tr = state.tr.insertText("\n", at);
    tr.setSelection(TextSelection.create(tr.doc, above ? at : at + 1));
    view.dispatch(tr.scrollIntoView());
    return;
  }

  const unitNode = doc.nodeAt(unit.from);
  if (unitNode?.type.name === "tableRow") {
    const ok = above ? editor.commands.addRowBefore() : editor.commands.addRowAfter();
    if (!ok) return;
    const s = editor.state;
    const at = Math.min((above ? unit.from : unit.to) + 1, s.doc.content.size);
    view.dispatch(s.tr.setSelection(Selection.near(s.doc.resolve(at), 1)).scrollIntoView());
    reassertCaret(editor);
    return;
  }

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
    view.dispatch(
      s.tr.setSelection(
        Selection.near(s.doc.resolve(Math.min(unit.from + 1, s.doc.content.size)), 1),
      ),
    );
  }
  view.dispatch(editor.state.tr.scrollIntoView());
  reassertCaret(editor);
}

interface ChangeRecord {
  intents: Intent[];
  /** The text typed in the insert session that followed (null = none). */
  text: string | null;
  /** false when the insert session couldn't be captured (multi-line). */
  ok: boolean;
}

export const Vim = Extension.create<VimOptions>({
  name: "nsVim",
  priority: 1500,

  addOptions() {
    return {
      getEscMap: () => "",
      getTabWidth: () => 2,
      onModeChange: () => {},
      onPending: () => {},
      hooks: {
        palette: () => {},
        exBar: () => {},
        follow: () => {},
        findBar: () => {},
        notify: () => {},
      },
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    const editor = this.editor;

    let vim: VimState = initialVimState;
    /** The vim-side visual selection while mode === "visual". */
    let vsel: VisualSel | null = null;
    let escPending: { pos: number; at: number } | null = null;
    const goal = { x: null as number | null };
    let lastChange: ChangeRecord | null = null;
    let recording: { intents: Intent[]; from: number } | null = null;
    let shownPending = "";

    const clearPending = (s: VimState): VimState => ({
      ...s,
      count: 0,
      op: null,
      prefix: null,
      awaitSeek: null,
      awaitReplace: false,
      awaitObject: null,
    });

    /** Every vim-originated transaction is marked so appendTransaction can
     *  tell ours from the mouse's. */
    const mark = (tr: Transaction): Transaction => tr.setMeta(key, true);

    /** Dispatch a vim edit as its own undo group: closeHistory on the change
     *  starts a fresh group, and a sealing no-op afterwards keeps later
     *  (non-vim) edits from merging into it. `keepOpen` skips the seal so an
     *  insert session that follows (cw, s, C) undoes together with its cut. */
    const dispatchVim = (tr: Transaction, keepOpen = false): void => {
      const changed = tr.docChanged;
      if (changed) closeHistory(tr);
      editor.view.dispatch(mark(tr));
      if (changed && !keepOpen) editor.view.dispatch(mark(closeHistory(editor.state.tr)));
    };

    const setMode = (mode: VimMode, tr?: Transaction): void => {
      const changed = vim.mode !== mode;
      if (!changed && !tr) return;
      if (changed) {
        vim = { ...clearPending(vim), mode };
        options.onModeChange(mode);
      }
      // a view update so the caret decoration re-renders for the mode
      const t = (tr ?? editor.state.tr).setMeta(caretKey, mode);
      if (mode === "normal") closeHistory(t); // seal the insert session / visual op
      editor.view.dispatch(mark(t));
    };

    const publishPending = (): void => {
      const label = pendingLabel(vim);
      if (label === shownPending) return;
      shownPending = label;
      options.onPending?.(label);
    };

    const vertical = (from: number, dir: 1 | -1, count: number): number | null =>
      verticalProbe(editor, from, dir, count, goal);

    const env = () => ({ vsel, tabWidth: options.getTabWidth(), vertical });

    const caretTr = (pos: number): Transaction => {
      const { state } = editor;
      const p = clampNormalPos(state.doc, textblockPosNear(state.doc, pos));
      return state.tr.setSelection(Selection.near(state.doc.resolve(p)));
    };

    const applyModeIntent = (intent: { to: VimMode; visual?: VisualKind }): void => {
      const { state } = editor;
      if (intent.to === "visual") {
        const kind = intent.visual ?? "char";
        if (vim.mode === "visual" && vsel) {
          // v ⇄ V: same selection, other flavor
          vsel = { ...vsel, kind };
          vim = { ...vim, visual: kind };
          dispatchVim(state.tr.setSelection(visualSelection(state.doc, vsel)));
          return;
        }
        const head = clampNormalPos(state.doc, textblockPosNear(state.doc, state.selection.head));
        vsel = { anchor: head, head, kind };
        vim = { ...vim, visual: kind };
        setMode("visual", state.tr.setSelection(visualSelection(state.doc, vsel)));
        return;
      }
      if (intent.to === "normal") {
        if (vim.mode === "visual") {
          const head = vsel ? vsel.head : state.selection.head;
          vsel = null;
          setMode("normal", caretTr(head));
        } else {
          setMode("normal");
        }
        return;
      }
      vsel = null;
      setMode("insert");
    };

    /** Remember a change for `.` — immediately, or once its insert session
     *  ends (then with the typed text). */
    const record = (intents: Intent[], entersInsert: boolean): void => {
      if (!intents.some(isChangeIntent)) return;
      const replay = intents.filter((i) => i.kind !== "mode");
      if (entersInsert) recording = { intents: replay, from: editor.state.selection.head };
      else lastChange = { intents: replay, text: null, ok: true };
    };

    const finishRecording = (): void => {
      if (!recording) return;
      const { doc, selection } = editor.state;
      const from = Math.min(recording.from, doc.content.size);
      const $from = doc.resolve(from);
      const $head = selection.$head;
      const ok =
        selection.empty && $head.pos >= from && $head.parent.isTextblock && $head.sameParent($from);
      lastChange = {
        intents: recording.intents,
        text: ok ? doc.textBetween(from, $head.pos, "\n") : null,
        ok,
      };
      recording = null;
    };

    const doRepeat = (count: number): void => {
      if (!lastChange) return;
      if (!lastChange.ok) {
        options.hooks.notify("can't repeat a multi-line insert");
        return;
      }
      const intents =
        count > 0 ? lastChange.intents.map((i) => withCount(i, count)) : lastChange.intents;
      // the whole replay is ONE undo group: seal before, let the steps merge, seal after
      editor.view.dispatch(mark(closeHistory(editor.state.tr)));
      for (const intent of intents) {
        const r = execIntent(editor.state, intent, { ...env(), vsel: null });
        if (!r) continue;
        if (r.tr) editor.view.dispatch(mark(r.tr));
        if (r.openLine) openLine(editor, r.openLine === "above");
        if (r.notify) options.hooks.notify(r.notify);
      }
      if (lastChange.text !== null) {
        if (lastChange.text) {
          editor.view.dispatch(mark(editor.state.tr.insertText(lastChange.text)));
        }
        // Esc semantics: the caret steps back onto the last typed character
        const s = editor.state;
        const $h = s.selection.$head;
        if (s.selection.empty && $h.parent.isTextblock && $h.parentOffset > 0) {
          editor.view.dispatch(mark(s.tr.setSelection(TextSelection.create(s.doc, $h.pos - 1))));
        }
      }
      editor.view.dispatch(mark(closeHistory(editor.state.tr)));
      goal.x = null;
    };

    const runIntents = (intents: Intent[]): void => {
      const entersInsert = intents.some((i) => i.kind === "mode" && i.to === "insert");
      // Switch to insert FIRST: the normal-mode clamp (appendTransaction)
      // must not pull the caret off a line end that c$ / A / o just chose.
      if (entersInsert && vim.mode !== "insert") applyModeIntent({ to: "insert" });
      for (const intent of intents) {
        switch (intent.kind) {
          case "mode":
            applyModeIntent(intent);
            break;
          case "app":
            options.hooks[intent.hook]();
            break;
          case "findNext":
            findNext(editor, true); // the cursor sits ON the last match — search past it
            break;
          case "findPrev":
            findPrev(editor);
            break;
          case "scroll":
            scrollPage(editor, intent.dir, intent.page);
            break;
          case "scrollCaret":
            scrollCaret(editor, intent.where);
            break;
          case "undo":
            editor.commands.undo();
            break;
          case "redo":
            editor.commands.redo();
            break;
          case "repeat":
            doRepeat(intent.count);
            break;
          default: {
            const r = execIntent(editor.state, intent, env());
            if (!r) break;
            if (r.vsel !== undefined) vsel = r.vsel;
            if (r.tr) dispatchVim(r.tr, entersInsert);
            if (r.openLine) {
              // seal, so the split + typing form their own undo group
              editor.view.dispatch(mark(closeHistory(editor.state.tr)));
              openLine(editor, r.openLine === "above");
            }
            if (r.searchWord) {
              setFindQuery(editor, r.searchWord.word);
              if (r.searchWord.dir === 1) findNext(editor, true);
              else findPrev(editor);
            }
            if (r.notify) options.hooks.notify(r.notify);
          }
        }
        // anything but a vertical move resets the j/k goal column
        if (!(intent.kind === "move" && intent.motion.t === "line")) goal.x = null;
      }
      record(intents, entersInsert);
    };

    /** Esc from insert: vim leaves the caret one position LEFT (on the last
     *  typed character), seals the undo group, and finalizes `.` recording. */
    const leaveInsert = (): void => {
      finishRecording();
      escPending = null;
      const { state } = editor;
      const $head = state.selection.$head;
      const tr = state.tr;
      if (state.selection.empty && $head.parent.isTextblock && $head.parentOffset > 0) {
        tr.setSelection(TextSelection.create(state.doc, $head.pos - 1));
      }
      setMode("normal", tr);
    };

    const vimPlugin = new Plugin({
      key,
      props: {
        handleKeyDown(view, e) {
          if (e.isComposing || e.metaKey) return false;

          // ── insert mode: Esc (Ctrl-[) + the escMap sequence only ──
          if (vim.mode === "insert") {
            if (e.key === "Escape" || (e.ctrlKey && e.key === "[")) {
              leaveInsert();
              return true;
            }
            const seq = options.getEscMap();
            if (seq.length === 2 && !e.ctrlKey && !e.altKey && e.key.length === 1) {
              const now = Date.now();
              if (
                escPending &&
                e.key === seq[1] &&
                now - escPending.at < ESC_WINDOW_MS &&
                view.state.selection.head === escPending.pos + 1
              ) {
                const from = escPending.pos;
                escPending = null;
                const tr = view.state.tr.delete(from, from + 1);
                tr.setSelection(TextSelection.create(tr.doc, from));
                view.dispatch(mark(tr));
                leaveInsert();
                return true;
              }
              escPending = e.key === seq[0] ? { pos: view.state.selection.head, at: now } : null;
            } else if (e.key.length === 1) {
              escPending = null;
            }
            return false;
          }

          // ── normal / visual ──────────────────────────────────────
          // An Alt-composed character (macOS Option-a → "å"; Windows AltGr,
          // which Chromium reports as Ctrl+Alt) is a bare printable to vim:
          // nothing may type in normal mode. An unbound Ctrl+Alt+key reaching
          // this layer (the chord layer above already claimed bound ones)
          // would otherwise pass through and insert.
          const composedChar = e.altKey && e.key.length === 1;
          const result = feedKey(vim, {
            key: e.key,
            ctrl: e.ctrlKey && !composedChar,
            shift: e.shiftKey,
            allowCtrlScroll: IS_MAC, // elsewhere Ctrl IS the chord modifier
          });
          vim = result.state;
          runIntents(result.intents);
          if (result.intents.length > 0 && vim.mode !== "insert") syncDomSelection(editor);
          publishPending();
          return result.handled;
        },
      },
      appendTransaction(trs, _old, newState) {
        if (vim.mode === "insert") return null;
        const ours = trs.some((tr) => tr.getMeta(key));
        const sel = newState.selection;
        // A find (the bar's Enter, n/N, */#) selects the whole match. That is
        // NOT a mouse drag: in normal mode the cursor parks on the match start
        // and the mode stays normal (otherwise `n x` deleted the whole word);
        // in visual mode the head extends to it, as vim's `n` does.
        if (!sel.empty && trs.some((tr) => tr.getMeta(FIND_META))) {
          const at = clampNormalPos(newState.doc, sel.from);
          if (vim.mode === "visual" && vsel) {
            vsel = { ...vsel, head: at };
            return newState.tr
              .setSelection(visualSelection(newState.doc, vsel))
              .scrollIntoView()
              .setMeta(key, true);
          }
          return newState.tr
            .setSelection(TextSelection.create(newState.doc, at))
            .scrollIntoView()
            .setMeta(key, true);
        }
        if (vim.mode === "visual") {
          if (!ours && trs.some((tr) => tr.selectionSet)) {
            // the mouse (or a command) moved the selection under visual mode
            if (!sel.empty) {
              vsel = adoptSelection(sel);
              return null;
            }
            vsel = null;
            vim = { ...clearPending(vim), mode: "normal" };
            options.onModeChange("normal");
            // fall through to the normal-mode clamp
          } else {
            if (vsel) {
              for (const tr of trs) {
                if (!tr.docChanged) continue;
                vsel = {
                  ...vsel,
                  anchor: tr.mapping.map(vsel.anchor),
                  head: tr.mapping.map(vsel.head),
                };
              }
            }
            return null;
          }
        } else if (
          !ours &&
          !sel.empty &&
          sel instanceof TextSelection &&
          trs.some((tr) => tr.selectionSet)
        ) {
          // a mouse drag (or select-all) in normal mode IS visual mode — vim's mouse=a
          vsel = adoptSelection(sel);
          vim = { ...clearPending(vim), mode: "visual", visual: "char" };
          options.onModeChange("visual");
          return null;
        }
        // the normal-mode rule: the cursor sits ON a character, never past the last
        if (!(sel instanceof TextSelection) || !sel.empty) return null;
        const clamped = clampNormalPos(newState.doc, sel.head);
        if (clamped === sel.head) return null;
        return newState.tr
          .setSelection(TextSelection.create(newState.doc, clamped))
          .setMeta(key, true);
      },
    });

    // The block caret for normal/visual: one decoration at the vim cursor.
    // Insert mode uses the native caret (caret-color from CSS).
    const caretPlugin = new Plugin({
      key: caretKey,
      props: {
        decorations(state) {
          if (vim.mode === "insert") return DecorationSet.empty;
          const sel = state.selection;
          if (vim.mode !== "visual" && !sel.empty) return DecorationSet.empty;
          const head = Math.min(
            vim.mode === "visual" && vsel ? vsel.head : sel.head,
            state.doc.content.size,
          );
          const $head = state.doc.resolve(head);
          if ($head.parent.isTextblock && $head.parentOffset < $head.parent.content.size) {
            return DecorationSet.create(state.doc, [
              Decoration.inline(head, head + 1, { class: "av-vim-caret" }),
            ]);
          }
          const widget = document.createElement("span");
          widget.className = "av-vim-caret-blank";
          return DecorationSet.create(state.doc, [Decoration.widget(head, widget, { side: 1 })]);
        },
      },
    });

    return [vimPlugin, caretPlugin];
  },
});
