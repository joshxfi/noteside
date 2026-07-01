// theme-picker.tsx — the keyboard-first theme switcher. Opened with <Space>t or
// :theme. Two columns (dark · light), LIVE-PREVIEWS the highlighted theme by
// applying its tokens straight to <html> (Enter commits, Esc reverts), and opens
// on the CURRENT theme. Reuses the finder (fnd-*) row styling.
import { useEffect, useMemo, useRef, useState } from "react";
import { applyThemeVars, type Theme, THEMES, themeById } from "../themes";

type Col = "dark" | "light";

function subseq(q: string, text: string): boolean {
  if (!q) return true;
  const t = text.toLowerCase();
  let i = 0;
  for (let j = 0; j < t.length && i < q.length; j++) if (t[j] === q[i]) i++;
  return i === q.length;
}

// Apply a theme's look to the document immediately (bypasses React — the app's
// config effect only runs on a committed cfg change, so this is the preview path).
function previewTheme(theme: Theme): void {
  const r = document.documentElement;
  r.setAttribute("data-theme", theme.mode);
  applyThemeVars(r, theme);
}

const chip = (t: Theme) =>
  `linear-gradient(90deg, ${t.preview[0]} 0 34%, ${t.preview[1]} 34% 67%, ${t.preview[2]} 67% 100%)`;

export function ThemePicker({
  current,
  onCommit,
  onClose,
}: {
  current: string;
  onCommit: (id: string) => void;
  onClose: () => void;
}) {
  const startTheme = themeById(current);
  const [query, setQuery] = useState("");
  // Open on the current theme: its column, and its index within that column.
  const [col, setCol] = useState<Col>(startTheme.mode);
  const [idx, setIdx] = useState(() =>
    Math.max(
      0,
      THEMES.filter((t) => t.mode === startTheme.mode).findIndex((t) => t.id === current),
    ),
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const darkRef = useRef<HTMLDivElement>(null);
  const lightRef = useRef<HTMLDivElement>(null);
  const committed = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Revert the live preview on unmount unless a choice was committed.
  useEffect(
    () => () => {
      if (!committed.current) previewTheme(themeById(current));
    },
    [current],
  );

  const q = query.trim().toLowerCase();
  const dark = useMemo(() => THEMES.filter((t) => t.mode === "dark" && subseq(q, t.label)), [q]);
  const light = useMemo(() => THEMES.filter((t) => t.mode === "light" && subseq(q, t.label)), [q]);
  const list = col === "dark" ? dark : light;
  const clampedIdx = Math.min(idx, Math.max(0, list.length - 1));
  const selected = list[clampedIdx];

  // On filter change (NOT on mount — that would clobber the current-theme
  // selection), jump to the first match, preferring a column that has results.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setIdx(0);
    setCol((c) =>
      (c === "dark" ? dark.length : light.length) > 0 ? c : dark.length ? "dark" : "light",
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // Live-preview the highlighted theme (THEMES entries are stable references, so
  // this only fires when the highlighted theme actually changes).
  useEffect(() => {
    if (selected) previewTheme(selected);
  }, [selected]);

  // Keep the highlighted row scrolled into view within its column.
  useEffect(() => {
    const c = (col === "dark" ? darkRef : lightRef).current;
    const el = c?.children[clampedIdx] as HTMLElement | undefined;
    if (!c || !el) return;
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    if (top < c.scrollTop) c.scrollTop = top;
    else if (bottom > c.scrollTop + c.clientHeight) c.scrollTop = bottom - c.clientHeight;
  }, [col, clampedIdx]);

  const commit = (t: Theme | undefined) => {
    if (!t) return;
    committed.current = true;
    onCommit(t.id);
    onClose();
  };

  const switchCol = (next: Col) => {
    const len = (next === "dark" ? dark : light).length;
    if (len === 0) return; // don't move to an empty column
    setCol(next);
    setIdx((i) => Math.max(0, Math.min(i, len - 1)));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
      e.preventDefault();
      setIdx((i) => Math.min(list.length - 1, i + 1));
    } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
      e.preventDefault();
      setIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      switchCol("dark");
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      switchCol("light");
    } else if (e.key === "Tab") {
      e.preventDefault();
      switchCol(col === "dark" ? "light" : "dark");
    } else if (e.key === "Enter") {
      e.preventDefault();
      commit(selected);
    }
  };

  const renderCol = (items: Theme[], name: Col) => (
    <div className="thm-col">
      <div className="thm-colhead">{name}</div>
      <div className="thm-collist" ref={name === "dark" ? darkRef : lightRef}>
        {items.length === 0 ? (
          <div className="fnd-empty">no matches</div>
        ) : (
          items.map((t, i) => (
            <div
              key={t.id}
              className={
                "fnd-row thm-row" +
                (name === col && i === clampedIdx ? " is-sel" : "") +
                (t.id === current ? " is-current" : "")
              }
              onMouseMove={() => {
                if (col !== name || clampedIdx !== i) {
                  setCol(name);
                  setIdx(i);
                }
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                commit(t);
              }}
            >
              <span className="thm-chip" aria-hidden="true" style={{ background: chip(t) }} />
              <span className="fnd-name">{t.label}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );

  const count = dark.length + light.length;
  return (
    <div className="fnd-scrim" onMouseDown={onClose}>
      <div className="fnd-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="fnd-head">
          <span className="fnd-promptchar">theme ›</span>
          <input
            ref={inputRef}
            className="fnd-input"
            value={query}
            spellCheck={false}
            placeholder="preview a theme…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>

        <div className="thm-cols">
          {renderCol(dark, "dark")}
          {renderCol(light, "light")}
        </div>

        <div className="fnd-foot">
          <span className="fnd-hint">
            <b>↑↓</b> move · <b>←→</b> column · <b>↵</b> apply · <b>Esc</b> cancel
          </span>
          <span className="fnd-count">
            {count} {count === 1 ? "theme" : "themes"}
          </span>
        </div>
      </div>
    </div>
  );
}
