// find-bar.tsx — the docked in-note find UI over find.ts. Top-docked like the
// old CM search panel; Enter/Shift-Enter (or the ‹ › buttons) cycle, Esc
// closes the BAR but leaves the query and its highlights lit (hlsearch
// parity — F3 keeps working; clearing is the ✕ button or an empty query).
import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { clearFind, currentFindQuery, findCounts, findNext, findPrev, setFindQuery } from "./find";

export function FindBar(props: { editor: Editor; onClose: () => void }) {
  const { editor } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(() => currentFindQuery(editor));
  const [counts, setCounts] = useState<[number, number]>(() => findCounts(editor));

  const refresh = () => setCounts(findCounts(editor));

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    // count updates ride the editor's own transactions (matches move on edits)
    const onTr = () => refresh();
    editor.on("transaction", onTr);
    return () => {
      editor.off("transaction", onTr);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = (q: string) => {
    setQuery(q);
    setFindQuery(editor, q);
    refresh();
  };

  return (
    <div className="av-find">
      <input
        ref={inputRef}
        className="av-find-input"
        type="text"
        placeholder="find in note"
        value={query}
        onChange={(e) => apply(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) findPrev(editor);
            else findNext(editor);
            refresh();
          } else if (e.key === "Escape") {
            e.preventDefault();
            props.onClose();
            editor.view.focus();
          } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
            // Mod-f toggles: pressing it with the bar's input focused closes it
            e.preventDefault();
            props.onClose();
            editor.view.focus();
          }
        }}
      />
      <span className="av-find-count">
        {counts[1] === 0 ? (query ? "0" : "") : `${counts[0] || "–"}/${counts[1]}`}
      </span>
      <button
        type="button"
        className="av-find-btn"
        title="previous match (Shift-Enter)"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          findPrev(editor);
          refresh();
        }}
      >
        ‹
      </button>
      <button
        type="button"
        className="av-find-btn"
        title="next match (Enter)"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          findNext(editor);
          refresh();
        }}
      >
        ›
      </button>
      <button
        type="button"
        className="av-find-btn av-find-close"
        title="clear highlights and close"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          clearFind(editor);
          props.onClose();
          editor.view.focus();
        }}
      >
        ✕
      </button>
    </div>
  );
}
