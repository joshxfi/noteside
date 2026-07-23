import { useEffect, useRef, useState } from "react";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentMore,
} from "@codemirror/commands";
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  openSearchPanel,
  search,
  searchPanelOpen,
} from "@codemirror/search";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { syntaxHighlighting } from "@codemirror/language";
import { getCM, vim } from "@replit/codemirror-vim";
import type { AppCommand } from "./commands";
import { defineExCommands, setActiveHandlers } from "./ex-commands";
import { type ChordOverrides, type Command, commandChordKeymap } from "./commands";
import { activeLineHighlight } from "./active-line";
import { livePreview } from "./live-preview";
import { blockPreview, linkHandlers } from "./block-preview";
import { urlAt } from "../links";
import { noteHighlight, nsTheme } from "./theme";
import { isModKey, modActive } from "./platform";

const MODE_LABEL: Record<string, string> = {
  normal: "NORMAL",
  insert: "INSERT",
  visual: "VISUAL",
  replace: "REPLACE",
};

const WORD_COUNT_DELAY_MS = 180;
const DIRTY_CHECK_DELAY_MS = 220;

// The always-on chord keymap lives in a Compartment so a rebind (cfg.chords)
// can be re-applied to the LIVE editor without a remount (CM wires keymaps at
// mount; a remount would also steal focus from the open shortcut editor).
const chordKeymap = new Compartment();
// drawSelection lives in its own Compartment too, so toggling cursor-blink
// reconfigures the live editor (same no-remount reason). Both CM's bar caret and
// vim's block cursor read this drawSelection config for their blink rate.
const selectionComp = new Compartment();
// The preview-dependent decorations and the lineNumbers config get Compartments
// as well, so toggling preview / relativeNumbers reconfigures the live editor —
// a remount would tear down 10-100ms of view AND reseed the doc from the
// open-time initialText, visibly reverting a mid-edit buffer.
const previewComp = new Compartment();
const lineNumbersComp = new Compartment();

// livePreview/blockPreview are singletons the compartment just adds or removes
// when preview toggles.
const previewExts = (preview: boolean): Extension => (preview ? [livePreview, blockPreview] : []);
const lineNumbersExt = (relative: boolean): Extension =>
  lineNumbers(relative ? { formatNumber: relFmt } : undefined);

// Static extension values, hoisted so a remount doesn't rebuild them — CM
// extensions are immutable configs; per-editor state lives in the EditorState.
const gutterHighlight = highlightActiveLineGutter();
const historyExt = history();
// in-note find (Mod-f via the command table); matches reuse the .cm-searchMatch
// theme styling. The default panel handles type / Enter (next) / Esc (close).
const searchExt = search({ top: true });
// The editor-scope chord only fires when the content is focused; this makes
// Mod-f also CLOSE the panel while the find field itself is focused, so it toggles.
const searchPanelToggle = keymap.of([
  {
    key: "Mod-f",
    scope: "search-panel",
    preventDefault: true,
    run: (view) => {
      closeSearchPanel(view);
      return true;
    },
  },
]);
// GFM base (the default is plain commonmark — without it tables, task lists,
// strikethrough and autolinks never parse); codeLanguages lazy-loads syntax
// highlighting for fenced blocks per language (separate chunks, offline-safe).
const markdownExt = markdown({
  addKeymap: false,
  base: markdownLanguage,
  codeLanguages: languages,
});
const noteSyntax = syntaxHighlighting(noteHighlight);
// Vim handles normal/visual-mode keys first, then delegates insert-mode editing
// to the regular CM keymap.
const defaultKeys = keymap.of(defaultKeymap);
// CodeMirror deliberately excludes Tab from defaultKeymap. Indent in plain text
// mode and Vim insert mode, but consume it without editing in Vim normal/visual
// mode so focus stays in the keyboard-first editor.
const indentationKeys = keymap.of([
  {
    key: "Tab",
    run: (view) => {
      const vimState = getCM(view)?.state.vim;
      return vimState && !vimState.insertMode ? true : indentMore(view);
    },
    shift: (view) => {
      const vimState = getCM(view)?.state.vim;
      return vimState && !vimState.insertMode ? true : indentLess(view);
    },
  },
]);

defineExCommands();

