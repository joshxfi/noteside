// Leader command palette (which-key style). Opened with <Space> in normal mode
// (or :palette). Press a command's key chord to run it; destructive actions ask
// for confirmation. Esc closes.
import { useEffect, useRef, useState } from "react";

export interface PaletteAction {
  key: string;
  label: string;
  hint?: string;
  danger?: boolean;
  run: () => void;
}

export function CommandPalette({
  actions,
  onClose,
}: {
  actions: PaletteAction[];
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [confirm, setConfirm] = useState<PaletteAction | null>(null);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  const choose = (a: PaletteAction) => {
    if (a.danger) setConfirm(a);
    else {
      a.run();
      onClose();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (confirm) setConfirm(null);
      else onClose();
      return;
    }
    if (confirm) {
      if (e.key === "y" || e.key === "Enter") {
        e.preventDefault();
        confirm.run();
        onClose();
      } else if (e.key === "n") {
        e.preventDefault();
        setConfirm(null);
      }
      return;
    }
    const a = actions.find((x) => x.key === e.key);
    if (a) {
      e.preventDefault();
      choose(a);
    }
  };

  return (
    <div className="pal-scrim" onMouseDown={onClose}>
      <div
        className="pal-panel"
        ref={panelRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="pal-head">
          <span className="pal-leader">␣</span>
          {confirm ? "Confirm" : "Commands"}
        </div>
        {confirm ? (
          <div className="pal-confirm">
            <span>{confirm.label}?</span>
            <span className="pal-keys">
              <kbd>y</kbd> yes · <kbd>n</kbd> no
            </span>
          </div>
        ) : (
          <div className="pal-list">
            {actions.map((a) => (
              <button
                key={a.key}
                type="button"
                className={"pal-row" + (a.danger ? " danger" : "")}
                onClick={() => choose(a)}
              >
                <kbd className="pal-key">{a.key === " " ? "␣" : a.key}</kbd>
                <span className="pal-label">{a.label}</span>
                {a.hint && <span className="pal-hint">{a.hint}</span>}
              </button>
            ))}
          </div>
        )}
        <div className="pal-foot">
          <span>
            <b>key</b> run
          </span>
          <span>
            <b>⎋</b> close
          </span>
        </div>
      </div>
    </div>
  );
}
