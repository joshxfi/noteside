// Fuzzy finder overlay. Default "All" mode merges fuzzy file/title matches with
// content matches in one list; Files / Content narrow it. Queries the backend
// (Rust nucleo + content scan, or the mock) with a short debounce; the preview
// pane reads selected note text from the backend's in-memory preview path.
import { createElement, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { backend, type ContentHit, type FileHit, type GrepMode } from "../backend";

const GREP_MODES: GrepMode[] = ["plain", "regex", "fuzzy"];

type Range = [number, number];

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

function rangesFromPositions(positions: number[]): Range[] {
  const r: Range[] = [];
  for (const p of positions) {
    const last = r[r.length - 1];
    if (last && p === last[1]) last[1] = p + 1;
    else r.push([p, p + 1]);
  }
  return r;
}

function FileRow({ item }: { item: FileHit }) {
  const path = item.path;
  const bStart = path.lastIndexOf("/") + 1;
  const dir = path.slice(0, bStart);
  const name = path.slice(bStart);
  const filenameTitle = name.replace(/\.md$/i, "");
  const showTitle = item.title && item.title !== name && item.title !== filenameTitle;
  const titleRanges = rangesFromPositions(item.titlePositions);
  const nameRanges = rangesFromPositions(
    item.positions.filter((p) => p >= bStart).map((p) => p - bStart),
  );
  const dirRanges = rangesFromPositions(item.positions.filter((p) => p < bStart));
  return (
    <>
      <span className="fnd-name">
        {showTitle ? hl(item.title, titleRanges) : hl(name, nameRanges)}
      </span>
      {showTitle ? (
        <span className="fnd-path">{hl(path, rangesFromPositions(item.positions))}</span>
      ) : dir ? (
        <span className="fnd-path">{hl(dir, dirRanges)}</span>
      ) : null}
      {item.pinned ? (
        <span className="fnd-frec" title="pinned">
          pinned
        </span>
      ) : null}
    </>
  );
}

function GrepRow({ item }: { item: ContentHit }) {
  const lead = item.line.length - item.line.trimStart().length;
  const text = item.line.slice(lead);
  const ranges = item.ranges
    .filter(([, e]) => e > lead)
    .map(([s, e]) => [Math.max(0, s - lead), e - lead] as Range);
  return (
    <>
      <span className="fnd-grepline">{hl(text, ranges)}</span>
      <span className="fnd-loc">
        {item.title}:{item.lineNumber}
      </span>
    </>
  );
}

function Preview({
  path,
  lines,
  activeLine,
  ranges,
}: {
  path: string | null;
  lines: string[] | null;
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
  }, [activeLine, path]);
  if (!path || !lines) {
    return (
      <div className="fnd-preview">
        <div className="fnd-prevempty">no match</div>
      </div>
    );
  }
  return (
    <div className="fnd-preview">
      <div className="fnd-prevhead">{path}</div>
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

type Mode = "all" | "files" | "content";
const MODES: Mode[] = ["all", "files", "content"];

function itemKey(item: FileHit | ContentHit): string {
  return "lineNumber" in item
    ? `content:${item.path}:${item.lineNumber}:${item.line}`
    : `file:${item.path}`;
}

export interface FinderProps {
  initialMode: Mode;
  onClose: () => void;
  onOpen: (path: string, line: number) => void;
}

export function Finder({ initialMode, onClose, onOpen }: FinderProps) {
  const [mode, setMode] = useState<Mode>(initialMode || "all");
  const [grepMode, setGrepMode] = useState<GrepMode>("plain");
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const [items, setItems] = useState<(FileHit | ContentHit)[]>([]);
  const [preview, setPreview] = useState<{ path: string; lines: string[] } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previewCacheRef = useRef(new Map<string, string[]>());

  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  // debounced search. "all" merges fuzzy file/title matches with content matches.
  useEffect(() => {
    let alive = true;
    const id = setTimeout(async () => {
      try {
        let result: (FileHit | ContentHit)[];
        if (mode === "files") {
          result = await backend.searchFiles(query);
        } else if (mode === "content") {
          result = await backend.searchContent(query, grepMode);
        } else {
          const [files, content] = await Promise.all([
            backend.searchFiles(query),
            query.trim()
              ? backend.searchContent(query, "plain")
              : Promise.resolve<ContentHit[]>([]),
          ]);
          result = [...files, ...content]; // files (open-by-name) first, then content
        }
        if (alive) {
          setItems(result);
          setSel(0);
        }
      } catch {
        if (alive) setItems([]);
      }
    }, 80);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [query, mode, grepMode]);

  const selItem = items[sel];
  const selPath = selItem?.path ?? null;

  // keep selection in view
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

  // Lazily load preview text from the backend's cached path, then memoize it for
  // this overlay session so moving across many hits in the same file stays cheap.
  useEffect(() => {
    if (!selPath) {
      setPreview(null);
      return;
    }
    const cached = previewCacheRef.current.get(selPath);
    if (cached) {
      setPreview({ path: selPath, lines: cached });
      return;
    }
    let alive = true;
    backend
      .previewNote(selPath)
      .then((doc) => {
        if (!alive) return;
        const lines = doc.body.split("\n");
        previewCacheRef.current.set(selPath, lines);
        setPreview({ path: selPath, lines });
      })
      .catch(() => alive && setPreview(null));
    return () => {
      alive = false;
    };
  }, [selPath]);

  const open = () => {
    if (selItem) onOpen(selItem.path, "lineNumber" in selItem ? selItem.lineNumber : 0);
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
    } else if (e.key === "PageDown") {
      e.preventDefault();
      setSel((s) => Math.min(items.length - 1, s + 10));
    } else if (e.key === "PageUp") {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 10));
      // Home/End are left to the input for editing the query text (conventional).
    } else if (e.key === "Enter") {
      e.preventDefault();
      open();
    } else if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      setMode((m) => MODES[(MODES.indexOf(m) + 1) % MODES.length]);
    } else if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      if (mode === "content")
        setGrepMode((g) => GREP_MODES[(GREP_MODES.indexOf(g) + 1) % GREP_MODES.length]);
    }
  };

  const selGrep = selItem && "lineNumber" in selItem ? (selItem as ContentHit) : null;

  return (
    <div className="fnd-scrim" onMouseDown={onClose}>
      <div className="fnd-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="fnd-head">
          <span className="fnd-promptchar">{mode === "content" ? "grep" : "find"} ›</span>
          <input
            ref={inputRef}
            className="fnd-input"
            value={query}
            spellCheck={false}
            role="combobox"
            aria-controls="fnd-listbox"
            aria-expanded={items.length > 0}
            aria-autocomplete="list"
            aria-activedescendant={items.length > 0 ? `fnd-opt-${sel}` : undefined}
            placeholder={
              mode === "content"
                ? "search note contents…"
                : mode === "files"
                  ? "fuzzy file name…"
                  : "search files and contents…"
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
            {MODES.map((m) => (
              <button
                key={m}
                className={"fnd-tab" + (mode === m ? " is-on" : "")}
                tabIndex={-1}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setMode(m);
                }}
              >
                {m === "all" ? "All" : m === "files" ? "Files" : "Content"}
              </button>
            ))}
          </div>
        </div>

        <div className="fnd-body">
          <div
            className="fnd-list"
            ref={listRef}
            id="fnd-listbox"
            role="listbox"
            aria-label="Search results"
          >
            {items.length === 0 ? (
              <div className="fnd-empty">
                {query ? "no matches" : "type to search your notebook"}
              </div>
            ) : (
              items.map((item, i) => (
                <div
                  key={itemKey(item)}
                  id={`fnd-opt-${i}`}
                  role="option"
                  aria-selected={i === sel}
                  className={"fnd-row" + (i === sel ? " is-sel" : "")}
                  onMouseMove={() => i !== sel && setSel(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onOpen(item.path, "lineNumber" in item ? item.lineNumber : 0);
                  }}
                >
                  {"lineNumber" in item ? <GrepRow item={item} /> : <FileRow item={item} />}
                </div>
              ))
            )}
          </div>
          <Preview
            path={preview?.path ?? null}
            lines={preview?.lines ?? null}
            activeLine={selGrep ? selGrep.lineNumber : null}
            ranges={selGrep ? selGrep.ranges : null}
          />
        </div>

        <div className="fnd-foot">
          <span className="fnd-hint">
            <b>↑↓</b> move · <b>↵</b> open · <b>⇥</b> filter ·{" "}
            {mode === "content" ? (
              <>
                <b>⇧⇥</b> grep mode ·{" "}
              </>
            ) : null}
            <b>⎋</b> close
          </span>
          <span className="fnd-count">
            {items.length} {items.length === 1 ? "result" : "results"}
          </span>
        </div>
      </div>
    </div>
  );
}