export interface EditorProps {
  /** Changing this remounts the editor (fresh CM state) — parent keys on it. */
  notePath: string;
  fileLabel: string;
  initialText: string;
  savedText: string;
  /** Session-tracked dirty state (note buffers). When provided, the status bar
   *  trusts it verbatim on savedText/dirty changes — no O(doc) stringify per
   *  autosave. Leave undefined for buffers whose dirtiness is Editor-local
   *  (the config buffer), which keep the internal doc-vs-savedText compare. */
  dirty?: boolean;
  vimMode: boolean;
  cursorBlink: boolean;
  /** Caret shape for insert / non-vim mode (vim normal mode is always a block). */
  cursor: "block" | "bar" | "underline";
  relativeNumbers: boolean;
  /** Non-vim chord overrides (`bind` lines), applied to the chord keymap at mount. */
  chordOverrides?: ChordOverrides;
  /** Render markdown inline (hide markup off the cursor line), Obsidian-style. */
  preview: boolean;
  /** 1-based line to place the cursor on at mount (e.g. opening a grep hit). */
  gotoLine?: number;
  refocusToken: number;
  onChange: (text: string | (() => string), dirty: boolean) => void;
  onSave: (text: string) => void;
  onQuit: () => void;
  onCommand: (c: AppCommand) => void;
  /** Open an external URL under the cursor in the system browser. */
  onOpenUrl: (url: string) => void;
}

// Open the external URL at a document offset in the browser (`gx` / `:follow` /
// Mod-click). Reads raw line text, so live-preview is moot.
function openLinkAt(view: EditorView, pos: number, p: EditorProps): boolean {
  const ln = view.state.doc.lineAt(pos);
  const url = urlAt(ln.text, pos - ln.from);
  if (url) {
    p.onOpenUrl(url);
    return true;
  }
  return false;
}

function relFmt(n: number, state: EditorState): string {
  const cur = state.doc.lineAt(state.selection.main.head).number;
  return n === cur ? String(n) : String(Math.abs(n - cur));
}

