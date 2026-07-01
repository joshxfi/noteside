// theme-picker.tsx — the keyboard-first theme switcher. Opened with <Space>t or
// :theme. Filters the theme list, and LIVE-PREVIEWS the highlighted theme by
// applying its tokens straight to <html> (Enter commits, Esc reverts). Reuses the
// finder (fnd-*) markup.
import { useEffect, useRef, useState } from "react";
import { applyThemeVars, type Theme, THEMES, themeById } from "../themes";

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

export function ThemePicker({
  current,
  onCommit,
  onClose,
}: {
  current: string;
  onCommit: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(() =>
    Math.max(
      0,
      THEMES.findIndex((t) => t.id === current),
    ),
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const committed = useRef(false);

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
  const items = THEMES.filter((t) => subseq(q, t.label));
  useEffect(() => setSel(0), [q]);

  // THEMES entries are stable module-level references, so `selected` only changes
  // identity when a different theme is highlighted — the effect previews exactly then.
  const selected = items[sel];
  useEffect(() => {
    if (selected) previewTheme(selected);
  }, [selected]);

  // Keep the highlighted row scrolled into view.
  useEffect(() => {
    const c = listRef.current;
    const el = c?.children[sel] as HTMLElement | undefined;
    if (!c || !el) return;
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    if (top < c.scrollTop) c.scrollTop = top;
    else if (bottom > c.scrollTop + c.clientHeight) c.scrollTop = bottom - c.clientHeight;
  }, [sel]);

  const commit = (t: Theme | undefined) => {
    if (!t) return;
    committed.current = true;
    onCommit(t.id);
    onClose();
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
      commit(items[sel]);
    }
  };

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

        <div className="fnd-body">
          <div className="fnd-list" ref={listRef}>
            {items.length === 0 ? (
              <div className="fnd-empty">no themes</div>
            ) : (
              items.map((t, i) => (
                <div
                  key={t.id}
                  className={
                    "fnd-row thm-row" +
                    (i === sel ? " is-sel" : "") +
                    (t.id === current ? " is-current" : "")
                  }
                  onMouseMove={() => i !== sel && setSel(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commit(t);
                  }}
                >
                  <span
                    className="thm-chip"
                    aria-hidden="true"
                    style={{
                      background: `linear-gradient(90deg, ${t.preview[0]} 0 34%, ${t.preview[1]} 34% 67%, ${t.preview[2]} 67% 100%)`,
                    }}
                  />
                  <span className="fnd-name">{t.label}</span>
                  <span className="fnd-frec">{t.mode}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="fnd-foot">
          <span className="fnd-hint">
            <b>↑↓</b> preview · <b>↵</b> apply · <b>Esc</b> cancel
          </span>
          <span className="fnd-count">
            {items.length} {items.length === 1 ? "theme" : "themes"}
          </span>
        </div>
      </div>
    </div>
  );
}
