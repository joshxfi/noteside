// prompt-dialog.tsx — a themed single-input modal (used to rename a note). Shares
// the ConfirmDialog scrim/panel styles; keyboard-first: the input auto-focuses
// (text pre-selected), Enter submits a non-empty value, Esc cancels.
import { useEffect, useRef, useState } from "react";

export function PromptDialog({
  title,
  initialValue,
  placeholder,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.select(); // rename over the current title in one keystroke
    }
  }, []);

  const submit = () => {
    const v = value.trim();
    if (v) onConfirm(v);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="cfm-scrim" onMouseDown={onCancel}>
      <div
        className="cfm-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="cfm-title">{title}</div>
        <input
          ref={inputRef}
          className="cfm-input"
          value={value}
          placeholder={placeholder}
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="cfm-actions">
          <button type="button" className="cfm-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="cfm-btn primary"
            onClick={submit}
            disabled={!value.trim()}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
