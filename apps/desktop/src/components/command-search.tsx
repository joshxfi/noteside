// Searchable command palette (VS Code style) — the non-vim hub. Opened with
// Mod-Shift-P (or :commands). Fuzzy-filters the command table by title/group,
// shows each command's chord, and runs the selected one. Destructive commands
// ask for confirmation. Reuses the finder (fnd-*) markup. Esc closes.
import { useEffect, useMemo, useRef, useState } from "react";
import { chordLabel, type Command } from "../editor/commands";
import { scrollRowIntoView, subseq } from "./list-nav";

export function CommandSearch({
  commands,
  onRun,
  onClose,
}: {
  commands: Command[];
  onRun: (cmd: Command) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const [confirm, setConfirm] = useState<Command | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Pointer-driven selection must not auto-scroll (see finder.tsx: the scroll
  // would move a new row under the stationary cursor and re-fire the hover).
  const selByPointer = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const q = query.trim().toLowerCase();
  const items = useMemo(
    () => commands.filter((c) => subseq(q, c.title) || subseq(q, c.group)),
    [commands, q],
  );
  useEffect(() => {
    selByPointer.current = false;
    setSel(0);
  }, [q]);

  // keep the selection in view (keyboard moves only)
  useEffect(() => {
    if (!selByPointer.current) scrollRowIntoView(listRef.current, sel);
  }, [sel, items]);

  const hoverSel = (i: number) => {
    selByPointer.current = true;
    setSel(i);
  };

  const choose = (cmd: Command | undefined) => {
    if (!cmd) return;
    if (cmd.danger) setConfirm(cmd);
    else {
      onRun(cmd);
      onClose();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    selByPointer.current = false;
    if (e.key === "Escape") {
      e.preventDefault();
      if (confirm) setConfirm(null);
      else onClose();
    } else if (confirm) {
      e.preventDefault();
      if (e.key === "Enter" || e.key === "y") {
        onRun(confirm);
        onClose();
      } else if (e.key === "n") {
        setConfirm(null);
      }
    } else if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
      e.preventDefault();
      setSel((s) => Math.min(items.length - 1, s + 1));
    } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(items[sel]);
    }
  };

  return (
    <div className="fnd-scrim" onMouseDown={onClose}>
      <div className="fnd-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="fnd-head">
          <span className="fnd-promptchar">{confirm ? "confirm" : "cmd"} ›</span>
          <input
            ref={inputRef}
            className="fnd-input"
            value={query}
            spellCheck={false}
            placeholder="run a command…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button
            type="button"
            className="fnd-x"
            tabIndex={-1}
            aria-label="close"
            title="close (Esc)"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="fnd-body">
          <div className="fnd-list" ref={listRef}>
            {confirm ? (
              <div className="fnd-empty">
                {confirm.title}?
                {/* mousedown-preventDefault keeps the input focused so ↵/n/Esc keep working */}
                <span className="cfm-actions">
                  <button
                    type="button"
                    className="cfm-btn danger"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onRun(confirm);
                      onClose();
                    }}
                  >
                    Yes <b>↵</b>
                  </button>
                  <button
                    type="button"
                    className="cfm-btn"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setConfirm(null)}
                  >
                    No <b>n</b>
                  </button>
                </span>
              </div>
            ) : items.length === 0 ? (
              <div className="fnd-empty">no commands</div>
            ) : (
              items.map((c, i) => (
                <div
                  key={c.id}
                  className={"fnd-row" + (i === sel ? " is-sel" : "") + (c.danger ? " danger" : "")}
                  onMouseEnter={() => i !== sel && hoverSel(i)}
                  onMouseMove={() => i !== sel && hoverSel(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(c)}
                >
                  <span className="fnd-name">{c.title}</span>
                  {c.chord && <span className="fnd-frec">{chordLabel(c.chord)}</span>}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="fnd-foot">
          <span className="fnd-hint">
            <b>↑↓</b> move · <b>↵</b> run · <b>Esc</b> close
          </span>
          <span className="fnd-count">
            {items.length} {items.length === 1 ? "command" : "commands"}
          </span>
        </div>
      </div>
    </div>
  );
}
