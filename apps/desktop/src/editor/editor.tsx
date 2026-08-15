// editor.tsx — the note editor: a Notion-like WYSIWYG block editor over
// markdown (Tiptap v3 / ProseMirror). Markdown files stay the source of truth:
// the doc is parsed from disk text at mount (frontmatter split off verbatim by
// markdown-io.ts) and serialized back through @tiptap/markdown on save.
//
// The seams the app relies on (see AGENTS.md):
// - onChange passes a THUNK capturing the immutable PM doc — serialization runs
//   when the session actually writes (autosave debounce / explicit save), never
//   on the typing path.
// - Dirtiness is doc.eq against the saved-doc snapshot: exact, synchronous, and
//   it RETRACTS on undo-to-saved (the CM editor needed a debounced string
//   compare for this).
// - The parent remounts via `key` (session editorKey + vim suffix); everything
//   else (chords, tabWidth) reconfigures live through refs.
// - Typing must never re-render React beyond this component's own status bar:
//   shouldRerenderOnTransaction is false and all node views are plain DOM.
import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Selection } from "@tiptap/pm/state";
import { convertFileSrc } from "@tauri-apps/api/core";
import "katex/dist/katex.min.css";
import { isTauri } from "../use-window-controls";
import type { AppCommand, ChordOverrides, Command } from "./commands";
import { buildExtensions } from "./extensions";
import { FindBar } from "./find-bar";
import { findNext, findPrev } from "./find";
import { posForBodyLine } from "./goto";
import { joinNote, type NoteIO, splitNote } from "./markdown-io";
import { docWordCount, transactionWordDelta } from "./pm-doc";
import { PlainEditor } from "./plain-editor";
import { type EditorStat, StatusBar } from "./status-bar";
import { urlAt } from "../links";

export interface EditorProps {
  /** Changing this remounts the editor (fresh doc) — parent keys on it. */
  notePath: string;
  fileLabel: string;
  initialText: string;
  savedText: string;
  /** Session-tracked dirty state (note buffers). Undefined = derive locally
   *  (the config buffer). */
  dirty?: boolean;
  vimMode: boolean;
  cursorBlink: boolean;
  /** Caret shape for insert / non-vim mode (vim normal mode is always a block). */
  cursor: "block" | "bar" | "underline";
  /** Indent width in spaces — what Tab inserts (code blocks, loose text). */
  tabWidth: number;
  /** Non-vim chord overrides (`bind` lines), read live by the chord layer. */
  chordOverrides?: ChordOverrides;
  /** Vim insert-escape sequence (e.g. "jk"); consumed by the vim layer. */
  escMap: string;
  /** 1-based source line to open on (e.g. a grep hit). */
  gotoLine?: number;
  /** The open notebook's root path — relative image srcs resolve against it. */
  notebookRoot?: string;
  refocusToken: number;
  onChange: (text: string | (() => string), dirty: boolean) => void;
  onSave: (text: string) => void;
  onQuit: () => void;
  onCommand: (c: AppCommand) => void;
  /** Open an external URL under the caret in the system browser. */
  onOpenUrl: (url: string) => void;
}

const MODE_LABEL: Record<string, string> = {
  normal: "NORMAL",
  insert: "INSERT",
  visual: "VISUAL",
};

/** Serialize a captured (immutable) PM doc back to full disk text. */
function serializeDoc(editor: TiptapEditor, io: NoteIO, doc: PMNode): string {
  const manager = editor.storage.markdown.manager;
  return joinNote(io, manager.serialize(doc.toJSON()));
}

/** Resolve an image src for DISPLAY (attrs keep the written value verbatim):
 *  absolute URLs pass through; relative paths resolve against the notebook
 *  root via the Tauri asset protocol. In the web/demo build a relative src
 *  stays relative and simply shows its alt text. */
