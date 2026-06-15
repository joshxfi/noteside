// Linked-references panel: the notes whose body contains a [[wikilink]] that
// resolves to the current note. Keyboard-first (↑/↓/Ctrl-j/k/Enter/Esc), click
// to open. Focus moves into the panel on open (scoped keys — never leaks into
// the editor underneath); App refocuses the editor on close via refocusToken.
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { Backlink } from "../links";

export interface BacklinksProps {
  title: string;
  refs: Backlink[];
  onOpen: (id: string, line: number) => void;
  onClose: () => void;
}

export function Backlinks({ title, refs, onOpen, onClose }: BacklinksProps) {
  const [sel, setSel] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    const el = listRef.current?.children[sel] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "j")) {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, refs.length - 1));
    } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "k")) {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter" && refs[sel]) {
      e.preventDefault();
      onOpen(refs[sel].id, refs[sel].lineNumber);
    }
  };

  return (
    <div className="bl-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="bl-panel"
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Linked references"
        onKeyDown={onKeyDown}
      >
        <div className="bl-head">
          <span className="bl-kicker">Linked references</span>
          <span className="bl-target">{title}</span>
          <span className="bl-count">{refs.length}</span>
        </div>
        {refs.length ? (
          <div className="bl-list" ref={listRef}>
            {refs.map((r, i) => (
              <button
                key={r.id}
                className={"bl-row" + (i === sel ? " is-active" : "")}
                onMouseMove={() => setSel(i)}
                onClick={() => onOpen(r.id, r.lineNumber)}
              >
                <span className="bl-title">{r.title}</span>
                <span className="bl-line">{r.line || "—"}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="bl-empty">No notes link here yet. Type [[ in a note to link one.</div>
        )}
      </div>
    </div>
  );
}
