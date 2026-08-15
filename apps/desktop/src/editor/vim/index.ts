// vim/index.ts — the vim layer as a Tiptap extension. Priority 1500: the app
// chord layer (2000) outranks it, Tiptap's content keymaps and input rules sit
// below. Normal/visual mode swallow every bare printable (nothing may type);
// insert mode watches ONLY Esc and the escMap sequence, so typing, the slash
// menu, and input rules behave exactly as they do for non-vim users.
//
// The pure machine (machine.ts) decides WHAT a key means; exec.ts applies
// document intents; this file owns the glue: mode state, the decoration caret,
// vertical j/k (view coords), scrolling, and the app hooks.
import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { findNext, findPrev, setFindQuery } from "../find";
import { IS_MAC } from "../platform";
import { enterVisual, execIntent } from "./exec";
import { feedKey, initialVimState, type VimMode, type VimState } from "./machine";
import { lineUnitAt } from "./motions";

export interface VimOptions {
  /** Insert-escape sequence (e.g. "jk"); read live per keypress. */
  getEscMap: () => string;
  onModeChange: (mode: VimMode) => void;
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
 *  otherwise bounce posAtCoords back onto the same line). */
function vertical(
  editor: Editor,
  dir: 1 | -1,
  count: number,
  extend: boolean,
  goal: { x: number | null },
): void {
  const view = editor.view;
  let head = view.state.selection.head;
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
  const state = view.state;
  if (extend) {
    const aUnit = lineUnitAt(state.doc, state.selection.anchor);
    const hUnit = lineUnitAt(state.doc, head);
    const forward = hUnit.from >= aUnit.from;
    view.dispatch(
      state.tr
        .setSelection(
          TextSelection.between(
            state.doc.resolve(forward ? aUnit.from : aUnit.to),
            state.doc.resolve(forward ? hUnit.to : hUnit.from),
          ),
        )
        .scrollIntoView(),
    );
    return;
  }
  view.dispatch(
    state.tr.setSelection(TextSelection.near(state.doc.resolve(head), dir)).scrollIntoView(),
  );
}

function scrollHalfPage(editor: Editor, dir: 1 | -1): void {
  const scroller = editor.view.dom.closest(".av-editor-scroll");
  if (!scroller) return;
  scroller.scrollBy({ top: (dir * scroller.clientHeight) / 2, behavior: "auto" });
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

export const Vim = Extension.create<VimOptions>({
  name: "nsVim",
  priority: 1500,

  addOptions() {
    return {
      getEscMap: () => "",
      onModeChange: () => {},
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
    let escPending: { pos: number; at: number } | null = null;
    const goal = { x: null as number | null };

    const setMode = (mode: VimMode) => {
      if (vim.mode === mode) return;
      vim = { ...vim, mode, count: 0, pending: null, awaitSeek: null };
      options.onModeChange(mode);
      // nudge a view update so the caret decoration re-renders for the mode
      editor.view.dispatch(editor.state.tr.setMeta(caretKey, mode));
    };

    const aux = {
      vertical: (dir: 1 | -1, count: number, extend: boolean) =>
        vertical(editor, dir, count, extend, goal),
      searchWord: (word: string, dir: 1 | -1) => {
        setFindQuery(editor, word);
        if (dir === 1) findNext(editor);
        else findPrev(editor);
      },
      notify: options.hooks.notify,
    };

    const vimPlugin = new Plugin({
      key,
      props: {
        handleKeyDown(view, e) {
          if (e.isComposing || e.metaKey) return false;

          // ── insert mode: Esc + the escMap sequence only ──────────
          if (vim.mode === "insert") {
            if (e.key === "Escape") {
              escPending = null;
              // vim leaves insert one position LEFT of the caret
              const { state } = view;
              const $head = state.selection.$head;
              if ($head.parentOffset > 0) {
                view.dispatch(
                  state.tr.setSelection(TextSelection.create(state.doc, $head.pos - 1)),
                );
              }
              setMode("normal");
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
                const $at = tr.doc.resolve(from);
                tr.setSelection(
                  TextSelection.create(tr.doc, $at.parentOffset > 0 ? from - 1 : from),
                );
                view.dispatch(tr);
                setMode("normal");
                return true;
              }
              escPending = e.key === seq[0] ? { pos: view.state.selection.head, at: now } : null;
            } else if (e.key.length === 1) {
              escPending = null;
            }
            return false;
          }

          // ── normal / visual ──────────────────────────────────────
          const result = feedKey(vim, {
            key: e.key,
            ctrl: e.ctrlKey,
            shift: e.shiftKey,
            allowCtrlScroll: IS_MAC, // elsewhere Ctrl IS the chord modifier
          });
          vim = result.state;

          for (const intent of result.intents) {
            if (intent.kind === "mode") {
              if (intent.to === "visual") enterVisual(editor);
              if (intent.to === "normal" && vim.mode === "visual") {
                const { state } = view;
                view.dispatch(
                  state.tr.setSelection(
                    TextSelection.near(state.doc.resolve(state.selection.head)),
                  ),
                );
              }
              setMode(intent.to);
            } else if (intent.kind === "app") {
              if (intent.hook === "palette") options.hooks.palette();
              else if (intent.hook === "exBar") options.hooks.exBar();
              else if (intent.hook === "follow") options.hooks.follow();
              else if (intent.hook === "findBar") options.hooks.findBar();
            } else if (intent.kind === "findNext") {
              findNext(editor);
            } else if (intent.kind === "findPrev") {
              findPrev(editor);
            } else if (intent.kind === "scroll") {
              scrollHalfPage(editor, intent.dir);
            } else {
              execIntent(editor, intent, aux);
            }
            // horizontal moves reset the j/k goal column
            if (intent.kind === "move" && intent.motion.t !== "line") goal.x = null;
            if (intent.kind !== "move") goal.x = null;
          }
          if (result.intents.length > 0 && vim.mode !== "insert") syncDomSelection(editor);
          return result.handled;
        },
      },
    });

    // The block caret for normal/visual: one decoration at the selection head.
    // Insert mode uses the native caret (caret-color from CSS).
    const caretPlugin = new Plugin({
      key: caretKey,
      props: {
        decorations(state) {
          if (vim.mode === "insert") return DecorationSet.empty;
          const sel = state.selection;
          if (!sel.empty && vim.mode !== "visual") return DecorationSet.empty;
          const head = sel.head;
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
