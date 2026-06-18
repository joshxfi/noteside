// Searchable command palette (VS Code style) — the non-vim hub. Opened with
// Mod-Shift-P (or :commands). Fuzzy-filters the command table by title/group,
// shows each command's chord, and runs the selected one. Destructive commands
// ask for confirmation. Reuses the finder (fnd-*) markup. Esc closes.
import { useEffect, useMemo, useRef, useState } from "react";
import { chordLabel, type Command } from "../editor/commands";

function subseq(q: string, text: string): boolean {
  if (!q) return true;
  const t = text.toLowerCase();
  let i = 0;
  for (let j = 0; j < t.length && i < q.length; j++) if (t[j] === q[i]) i++;
  return i === q.length;
}

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

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const q = query.trim().toLowerCase();
  const items = useMemo(
    () => commands.filter((c) => subseq(q, c.title) || subseq(q, c.group)),
    [commands, q],
  );
  useEffect(() => setSel(0), [q]);

  // keep the selection in view
  useEffect(() => {
    const c = listRef.current;
    if (!c) return;
    const el = c.children[sel] as HTMLElement | undefined;
    if (!el) return;
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    if (top < c.scrollTop) c.scrollTop = top;
    else if (bottom > c.scrollTop + c.clientHeight) c.scrollTop = bottom - c.clientHeight;
  }, [sel, items]);

  const choose = (cmd: Command | undefined) => {
    if (!cmd) return;
    if (cmd.danger) setConfirm(cmd);
    else {
      onRun(cmd);
      onClose();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
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
        </div>

        <div className="fnd-body">
          <div className="fnd-list" ref={listRef}>
            {confirm ? (
              <div className="fnd-empty">
                {confirm.title}? &nbsp;<b>↵</b> yes · <b>n</b> no · <b>Esc</b> cancel
              </div>
            ) : items.length === 0 ? (
              <div className="fnd-empty">no commands</div>
            ) : (
              items.map((c, i) => (
                <div
                  key={c.id}
                  className={"fnd-row" + (i === sel ? " is-sel" : "") + (c.danger ? " danger" : "")}
                  onMouseMove={() => i !== sel && setSel(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(c);
                  }}
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
