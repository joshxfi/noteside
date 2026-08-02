// context-menu.tsx — a themed in-app context menu, used where the native OS menu
// (native-menu.ts) doesn't exist: the browser dev build and the landing demo.
// The native app keeps the real OS menu — this is the web's pointer path to the
// same note actions, dispatching the SAME App handlers (it's a thin dispatcher,
// exactly like the native menu). Also keyboard-usable once open: ↑↓ move,
// Enter runs, Esc closes; every item is separately reachable as a command too.
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type ContextMenuItem = { label: string; danger?: boolean; run: () => void } | "sep";

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [sel, setSel] = useState(-1);

  // Clamp into the viewport once the menu has a measured size.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
      y: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)),
    });
  }, [x, y]);

  useEffect(() => {
    menuRef.current?.focus();
  }, []);

  const step = (dir: 1 | -1) => {
    setSel((s) => {
      let i = s;
      for (let n = 0; n < items.length; n++) {
        i = (i + dir + items.length) % items.length;
        if (items[i] !== "sep") return i;
      }
      return s;
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
      e.preventDefault();
      step(1);
    } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
      e.preventDefault();
      step(-1);
    } else if (e.key === "Tab") {
      // trap Tab as selection movement — walking focus out past the scrim would
      // leave a menu that no longer hears Esc (global chords are gated off)
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = items[sel];
      if (it && it !== "sep") {
        onClose();
        it.run();
      }
    }
  };

  return (
    <div
      className="ctx-scrim"
      onMouseDown={onClose}
      onContextMenu={(e) => {
        e.preventDefault(); // right-clicking elsewhere just dismisses
        onClose();
      }}
    >
      <div
        ref={menuRef}
        className="ctx-menu"
        role="menu"
        tabIndex={-1}
        style={{ left: pos.x, top: pos.y }}
        onKeyDown={onKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {items.map((it, i) =>
          it === "sep" ? (
            <div key={`sep-${i}`} className="ctx-sep" role="separator" />
          ) : (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className={"ctx-item" + (it.danger ? " danger" : "") + (i === sel ? " is-sel" : "")}
              onMouseEnter={() => setSel(i)}
              onMouseLeave={() => setSel((s) => (s === i ? -1 : s))}
              onClick={() => {
                onClose();
                it.run();
              }}
            >
              {it.label}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
