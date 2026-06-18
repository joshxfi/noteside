import { useEffect, useRef, useState } from "react";
import { EditorState, type Extension, Prec } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { closeSearchPanel, openSearchPanel, search, searchPanelOpen } from "@codemirror/search";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxHighlighting } from "@codemirror/language";
import { getCM, vim } from "@replit/codemirror-vim";
import { type AppCommand, defineExCommands, setActiveHandlers } from "./exCommands";
import { type ChordOverrides, type Command, commandChordKeymap } from "./commands";
import { activeLineHighlight } from "./activeLine";
import { livePreview } from "./livePreview";
import { wikilinkComplete, wikilinks } from "./wikilinks";
import { noteHighlight, nsTheme } from "./theme";

const MODE_LABEL: Record<string, string> = {
  normal: "NORMAL",
  insert: "INSERT",
  visual: "VISUAL",
  replace: "REPLACE",
};

const WORD_COUNT_DELAY_MS = 180;
const DIRTY_CHECK_DELAY_MS = 220;

defineExCommands();

export interface EditorProps {
  /** Changing this remounts the editor (fresh CM state) — parent keys on it. */
  notePath: string;
  fileLabel: string;
  initialText: string;
  savedText: string;
  vimMode: boolean;
  cursorBlink: boolean;
  relativeNumbers: boolean;
  /** Non-vim chord overrides (`bind` lines), applied to the chord keymap at mount. */
  chordOverrides?: ChordOverrides;
  /** Render markdown inline (hide markup off the cursor line), Obsidian-style. */
  preview: boolean;
  /** Note titles offered as `[[ ]]` autocompletion targets. */
  linkTargets: string[];
  /** 1-based line to place the cursor on at mount (e.g. opening a grep hit). */
  gotoLine?: number;
  refocusToken: number;
  onChange: (text: string | (() => string), dirty: boolean) => void;
  onSave: (text: string) => void;
  onQuit: () => void;
  onCommand: (c: AppCommand) => void;
  /** Follow the wikilink target under the cursor (`gf` / `:follow`). */
  onFollowLink: (target: string) => void;
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
      setStat((s) => ({ ...s, ...next, ...(dirty === undefined ? {} : { dirty }) }));
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
      }
    };

    const extensions: Extension[] = [];
    // No persistent status bar: the mode + counts live in our own status bar
    // below. The `:` / `/` command line still appears as a transient panel.
    if (vimMode) extensions.push(vim());
    extensions.push(
      lineNumbers(relativeNumbers ? { formatNumber: relFmt } : undefined),
      activeLineHighlight,
      highlightActiveLineGutter(),
      drawSelection(cursorBlink === false ? { cursorBlinkRate: 0 } : {}),
      history(),
      // in-note find (Mod-f via the command table); matches reuse the .cm-searchMatch
      // theme styling. The default panel handles type / Enter (next) / Esc (close).
      search({ top: true }),
      // The editor-scope chord above only fires when the content is focused; this makes
      // Mod-f also CLOSE the panel while the find field itself is focused, so it toggles.
      keymap.of([
        {
          key: "Mod-f",
          scope: "search-panel",
          preventDefault: true,
          run: (view) => {
            closeSearchPanel(view);
            return true;
          },
        },
      ]),
      markdown({ addKeymap: false }),
      syntaxHighlighting(noteHighlight),
      ...(preview ? [livePreview] : []),
      wikilinks(preview),
      wikilinkComplete(() => propsRef.current.linkTargets),
      // high precedence so the completion popup wins Enter/Tab/Esc over vim
      Prec.high(keymap.of(completionKeymap)),
      EditorView.lineWrapping,
      nsTheme,
      // Always-on app chords (both vim and non-vim) — Mod- combos can't collide
      // with vim's bare-key normal mode. Derived from the command table.
      keymap.of([
        ...commandChordKeymap(dispatchCommand, propsRef.current.chordOverrides),
        ...historyKeymap,
      ]),
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
    if (!vimMode) extensions.push(keymap.of(defaultKeymap));

    const view = new EditorView({
      state: EditorState.create({ doc: initialText, extensions }),
      parent: host,
    });
    viewRef.current = view;
    setFullStat(view.state, view.state.doc.toString() !== savedRef.current);

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
      followLink: (t) => propsRef.current.onFollowLink(t),
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

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const dirty =
      view.state.doc.length !== props.savedText.length ||
      view.state.doc.toString() !== props.savedText;
    setStat((s) => (s.dirty === dirty ? s : { ...s, dirty }));
  }, [props.savedText]);

  return (
    <div className="av-editor">
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