export function Editor(props: EditorProps) {
  const { initialText, vimMode, cursorBlink, relativeNumbers, preview, refocusToken } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const savedRef = useRef(props.savedText);
  savedRef.current = props.savedText;
  const wordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // dispatchCommand lives inside the mount effect; expose it so the live chord
  // reconfigure effect below can rebuild the keymap with fresh overrides.
  const dispatchRef = useRef<(cmd: Command) => void>(() => {});
  // False during the first effect pass (flipped by the last effect below), so
  // the reconfigure effects skip the mount run — their compartments were just
  // initialized with the same config; a reconfigure would be redundant work.
  const didMountRef = useRef(false);

  const [mode, setMode] = useState(vimMode ? "normal" : "insert");
  const [stat, setStat] = useState({ words: 0, line: 1, col: 1, pct: "All", dirty: false });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const clearWordTimer = () => {
      if (wordTimerRef.current !== null) {
        clearTimeout(wordTimerRef.current);
        wordTimerRef.current = null;
      }
    };
    const clearDirtyTimer = () => {
      if (dirtyTimerRef.current !== null) {
        clearTimeout(dirtyTimerRef.current);
        dirtyTimerRef.current = null;
      }
    };
    const cursorStat = (state: EditorState) => {
      const head = state.selection.main.head;
      const lineObj = state.doc.lineAt(head);
      const total = state.doc.lines;
      const pct = total <= 1 ? "All" : Math.round(((lineObj.number - 1) / (total - 1)) * 100) + "%";
      return {
        line: lineObj.number,
        col: head - lineObj.from + 1,
        pct,
      };
    };
    const countWords = (state: EditorState) => {
      let words = 0;
      const iter = state.doc.iter();
      while (!iter.done) {
        const matches = iter.value.match(/\S+/g);
        if (matches) words += matches.length;
        iter.next();
      }
      return words;
    };
    const setCursorStat = (state: EditorState, dirty?: boolean) => {
      const next = cursorStat(state);
      setStat((s) => {
        const d = dirty === undefined ? s.dirty : dirty;
        if (s.line === next.line && s.col === next.col && s.pct === next.pct && s.dirty === d) {
          return s; // unchanged — skip the re-render
        }
        return { ...s, ...next, dirty: d };
      });
    };
    const setFullStat = (state: EditorState, dirty: boolean) => {
      setStat({ words: countWords(state), ...cursorStat(state), dirty });
    };
    const scheduleWordCount = (state: EditorState) => {
      clearWordTimer();
      wordTimerRef.current = setTimeout(() => {
        wordTimerRef.current = null;
        setStat((s) => ({ ...s, words: countWords(state) }));
      }, WORD_COUNT_DELAY_MS);
    };
    const scheduleExactCleanCheck = (state: EditorState) => {
      clearDirtyTimer();
      if (state.doc.length !== savedRef.current.length) return;
      dirtyTimerRef.current = setTimeout(() => {
        dirtyTimerRef.current = null;
        const view = viewRef.current;
        if (!view || view.state.doc.length !== savedRef.current.length) return;
        const dirty = view.state.doc.toString() !== savedRef.current;
        if (!dirty) {
          propsRef.current.onChange(() => view.state.doc.toString(), false);
          setStat((s) => (s.dirty ? { ...s, dirty: false } : s));
        }
      }, DIRTY_CHECK_DELAY_MS);
    };
    const onVimMode = (e: { mode?: string }) => {
      if (e?.mode) setMode(e.mode);
    };

    // Run a table command in the editor's context: AppCommands go to onCommand,
    // editor actions act on the live view. Powers the always-on Mod- chords.
    const dispatchCommand = (cmd: Command) => {
      const v = viewRef.current;
      const p = propsRef.current;
      if (cmd.command) p.onCommand(cmd.command);
      else if (cmd.editor === "save") {
        if (v) p.onSave(v.state.doc.toString());
      } else if (cmd.editor === "quit") p.onQuit();
      else if (cmd.editor === "saveQuit" && v) {
        p.onSave(v.state.doc.toString());
        p.onQuit();
      } else if (cmd.editor === "search" && v) {
        // Mod-f toggles the find panel: close it if it's open, otherwise open it.
        if (searchPanelOpen(v.state)) closeSearchPanel(v);
        else openSearchPanel(v);
      } else if (cmd.editor === "follow" && v) {
        // Non-vim equivalent of `gx` / `:follow`: open the URL under the cursor.
        openLinkAt(v, v.state.selection.main.head, p);
      } else if (cmd.editor === "searchNext" && v) {
        findNext(v);
      } else if (cmd.editor === "searchPrev" && v) {
        findPrevious(v);
      }
    };
    dispatchRef.current = dispatchCommand;

    const extensions: Extension[] = [];
    // No persistent status bar: the mode + counts live in our own status bar
    // below. The `:` / `/` command line still appears as a transient panel.
    if (vimMode) extensions.push(vim());
    extensions.push(
      lineNumbersComp.of(lineNumbersExt(relativeNumbers)),
      activeLineHighlight,
      gutterHighlight,
      selectionComp.of(drawSelection(cursorBlink === false ? { cursorBlinkRate: 0 } : {})),
      historyExt,
      searchExt,
      searchPanelToggle,
      markdownExt,
      noteSyntax,
      previewComp.of(previewExts(preview)),
      // rendered-table cells route their Mod-clicked URLs through the same app
      // handler as gx / Mod-click on raw text
      linkHandlers.of({
        openUrl: (u) => propsRef.current.onOpenUrl(u),
      }),
      EditorView.lineWrapping,
      nsTheme,
      // Mod-click (Cmd/Ctrl) opens the external URL under the pointer, leaving
      // plain click for cursor placement. A `cm-mod-active` class (toggled while
      // Mod is held) reveals the link cursor only then, so the pointer affordance
      // is honest; blur clears any lingering state.
      EditorView.domEventHandlers({
        mousedown(e, view) {
          if (e.button !== 0 || !modActive(e)) return false;
          const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
          if (pos == null || !openLinkAt(view, pos, propsRef.current)) return false;
          e.preventDefault();
          return true;
        },
        keydown(e, view) {
          if (isModKey(e.key)) view.dom.classList.add("cm-mod-active");
          return false;
        },
        keyup(e, view) {
          if (isModKey(e.key)) view.dom.classList.remove("cm-mod-active");
          return false;
        },
        blur(_e, view) {
          view.dom.classList.remove("cm-mod-active");
          return false;
        },
      }),
      // Always-on app chords (both vim and non-vim) — Mod- combos can't collide
      // with vim's bare-key normal mode. Derived from the command table.
      chordKeymap.of(
        keymap.of([
          ...commandChordKeymap(dispatchCommand, propsRef.current.chordOverrides),
          ...historyKeymap,
        ]),
      ),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) {
          const state = u.state;
          propsRef.current.onChange(() => state.doc.toString(), true);
          setCursorStat(state, true);
          scheduleExactCleanCheck(state);
          scheduleWordCount(state);
        } else if (u.selectionSet) {
          setCursorStat(u.state);
        }
      }),
    );
    extensions.push(defaultKeys, indentationKeys);

    const view = new EditorView({
      state: EditorState.create({ doc: initialText, extensions }),
      parent: host,
    });
    viewRef.current = view;
    // The doc was just created from initialText, so compare the props directly
    // (a reference compare in the clean case) instead of stringifying the doc.
    setFullStat(view.state, initialText !== savedRef.current);

    const goto = propsRef.current.gotoLine ?? 0;
    if (goto > 0) {
      const ln = view.state.doc.line(Math.min(goto, view.state.doc.lines));
      view.dispatch({ selection: { anchor: ln.from }, scrollIntoView: true });
    }

    setActiveHandlers({
      view,
      save: () => propsRef.current.onSave(view.state.doc.toString()),
      quit: () => propsRef.current.onQuit(),
      saveQuit: () => {
        propsRef.current.onSave(view.state.doc.toString());
        propsRef.current.onQuit();
      },
      command: (c) => propsRef.current.onCommand(c),
      openUrl: (u) => propsRef.current.onOpenUrl(u),
    });

    const cm = getCM(view);
    cm?.on("vim-mode-change", onVimMode);
    view.focus();

    return () => {
      clearWordTimer();
      clearDirtyTimer();
      cm?.off("vim-mode-change", onVimMode);
      setActiveHandlers(null);
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // parent remounts (via key) on note or vim-mode change

  useEffect(() => {
    viewRef.current?.focus();
  }, [refocusToken]);

  // Re-apply the chord keymap when the user rebinds a shortcut, so the change
  // takes effect in the already-open editor (no remount, no focus theft).
  useEffect(() => {
    const view = viewRef.current;
    if (!didMountRef.current || !view) return;
    view.dispatch({
      effects: chordKeymap.reconfigure(
        keymap.of([
          ...commandChordKeymap(dispatchRef.current, props.chordOverrides),
          ...historyKeymap,
        ]),
      ),
    });
  }, [props.chordOverrides]);

  // Re-apply cursor-blink to the live editor (no remount → no focus theft).
  // Reconfiguring the facet makes both CM's cursorLayer and vim's block-cursor
  // plugin re-read the blink rate, so the change takes effect immediately.
  useEffect(() => {
    if (!didMountRef.current) return;
    viewRef.current?.dispatch({
      effects: selectionComp.reconfigure(
        drawSelection(props.cursorBlink === false ? { cursorBlinkRate: 0 } : {}),
      ),
    });
  }, [props.cursorBlink]);

  // Toggle live-preview on the LIVE view (no remount): doc, cursor, and undo
  // history survive. Fresh plugin instances — they close over the flag.
  useEffect(() => {
    if (!didMountRef.current) return;
    viewRef.current?.dispatch({
      effects: previewComp.reconfigure(previewExts(props.preview)),
    });
  }, [props.preview]);

  // Same for the gutter's relative/absolute numbering.
  useEffect(() => {
    if (!didMountRef.current) return;
    viewRef.current?.dispatch({
      effects: lineNumbersComp.reconfigure(lineNumbersExt(props.relativeNumbers)),
    });
  }, [props.relativeNumbers]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    // Note buffers pass session-tracked dirtiness; only the config buffer
    // (dirty === undefined) still derives it from the doc here.
    const dirty =
      props.dirty !== undefined
        ? props.dirty
        : view.state.doc.length !== props.savedText.length ||
          view.state.doc.toString() !== props.savedText;
    setStat((s) => (s.dirty === dirty ? s : { ...s, dirty }));
  }, [props.savedText, props.dirty]);

  // Declared last so it runs after the guarded effects above on first mount.
  useEffect(() => {
    didMountRef.current = true;
  }, []);

  return (
    <div className="av-editor" data-cursor={props.cursor}>
      <div className="av-cm" ref={hostRef} />
      <div className="av-status">
        <div className={"av-mode " + (vimMode ? "mode-" + mode : "mode-text")}>
          {vimMode ? (MODE_LABEL[mode] ?? mode.toUpperCase()) : "TEXT"}
        </div>
        <div className="av-file">
          {props.fileLabel}
          {stat.dirty && (
            <span className="av-dirty" title="unsaved">
              [+]
            </span>
          )}
        </div>
        <div className="av-spacer" />
        <div className="av-stat">{stat.words} words</div>
        <div className="av-stat">
          {stat.line}:{stat.col}
        </div>
        <div className="av-stat av-pct">{stat.pct}</div>
      </div>
    </div>
  );
}
