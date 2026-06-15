// Finder.tsx — the fuzzy finder overlay (Files + Content modes).
// Talks to the fff seam for results, so the search backend is swappable.
import { createElement, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import * as FFF from "../fff";
import type { FileItem, GrepItem, GrepMode, Range } from "../fff";
import type { GitStatus, Note } from "../types";

const GIT: Record<string, { letter: string; cls: string }> = {
  modified: { letter: "M", cls: "git-modified" },
  untracked: { letter: "U", cls: "git-untracked" },
  staged: { letter: "S", cls: "git-staged" },
  deleted: { letter: "D", cls: "git-deleted" },
  renamed: { letter: "R", cls: "git-staged" },
};
const GREP_MODES: GrepMode[] = ["plain", "regex", "fuzzy"];

function hl(str: string, ranges?: Range[]): ReactNode {
  if (!ranges || !ranges.length) return str;
  const out: ReactNode[] = [];
  let i = 0;
  ranges.forEach((r, k) => {
    const [s, e] = r;
    if (s > i) out.push(str.slice(i, s));
    out.push(createElement("mark", { key: k, className: "fnd-hl" }, str.slice(s, e)));
    i = e;
  });
  if (i < str.length) out.push(str.slice(i));
  return out;
}

function GitTag({ status }: { status: GitStatus }) {
  const g = status ? GIT[status] : undefined;
  return <span className={"fnd-git " + (g ? g.cls : "")}>{g ? g.letter : ""}</span>;
}

function FileRow({ item }: { item: FileItem }) {
  const path = item.relative_path;
  const bStart = path.lastIndexOf("/") + 1;
  const dir = path.slice(0, bStart);
  const name = path.slice(bStart);
  const nameRanges = FFF.rangesFromPositions(
    (item.positions || []).filter((p) => p >= bStart).map((p) => p - bStart),
  );
  const dirRanges = FFF.rangesFromPositions((item.positions || []).filter((p) => p < bStart));
  return (
    <>
      <GitTag status={item.git_status} />
      <span className="fnd-name">{hl(name, nameRanges)}</span>
      {dir ? <span className="fnd-path">{hl(dir, dirRanges)}</span> : null}
      {item.frecency >= 70 ? (
        <span className="fnd-frec" title="recently opened">
          recent
        </span>
      ) : null}
    </>
  );
}

function GrepRow({ item }: { item: GrepItem }) {
  const lead = item.line_content.length - item.line_content.trimStart().length;
  const text = item.line_content.slice(lead);
  const ranges = item.match_ranges.map(
    ([s, e]) => [Math.max(0, s - lead), Math.max(0, e - lead)] as Range,
  );
  return (
    <>
      <GitTag status={item.git_status} />
      <span className="fnd-grepline">{hl(text, ranges)}</span>
      <span className="fnd-loc">
        {item.name}:{item.line_number}
      </span>
    </>
  );
}

function Preview({
  note,
  activeLine,
  ranges,
}: {
  note: Note | null;
  activeLine: number | null;
  ranges: Range[] | null;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const c = bodyRef.current,
      el = lineRef.current;
    if (!c || !el) return;
    const top = el.offsetTop,
      bottom = top + el.offsetHeight;
    if (top < c.scrollTop + 24) c.scrollTop = Math.max(0, top - 24);
    else if (bottom > c.scrollTop + c.clientHeight - 24) c.scrollTop = bottom - c.clientHeight + 24;
  }, [activeLine, note]);
  if (!note)
    return (
      <div className="fnd-preview">
        <div className="fnd-prevempty">no match</div>
      </div>
    );
  const lines = note.body.split("\n");
  return (
    <div className="fnd-preview">
      <div className="fnd-prevhead">{note.path}</div>
      <div className="fnd-prevbody" ref={bodyRef}>
        {lines.map((ln, i) => {
          const isMatch = activeLine === i + 1;
          return (
            <div
              key={i}
              className={"fnd-prevline" + (isMatch ? " is-match" : "")}
              ref={isMatch ? lineRef : null}
            >
              {isMatch && ranges ? hl(ln, ranges) : ln || "​"}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export interface FinderProps {
  notes: Note[];
  initialMode: "files" | "content";
  onClose: () => void;
  onOpen: (id: string, line: number) => void;
}

export function Finder({ notes, initialMode, onClose, onOpen }: FinderProps) {
  const [mode, setMode] = useState<"files" | "content">(initialMode || "files");
  const [grepMode, setGrepMode] = useState<GrepMode>("plain");
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  const result = useMemo(() => {
    return mode === "files"
      ? FFF.fileSearch(query, notes)
      : FFF.contentSearch(query, notes, { mode: grepMode });
  }, [mode, grepMode, query, notes]);
  const items = result.items as (FileItem | GrepItem)[];

  useEffect(() => {
    setSel(0);
  }, [mode, grepMode, query]);
  useEffect(() => {
    const c = listRef.current;
    if (!c) return;
    const el = c.children[sel] as HTMLElement | undefined;
    if (!el) return;
    const top = el.offsetTop,
      bottom = top + el.offsetHeight;
    if (top < c.scrollTop) c.scrollTop = top;
    else if (bottom > c.scrollTop + c.clientHeight) c.scrollTop = bottom - c.clientHeight;
  }, [sel, items]);

  const selItem = items[sel];
  const selNote = selItem ? notes.find((n) => n.id === selItem.id) || null : null;

  const open = () => {
    if (selItem) onOpen(selItem.id, "line_number" in selItem ? selItem.line_number : 0);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
      e.preventDefault();
      setSel((s) => Math.min(items.length - 1, s + 1));
    } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      open();
    } else if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      setMode((m) => (m === "files" ? "content" : "files"));
    } else if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      if (mode === "content")
        setGrepMode((g) => GREP_MODES[(GREP_MODES.indexOf(g) + 1) % GREP_MODES.length]);
    }
  };

  const selGrep = selItem && "line_number" in selItem ? (selItem as GrepItem) : null;

  return (
    <div className="fnd-scrim" onMouseDown={onClose}>
      <div className="fnd-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="fnd-head">
          <span className="fnd-promptchar">{mode === "files" ? "find" : "grep"} ›</span>
          <input
            ref={inputRef}
            className="fnd-input"
            value={query}
            spellCheck={false}
            placeholder={
              mode === "files"
                ? "fuzzy path…  (try  git:modified  or  *.md)"
                : "search note contents…"
            }
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {mode === "content" && (
            <span className="fnd-grepmode" title="Shift-Tab to cycle">
              {grepMode}
            </span>
          )}
          <div className="fnd-tabs">
            <button
              className={"fnd-tab" + (mode === "files" ? " is-on" : "")}
              tabIndex={-1}
              onMouseDown={(e) => {
                e.preventDefault();
                setMode("files");
              }}
            >
              Files
            </button>
            <button
              className={"fnd-tab" + (mode === "content" ? " is-on" : "")}
              tabIndex={-1}
              onMouseDown={(e) => {
                e.preventDefault();
                setMode("content");
              }}
            >
              Content
            </button>
          </div>
        </div>

        <div className="fnd-body">
          <div className="fnd-list" ref={listRef}>
            {items.length === 0 ? (
              <div className="fnd-empty">{query ? "no matches" : "type to search the vault"}</div>
            ) : (
              items.map((item, i) => (
                <div
                  key={mode + i}
                  className={"fnd-row" + (i === sel ? " is-sel" : "")}
                  onMouseMove={() => i !== sel && setSel(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setSel(i);
                    if (item) onOpen(item.id, "line_number" in item ? item.line_number : 0);
                  }}
                >
                  {mode === "files" ? (
                    <FileRow item={item as FileItem} />
                  ) : (
                    <GrepRow item={item as GrepItem} />
                  )}
                </div>
              ))
            )}
          </div>
          <Preview
            note={selNote}
            activeLine={mode === "content" && selGrep ? selGrep.line_number : null}
            ranges={mode === "content" && selGrep ? selGrep.match_ranges : null}
          />
        </div>

        <div className="fnd-foot">
          <span className="fnd-hint">
            <b>↑↓</b> move · <b>↵</b> open · <b>⇥</b> {mode === "files" ? "content" : "files"} ·{" "}
            {mode === "content" ? (
              <>
                <b>⇧⇥</b> grep mode ·{" "}
              </>
            ) : null}
            <b>⎋</b> close
          </span>
          <span className="fnd-count">
            {items.length}
            {result.total_matched > items.length ? "+" : ""}{" "}
            {mode === "files" ? "files" : "matches"}
          </span>
        </div>
      </div>
    </div>
  );
}
