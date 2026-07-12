// confirm-dialog.tsx — a small themed confirmation modal (scrim + panel), used
// for destructive actions like deleting a note. Keyboard-first: Enter confirms,
// Esc cancels, and the panel owns focus on mount so both work without a click
// (the buttons stay mouse-clickable). Matches the app's overlay design (like the
// Settings scrim) so it themes with the palette — unlike a native OS dialog.
import { useEffect, useRef } from "react";

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  message?: string;
  confirmLabel: string;
  /** Style the confirm button as destructive (red). */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Own the keyboard immediately — the action that opened this (a menu item / an
  // ex-command) doesn't leave a focused element the modal can inherit from.
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  // Enter/Esc are handled at the panel level (not per-button) so no button is
  // focused — a focused button would double-fire onConfirm (its click + this).
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "Enter") {
      e.preventDefault();
      onConfirm();
    }
  };

  return (
    <div className="cfm-scrim" onMouseDown={onCancel}>
      <div
        ref={panelRef}
        className="cfm-panel"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="cfm-title">{title}</div>
        {message && <div className="cfm-msg">{message}</div>}
        <div className="cfm-actions">
          <button type="button" className="cfm-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={"cfm-btn" + (danger ? " danger" : "")}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
