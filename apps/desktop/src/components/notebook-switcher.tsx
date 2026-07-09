// Notebook switcher overlay — pick a recently-opened notebook (folder) or open a
// new one. Opened from the titlebar folder button, Mod-o, or :notebook. Reuses the
// finder chrome (fnd-*) for the scrim/panel/input/rows, with a compact single-
// column list (nb-*) since it has no preview pane. ↑↓ move, Enter switch/open,
// Esc close. The current notebook is marked and sits at the top; the initial
// selection lands on the most-recent OTHER notebook, so Enter is a quick alt-tab.
import { useEffect, useMemo, useRef, useState } from "react";
import { FolderOpen } from "lucide-react";
import { backend, type NotebookRef } from "../backend";
import { scrollRowIntoView, subseq } from "./list-nav";

function ago(ms: number, now: number): string {
  if (!ms) return "";
  const d = Math.round((now - ms) / 86_400_000);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 7) return `${d}d ago`;
  const w = Math.round(d / 7);
  if (w < 5) return `${w}w ago`;
  return `${Math.round(d / 30)}mo ago`;
}

export function NotebookSwitcher({
  current,
  onSwitch,
  onOpenFolder,
  onClose,
}: {
  current: string | null;
  onSwitch: (path: string) => void;
  onOpenFolder: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const [notebooks, setNotebooks] = useState<NotebookRef[]>([]);
  const [now] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    let alive = true;
    backend
      .listNotebooks()
      .then((ns) => alive && setNotebooks(ns))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => notebooks.filter((n) => subseq(q, n.name) || subseq(q, n.path)),
    [notebooks, q],
  );

  // Empty query → default to the most-recent OTHER notebook (alt-tab); while
  // filtering → the top match.
  useEffect(() => {
    if (q) {
      setSel(0);
      return;
    }
    const i = filtered.findIndex((n) => n.path !== current);
    setSel(i >= 0 ? i : 0);
  }, [q, filtered, current]);

  useEffect(() => {
    scrollRowIntoView(listRef.current, sel);
  }, [sel, filtered]);

  // The trailing "Open folder…" action lives just past the notebook rows.
  const openIndex = filtered.length;
  const count = openIndex + 1;

  const run = (i: number) => {
    if (i === openIndex) {
      onOpenFolder();
      onClose();
      return;
    }
    const nb = filtered[i];
    if (nb) {
      onSwitch(nb.path);
      onClose();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
      e.preventDefault();
      setSel((s) => Math.min(count - 1, s + 1));
    } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(sel);
    }
  };

  return (
    <div className="fnd-scrim" onMouseDown={onClose}>
      <div className="fnd-panel nb-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="fnd-head">
          <span className="fnd-promptchar">notebook ›</span>
          <input
            ref={inputRef}
            className="fnd-input"
            value={query}
            spellCheck={false}
            placeholder="switch or open a notebook…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>

        <div className="nb-list" ref={listRef}>
          {filtered.map((nb, i) => (
            <div
              key={nb.path}
              className={"fnd-row" + (i === sel ? " is-sel" : "")}
              onMouseMove={() => i !== sel && setSel(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                run(i);
              }}
            >
              <span className="fnd-name">{nb.name}</span>
              <span className="fnd-path">{nb.path}</span>
              <span className="fnd-frec">
                {nb.path === current ? "current" : ago(nb.lastOpened, now)}
              </span>
            </div>
          ))}
          <div
            className={"fnd-row nb-open" + (sel === openIndex ? " is-sel" : "")}
            onMouseMove={() => sel !== openIndex && setSel(openIndex)}
            onMouseDown={(e) => {
              e.preventDefault();
              run(openIndex);
            }}
          >
            <FolderOpen className="nb-openicon" size={15} aria-hidden="true" />
            <span className="fnd-name">Open folder…</span>
          </div>
        </div>

        <div className="fnd-foot">
          <span className="fnd-hint">
            <b>↑↓</b> move · <b>↵</b> open · <b>Esc</b> close
          </span>
          <span className="fnd-count">
            {notebooks.length} {notebooks.length === 1 ? "notebook" : "notebooks"}
          </span>
        </div>
      </div>
    </div>
  );
}
