// note-context-menu.tsx — right-click menu for a sidebar note row. It replaces
// the WebView's native menu (Look Up / Translate / … — useless for a note) with
// note actions like Delete, which are otherwise only reachable via ex-commands.
//
// Positioned at the cursor and clamped to the viewport (position:fixed, so the
// window's `overflow: hidden` never clips it). Keyboard-navigable (↑/↓/Enter/Esc)
// and closes on any outside click, scroll, or resize. Destructive items require
// an inline confirm step, mirroring the leader palette's y/n gate — deletes are
// permanent (fs::remove_file, no trash) so a mis-click must not lose a note.
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

export interface NoteMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  /** When set, activating swaps the menu to an inline confirm step. */
  confirm?: { prompt: string; label: string };
  run: () => void;
}

export function NoteContextMenu({
  x,
  y,
  title,
  items,
  onClose,
}: {
  x: number;
  y: number;
  title: string;
  items: NoteMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [confirming, setConfirming] = useState<NoteMenuItem | null>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Clamp to the viewport once the real size is known; re-measure when the
  // confirm step changes the height.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const pad = 8;
    const left = x + width > window.innerWidth - pad ? Math.max(pad, x - width) : x;
    const top =
      y + height > window.innerHeight - pad ? Math.max(pad, window.innerHeight - height - pad) : y;
    setPos({ left, top });
  }, [x, y, confirming]);

  // Own the keyboard immediately (right-clicking a row doesn't focus it) and
  // reclaim it whenever the confirm step swaps the contents — the button that was
  // clicked unmounts, dropping focus to <body>, so Esc/Enter would be lost.
  useEffect(() => {
    ref.current?.focus();
  }, [confirming]);

  // Any interaction outside the menu dismisses it. mousedown covers a click
  // elsewhere AND a right-click on another row (which reopens via that row's
  // handler after this closes); scroll/resize catch the row moving out from
  // under the cursor.
  useEffect(() => {
    const outside = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", outside, true);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", outside, true);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const activate = (item: NoteMenuItem) => {
    if (item.confirm) {
      setConfirming(item);
      return;
    }
    item.run();
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (confirming) setConfirming(null);
      else onClose();
      return;
    }
    if (confirming) {
      if (e.key === "Enter") {
        e.preventDefault();
        confirming.run();
        onClose();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + items.length) % items.length);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const item = items[active];
      if (item) activate(item);
    }
  };

  return (
    <div
      ref={ref}
      className="ctx-menu"
      role="menu"
      tabIndex={-1}
      style={{ left: pos.left, top: pos.top }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="ctx-title" title={title}>
        {title}
      </div>
      {confirming ? (
        <div className="ctx-confirm">
          <div className="ctx-confirm-text">{confirming.confirm?.prompt}</div>
          <div className="ctx-confirm-actions">
            <button type="button" className="ctx-btn" onClick={() => setConfirming(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="ctx-btn danger"
              onClick={() => {
                confirming.run();
                onClose();
              }}
            >
              {confirming.confirm?.label}
            </button>
          </div>
        </div>
      ) : (
        items.map((item, i) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={
              "ctx-item" + (item.danger ? " danger" : "") + (i === active ? " is-active" : "")
            }
            onMouseEnter={() => setActive(i)}
            onClick={() => activate(item)}
          >
            <span className="ctx-glyph" aria-hidden="true">
              {item.icon}
            </span>
            <span className="ctx-label">{item.label}</span>
          </button>
        ))
      )}
    </div>
  );
}
