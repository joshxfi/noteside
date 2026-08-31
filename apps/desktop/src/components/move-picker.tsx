// Move-to-folder picker overlay — choose the destination folder for one note.
// Opened from a note's context menu ("Move to folder…"), :mv, <Space>m, or the
// palette. Reuses the finder chrome (fnd-*) + the switcher's compact list
// (nb-*): ↑↓ move, Enter move, Esc close. The note's current folder is marked
// (picking it just closes — the backend treats a same-dir move as a no-op
// anyway). "New folder…" opens an in-overlay name form that creates the folder
// and moves the note into it in one step; Esc backs out of it to the list.
import { useEffect, useMemo, useRef, useState } from "react";
import { Folder, FolderPlus, Inbox } from "lucide-react";
import { pointerMoved, scrollRowIntoView, subseq } from "./list-nav";

export function MovePicker({
  title,
  currentDir,
  dirs,
  onMove,
  onCreateFolder,
  onClose,
}: {
  /** The note's title, shown in the prompt. */
  title: string;
  /** The note's current folder ("" = the notebook root). */
  currentDir: string;
  /** Every folder in the notebook (sorted rel dirs, empties included). */
  dirs: string[];
  onMove: (dir: string) => void;
  /** Create a folder; resolves to its canonical rel dir (null on failure). */
  onCreateFolder: (name: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selByPointer = useRef(false);
  const moved = useRef(pointerMoved());
  const hoverSel = (i: number, e: { clientX: number; clientY: number }) => {
    if (!moved.current(e)) return; // synthetic hover under a stationary cursor
    selByPointer.current = true;
    setSel(i);
  };

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => dirs.filter((d) => subseq(q, d)), [dirs, q]);

  // Rows: [root, …folders, New folder…]. The root row is skipped while a query
  // filters (typing means the user wants a named folder).
  const showRoot = !q;
  const rootIndex = showRoot ? 0 : -1;
  const dirIndex = (i: number) => (showRoot ? i + 1 : i);
  const newIndex = (showRoot ? 1 : 0) + filtered.length;
  const count = newIndex + 1;

  // Default the selection to the first folder that isn't the current one —
  // Enter is a quick "move somewhere else", never a same-dir no-op.
  useEffect(() => {
    if (creating) return;
    selByPointer.current = false;
    const i = filtered.findIndex((d) => d !== currentDir);
    if (i >= 0) setSel(dirIndex(i));
    else if (showRoot && currentDir !== "") setSel(0);
    else setSel(newIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, filtered, currentDir, creating]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [creating]);

  useEffect(() => {
    if (!creating && !selByPointer.current) scrollRowIntoView(listRef.current, sel);
  }, [sel, filtered, creating]);

  const submitCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const rel = await onCreateFolder(trimmed);
    if (rel !== null) onMove(rel); // create-and-move in one step
  };

  const run = (i: number) => {
    if (i === newIndex) {
      setName("");
      setCreating(true);
      return;
    }
    if (i === rootIndex) {
      onMove("");
      return;
    }
    const dir = filtered[showRoot ? i - 1 : i];
    if (dir !== undefined) onMove(dir);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return; // IME composition owns Enter/arrows
    selByPointer.current = false;
    if (creating) {
      if (e.key === "Escape") {
        e.preventDefault();
        setCreating(false); // back to the list, not all the way out
      } else if (e.key === "Enter") {
        e.preventDefault();
        void submitCreate();
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
          <span className="fnd-promptchar">{creating ? "new folder ›" : "move ›"}</span>
          <input
            ref={inputRef}
            className="fnd-input"
            value={creating ? name : query}
            spellCheck={false}
            placeholder={creating ? "folder name…" : `move “${title}” to…`}
            onChange={(e) => (creating ? setName(e.target.value) : setQuery(e.target.value))}
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

        {creating ? (
          <div className="nb-create">
            <div className="nb-createhint">creates the folder and moves the note into it.</div>
            <div className="nb-createactions">
              <button
                type="button"
                className="cfm-btn primary"
                tabIndex={-1}
                disabled={!name.trim()}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void submitCreate()}
              >
                Create & move
              </button>
            </div>
          </div>
        ) : (
          <div className="nb-list" ref={listRef}>
            {showRoot && (
              <div
                className={"fnd-row" + (sel === 0 ? " is-sel" : "")}
                onMouseEnter={(e) => sel !== 0 && hoverSel(0, e)}
                onMouseMove={(e) => sel !== 0 && hoverSel(0, e)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => run(0)}
              >
                <Inbox className="nb-openicon" size={15} aria-hidden="true" />
                <span className="fnd-name">Notebook root</span>
                {currentDir === "" && <span className="fnd-frec">current</span>}
              </div>
            )}
            {filtered.map((d, i) => {
              const at = dirIndex(i);
              return (
                <div
                  key={d}
                  className={"fnd-row" + (at === sel ? " is-sel" : "")}
                  onMouseEnter={(e) => at !== sel && hoverSel(at, e)}
                  onMouseMove={(e) => at !== sel && hoverSel(at, e)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => run(at)}
                >
                  <Folder className="nb-openicon" size={15} aria-hidden="true" />
                  <span className="fnd-name">{d}</span>
                  {d === currentDir && <span className="fnd-frec">current</span>}
                </div>
              );
            })}
            <div
              className={"fnd-row nb-open" + (sel === newIndex ? " is-sel" : "")}
              onMouseEnter={(e) => sel !== newIndex && hoverSel(newIndex, e)}
              onMouseMove={(e) => sel !== newIndex && hoverSel(newIndex, e)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => run(newIndex)}
            >
              <FolderPlus className="nb-openicon" size={15} aria-hidden="true" />
              <span className="fnd-name">New folder…</span>
            </div>
          </div>
        )}

        <div className="fnd-foot">
          <span className="fnd-hint">
            {creating ? (
              <>
                <b>↵</b> create & move · <b>Esc</b> back
              </>
            ) : (
              <>
                <b>↑↓</b> move · <b>↵</b> pick · <b>Esc</b> close
              </>
            )}
          </span>
          <span className="fnd-count">
            {dirs.length} {dirs.length === 1 ? "folder" : "folders"}
          </span>
        </div>
      </div>
    </div>
  );
}