function resolveImageSrc(src: string, notebookRoot: string | undefined): string {
  if (/^(https?:|data:|asset:)/i.test(src)) return src;
  if (!isTauri() || !notebookRoot) return src;
  const rel = src.replace(/^\.\//, "");
  return convertFileSrc(`${notebookRoot.replace(/\/$/, "")}/${rel}`);
}

/** The URL under the caret: a link mark's href, else links.ts urlAt over the
 *  caret's textblock (bare URLs usually autolink, so this is the fallback). */
function urlAtCaret(editor: TiptapEditor): string | null {
  const $head = editor.state.selection.$head;
  const link = $head.marks().find((m) => m.type.name === "link");
  if (link?.attrs.href) return link.attrs.href as string;
  if (!$head.parent.isTextblock) return null;
  const text = $head.parent.textBetween(0, $head.parent.content.size, "\n", " ");
  return urlAt(text, $head.parentOffset);
}

export function Editor(props: EditorProps) {
  if (props.notePath === "config") {
    return (
      <PlainEditor
        fileLabel={props.fileLabel}
        initialText={props.initialText}
        savedText={props.savedText}
        chordOverrides={props.chordOverrides}
        refocusToken={props.refocusToken}
        onChange={props.onChange}
        onSave={props.onSave}
        onQuit={props.onQuit}
        onCommand={props.onCommand}
      />
    );
  }
  return <RichEditor {...props} />;
}

function RichEditor(props: EditorProps) {
  const propsRef = useRef(props);
  propsRef.current = props;
  const savedRef = useRef(props.savedText);
  savedRef.current = props.savedText;

  // Mount-stable: the session remounts this component (editorKey) per open.
  const [io] = useState<NoteIO>(() => splitNote(props.initialText));

  const editorRef = useRef<TiptapEditor | null>(null);
  // Running word total, seeded at mount and advanced by per-step deltas.
  const wordsRef = useRef(0);
  // The doc as of the last landed save — the dirtiness baseline.
  const savedDocRef = useRef<PMNode | null>(null);
  // What the last-run serialize thunk produced, so the savedText effect below
  // can recognize "our save landed" and advance the baseline to that doc.
  const lastSerializedRef = useRef<{ text: string; doc: PMNode } | null>(null);

  // Mode is owned by the vim layer once it mounts (P5); non-vim is fixed "text".
  const [mode] = useState(props.vimMode ? "insert" : "text");
  const [findOpen, setFindOpen] = useState(false);
  const [stat, setStat] = useState<EditorStat>({
    words: 0,
    line: 1,
    col: 1,
    pct: "All",
    dirty: false,
  });

  const setCursorStat = (editor: TiptapEditor, dirty?: boolean) => {
    const state = editor.state;
    const $head = state.selection.$head;
    const blockIdx = $head.index(0);
    const blocks = state.doc.childCount;
    const next = {
      line: blockIdx + 1,
      col: ($head.parent.isTextblock ? $head.parentOffset : 0) + 1,
      pct: blocks <= 1 ? "All" : Math.round((blockIdx / (blocks - 1)) * 100) + "%",
    };
    setStat((s) => {
      const d = dirty === undefined ? s.dirty : dirty;
      const w = wordsRef.current;
      if (
        s.line === next.line &&
        s.col === next.col &&
        s.pct === next.pct &&
        s.dirty === d &&
        s.words === w
      ) {
        return s; // unchanged — skip the re-render
      }
      return { ...s, ...next, words: w, dirty: d };
    });
  };

  const serializeNow = (editor: TiptapEditor): string => {
    const doc = editor.state.doc;
    const text = serializeDoc(editor, io, doc);
    lastSerializedRef.current = { text, doc };
    return text;
  };

  // Run a table command in the editor's context: AppCommands go to onCommand,
  // editor actions act on the live editor. Powers the always-on Mod- chords.
  const dispatchCommand = (cmd: Command) => {
    const editor = editorRef.current;
    const p = propsRef.current;
    if (cmd.command) {
      p.onCommand(cmd.command);
      return;
    }
    if (!editor) return;
    if (cmd.editor === "save") p.onSave(serializeNow(editor));
    else if (cmd.editor === "quit") p.onQuit();
    else if (cmd.editor === "saveQuit") {
      p.onSave(serializeNow(editor));
      p.onQuit();
    } else if (cmd.editor === "follow") {
      const url = urlAtCaret(editor);
      if (url) p.onOpenUrl(url);
    } else if (cmd.editor === "search") {
      setFindOpen((open) => !open);
    } else if (cmd.editor === "searchNext") {
      findNext(editor);
    } else if (cmd.editor === "searchPrev") {
      findPrev(editor);
    }
  };

  const editor = useEditor({
    extensions: buildExtensions({
      chords: {
        getOverrides: () => propsRef.current.chordOverrides,
        dispatch: dispatchCommand,
      },
      getTabWidth: () => propsRef.current.tabWidth,
      resolveImageSrc: (src) => resolveImageSrc(src, propsRef.current.notebookRoot),
      onOpenUrl: (url) => propsRef.current.onOpenUrl(url),
    }),
    content: io.body,
    contentType: "markdown",
    // Focus is dispatched from onCreate below, NOT via the autofocus option:
    // Tiptap runs autofocus in a create-time setTimeout that can race a rapid
    // destroy/recreate (note switch) into "Applying a mismatched transaction".
    autofocus: false,
    // Create the editor in an effect, not during render: render-phase creation
    // fires onCreate's setState before mount (React 19 warns) and a discarded
    // concurrent render's instance then crashes the NEXT mount with
    // "Applying a mismatched transaction".
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    onCreate({ editor: ed }) {
      editorRef.current = ed;
      const doc = ed.state.doc;
      wordsRef.current = docWordCount(doc);
      if (propsRef.current.initialText === savedRef.current) {
        savedDocRef.current = doc;
      } else {
        // Reopened dirty buffer: the baseline is the SAVED text's doc, parsed
        // once here so undo-to-saved can still retract dirtiness exactly.
        try {
          const savedIo = splitNote(savedRef.current);
          const manager = ed.storage.markdown.manager;
          savedDocRef.current = ed.schema.nodeFromJSON(manager.parse(savedIo.body));
        } catch {
          savedDocRef.current = null; // never clean until a save lands
        }
      }
      setStat({
        words: wordsRef.current,
        line: 1,
        col: 1,
        pct: "All",
        dirty: propsRef.current.initialText !== savedRef.current,
      });
      // Selection first, DOM focus second — never commands.focus() here: its
      // view.focus() runs MID-command, and WebKit fires selectionchange
      // synchronously, dispatching a repair transaction that stales the
      // command's own ("Applying a mismatched transaction").
      const goto = propsRef.current.gotoLine ?? 0;
      const bodyLine = goto - io.frontmatterLines;
      const gotoPos =
        goto > 0 && bodyLine >= 1 ? posForBodyLine(ed.state.doc, io.body, bodyLine) : null;
      const sel =
        gotoPos !== null
          ? Selection.near(ed.state.doc.resolve(gotoPos))
          : Selection.atStart(ed.state.doc);
      ed.view.dispatch(ed.state.tr.setSelection(sel).scrollIntoView());
      ed.view.focus();
      setCursorStat(ed);
    },
    onUpdate({ editor: ed, transaction }) {
      if (!transaction.docChanged) return;
      wordsRef.current += transactionWordDelta(transaction);
      const doc = ed.state.doc;
      const saved = savedDocRef.current;
      const dirty = !saved || saved.nodeSize !== doc.nodeSize || !doc.eq(saved);
      const manager = ed.storage.markdown.manager;
      lastSerializedRef.current = null;
      propsRef.current.onChange(() => {
        const text = joinNote(io, manager.serialize(doc.toJSON()));
        lastSerializedRef.current = { text, doc };
        return text;
      }, dirty);
      setCursorStat(ed, dirty);
    },
    onSelectionUpdate({ editor: ed }) {
      setCursorStat(ed);
    },
    onDestroy() {
      editorRef.current = null;
    },
  });
  editorRef.current = editor;

  useEffect(() => {
    // Plain DOM focus — the selection is wherever the user left it, and a
    // commands.focus() dispatch here has the same WebKit reentrancy trap as
    // the onCreate one above.
    editorRef.current?.view.focus();
  }, [props.refocusToken]);

  // A save landed (savedText caught up with what we serialized): advance the
  // dirtiness baseline to that doc. Note buffers also carry session-tracked
  // dirtiness for the status bar.
  useEffect(() => {
    const last = lastSerializedRef.current;
    if (last && props.savedText === last.text) savedDocRef.current = last.doc;
    if (props.dirty !== undefined) {
      setStat((s) => (s.dirty === props.dirty ? s : { ...s, dirty: props.dirty as boolean }));
    }
  }, [props.savedText, props.dirty]);

  return (
    <div className="av-editor" data-cursor={props.cursor}>
      <div className="av-cm">
        {findOpen && editor && <FindBar editor={editor} onClose={() => setFindOpen(false)} />}
        <EditorContent editor={editor} className="av-editor-scroll" />
      </div>
      <StatusBar
        modeClass={props.vimMode ? "mode-" + mode : "mode-text"}
        modeLabel={props.vimMode ? (MODE_LABEL[mode] ?? mode.toUpperCase()) : "TEXT"}
        fileLabel={props.fileLabel}
        stat={stat}
        onSave={() => {
          const ed = editorRef.current;
          if (ed) props.onSave(serializeNow(ed));
        }}
      />
    </div>
  );
}
