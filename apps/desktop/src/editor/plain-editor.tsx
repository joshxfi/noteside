// plain-editor.tsx — the plain-text buffer for ~/.notesiderc. The block editor
// is the wrong tool for a dotfile (markdown parsing would mangle it), so the
// config buffer gets a bare textarea in the same .av-editor shell: native undo,
// selection, and IME for free; chords matched through the same command table.
// Dirtiness is a plain string compare — the config file is tens of lines.
import { useEffect, useRef, useState } from "react";
import type { AppCommand, ChordOverrides, Command } from "./commands";
import { editorChordMap, eventChord } from "./commands";
import { countWordsIn } from "./word-count";
import { type EditorStat, StatusBar } from "./status-bar";

export interface PlainEditorProps {
  fileLabel: string;
  initialText: string;
  savedText: string;
  chordOverrides?: ChordOverrides;
  refocusToken: number;
  onChange: (text: string | (() => string), dirty: boolean) => void;
  onSave: (text: string) => void;
  onQuit: () => void;
  onCommand: (c: AppCommand) => void;
}

function textStat(value: string, selStart: number, dirty: boolean): EditorStat {
  const before = value.slice(0, selStart);
  const line = before.split("\n").length;
  const col = selStart - before.lastIndexOf("\n");
  const lines = value.split("\n").length;
  const pct = lines <= 1 ? "All" : Math.round(((line - 1) / (lines - 1)) * 100) + "%";
  return { words: countWordsIn(value), line, col, pct, dirty };
}

export function PlainEditor(props: PlainEditorProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const [stat, setStat] = useState<EditorStat>(() => textStat(props.initialText, 0, false));

  const refreshStat = (dirty?: boolean) => {
    const ta = taRef.current;
    if (!ta) return;
    const next = textStat(
      ta.value,
      ta.selectionStart,
      dirty ?? ta.value !== propsRef.current.savedText,
    );
    setStat((s) =>
      s.words === next.words &&
      s.line === next.line &&
      s.col === next.col &&
      s.pct === next.pct &&
      s.dirty === next.dirty
        ? s
        : next,
    );
  };

  const save = () => {
    const ta = taRef.current;
    if (ta) propsRef.current.onSave(ta.value);
  };

  const dispatch = (cmd: Command) => {
    const p = propsRef.current;
    if (cmd.command) p.onCommand(cmd.command);
    else if (cmd.editor === "save") save();
    else if (cmd.editor === "quit") p.onQuit();
    else if (cmd.editor === "saveQuit") {
      save();
      p.onQuit();
    }
    // follow/search actions need the block editor; inert in the config buffer.
  };

  useEffect(() => {
    taRef.current?.focus();
  }, [props.refocusToken]);

  // A save landing (savedText catches up) retracts the [+] marker.
  useEffect(() => {
    refreshStat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.savedText]);

  return (
    <div className="av-editor" data-cursor="bar">
      <div className="av-cm">
        <textarea
          ref={taRef}
          className="av-plain"
          defaultValue={props.initialText}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onInput={() => {
            const ta = taRef.current;
            if (!ta) return;
            const value = ta.value;
            const dirty = value !== propsRef.current.savedText;
            propsRef.current.onChange(() => value, dirty);
            refreshStat(dirty);
          }}
          onKeyDown={(e) => {
            if (!e.metaKey && !e.ctrlKey && !e.altKey && !/^F\d{1,2}$/.test(e.key)) return;
            const cmd = editorChordMap(propsRef.current.chordOverrides).get(eventChord(e));
            if (!cmd) return;
            e.preventDefault();
            dispatch(cmd);
          }}
          onSelect={() => refreshStat()}
        />
      </div>
      <StatusBar
        modeClass="mode-text"
        modeLabel="TEXT"
        fileLabel={props.fileLabel}
        stat={stat}
        onSave={save}
      />
    </div>
  );
}
