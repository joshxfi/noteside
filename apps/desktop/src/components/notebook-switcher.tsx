// Notebook switcher overlay — pick a recently-opened notebook (folder), create a
// new one, or open an existing folder. Opened from the titlebar folder button,
// Mod-o, or :notebook. Reuses the finder chrome (fnd-*) for the scrim/panel/input/
// rows, with a compact single-column list (nb-*) since it has no preview pane.
// ↑↓ move, Enter switch/open, Esc close. The current notebook is marked and sits
// at the top; the initial selection lands on the most-recent OTHER notebook, so
// Enter is a quick alt-tab. "New notebook…" opens an in-overlay create form (name
// + a parent location you can change); Esc backs out of it to the list.
import { useEffect, useMemo, useRef, useState } from "react";
import { FolderOpen, FolderPlus } from "lucide-react";
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

/** Parent directory of a path ("/a/b" → "/a", "/a" → "/", null/"" → ""). */
function dirname(p: string | null): string {
  if (!p) return "";
  const s = p.replace(/\/+$/, "");
  const i = s.lastIndexOf("/");
  if (i < 0) return "";
  return i === 0 ? "/" : s.slice(0, i);
}

export function NotebookSwitcher({
  current,
  onSwitch,
  onOpenFolder,
  onCreate,
  onClose,
}: {
  current: string | null;
  onSwitch: (path: string) => void;
  onOpenFolder: () => void;
  onCreate: (parent: string, name: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const [notebooks, setNotebooks] = useState<NotebookRef[]>([]);
  const [now] = useState(() => Date.now());
  // create mode: an in-overlay form for a new notebook (name + parent location).
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

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
  // filtering → the top match. (Skipped in create mode.)
  useEffect(() => {
    if (creating) return;
    if (q) {
      setSel(0);
      return;
    }
    const i = filtered.findIndex((n) => n.path !== current);
    setSel(i >= 0 ? i : 0);
  }, [q, filtered, current, creating]);

  // Focus the shared input: the filter (list mode) or the name field (create mode).
  useEffect(() => {
    inputRef.current?.focus();
  }, [creating]);

  useEffect(() => {
    if (!creating) scrollRowIntoView(listRef.current, sel);
  }, [sel, filtered, creating]);

  // Action rows live just past the notebook rows: [notebooks…, New, Open folder].
  const newIndex = filtered.length;
  const openIndex = filtered.length + 1;
  const count = filtered.length + 2;

  const enterCreate = () => {
    setName("");
    setParent(dirname(current));
    setCreating(true);
  };
  const pickParent = async () => {
    const p = await backend.pickNotebook();
    if (p) setParent(p);
    inputRef.current?.focus();
  };
  const submitCreate = () => {
    if (name.trim() && parent) {
      onCreate(parent, name.trim());
      onClose();
    }
  };

  const run = (i: number) => {
    if (i === newIndex) {
      enterCreate();
      return;
    }
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
    if (creating) {
      if (e.key === "Escape") {
        e.preventDefault();
        setCreating(false); // back to the list, not all the way out
      } else if (e.key === "Enter") {
        e.preventDefault();
        submitCreate();
      }
      return; // other keys type into the name field
    }
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
          <span className="fnd-promptchar">{creating ? "new notebook ›" : "notebook ›"}</span>
          <input
            ref={inputRef}
            className="fnd-input"
            value={creating ? name : query}
            spellCheck={false}
            placeholder={creating ? "notebook name…" : "switch or open a notebook…"}
            onChange={(e) => (creating ? setName(e.target.value) : setQuery(e.target.value))}
            onKeyDown={onKeyDown}
          />
        </div>

        {creating ? (
          <div className="nb-create">
            <div className="nb-createloc">
              <span className="nb-createlabel">in</span>
              <span className="nb-createpath">{parent || "choose a location…"}</span>
              <button
                type="button"
                className="nb-change"
                tabIndex={-1}
                onMouseDown={(e) => {
                  e.preventDefault();
                  void pickParent();
                }}
              >
                change
              </button>
            </div>
            {!parent && <div className="nb-createhint">pick a location before creating.</div>}
          </div>
        ) : (
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
              className={"fnd-row nb-open" + (sel === newIndex ? " is-sel" : "")}
              onMouseMove={() => sel !== newIndex && setSel(newIndex)}
              onMouseDown={(e) => {
                e.preventDefault();
                run(newIndex);
              }}
            >
              <FolderPlus className="nb-openicon" size={15} aria-hidden="true" />
              <span className="fnd-name">New notebook…</span>
            </div>
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
        )}

        <div className="fnd-foot">
          <span className="fnd-hint">
            {creating ? (
              <>
                <b>↵</b> create · <b>Esc</b> back
              </>
            ) : (
              <>
                <b>↑↓</b> move · <b>↵</b> open · <b>Esc</b> close
              </>
            )}
          </span>
          <span className="fnd-count">
            {notebooks.length} {notebooks.length === 1 ? "notebook" : "notebooks"}
          </span>
        </div>
      </div>
    </div>
  );
}
