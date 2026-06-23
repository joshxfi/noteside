// onboarding.tsx — one-time first-launch choice: vim navigation or plain
// keyboard. Shown only when `isFirstLaunch` (settings.ts) holds; the moment the
// user picks, App persists `cfg.vimMode`, so it never appears again. Both modes
// are first-class — there is no "skip", just two equally valid doors in.
import { useEffect, useRef, useState } from "react";
import { chordLabel } from "../editor/commands";

export function Onboarding({ onChoose }: { onChoose: (vim: boolean) => void }) {
  // Vim is Noteside's identity, so it's the default keyboard highlight. `sel` is a
  // keyboard-only cursor (arrows/h/l); a mouse click picks its card directly.
  const [sel, setSel] = useState<0 | 1>(0); // 0 = vim, 1 = plain keyboard
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const k = e.key;
    if (k === "ArrowLeft" || k === "h") {
      e.preventDefault();
      setSel(0);
    } else if (k === "ArrowRight" || k === "l") {
      e.preventDefault();
      setSel(1);
    } else if (k === "Enter" || k === " ") {
      e.preventDefault();
      onChoose(sel === 0);
    } else if (k === "v") {
      e.preventDefault();
      onChoose(true); // v → straight to vim
    } else if (k === "p") {
      e.preventDefault();
      onChoose(false); // p → straight to plain keyboard
    }
  };

  return (
    <div className="av-empty ob" ref={ref} tabIndex={0} onKeyDown={onKeyDown}>
      <div className="av-mark" aria-label="Noteside">
        <span className="n">N</span>
        <span className="cur" />
      </div>
      <div className="av-empty-title">How do you want to edit?</div>
      <div className="av-empty-sub">
        Noteside is keyboard-first either way. Pick what feels like home — you can change this
        anytime in Settings.
      </div>
      <div className="ob-cards" role="radiogroup" aria-label="Editing mode">
        <button
          type="button"
          role="radio"
          tabIndex={-1}
          aria-checked={sel === 0}
          className={"ob-card" + (sel === 0 ? " is-sel" : "")}
          onClick={() => onChoose(true)}
        >
          <span className="ob-card-name">Vim</span>
          <span className="ob-card-desc">
            Modal editing — opens in NORMAL mode. <kbd>i</kbd> to insert, <kbd>:w</kbd> to save,{" "}
            <kbd>hjkl</kbd> to move. Full vim, built in.
          </span>
          <span className="ob-card-keys">
            <kbd>h</kbd>
            <kbd>j</kbd>
            <kbd>k</kbd>
            <kbd>l</kbd>
          </span>
        </button>
        <button
          type="button"
          role="radio"
          tabIndex={-1}
          aria-checked={sel === 1}
          className={"ob-card" + (sel === 1 ? " is-sel" : "")}
          onClick={() => onChoose(false)}
        >
          <span className="ob-card-name">Plain keyboard</span>
          <span className="ob-card-desc">
            Type like any editor. Familiar chords do everything — find, save, new note, the command
            palette.
          </span>
          <span className="ob-card-keys">
            <kbd>{chordLabel("Mod-p")}</kbd>
            <kbd>{chordLabel("Mod-s")}</kbd>
            <kbd>{chordLabel("Mod-/")}</kbd>
          </span>
        </button>
      </div>
      <div className="av-empty-keys ob-hint">
        <kbd>←</kbd> <kbd>→</kbd> move · <kbd>↵</kbd> confirm
      </div>
    </div>
  );
}
