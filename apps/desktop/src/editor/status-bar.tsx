// status-bar.tsx — the editor's bottom bar, shared by the block editor and the
// plain-text config buffer so the .av-status DOM contract lives in one place.
// line:col reads as block:offset in the block editor (the unit changed with the
// engine); pct is position over blocks.
import { chordLabel } from "./commands";

export interface EditorStat {
  words: number;
  line: number;
  col: number;
  pct: string;
  dirty: boolean;
}

export function StatusBar(props: {
  modeClass: string;
  modeLabel: string;
  /** vim showcmd — the pending count/operator; empty when idle. */
  pendingLabel?: string;
  fileLabel: string;
  stat: EditorStat;
  onSave: () => void;
}) {
  const { stat } = props;
  return (
    <div className="av-status">
      <div className={"av-mode " + props.modeClass}>{props.modeLabel}</div>
      {props.pendingLabel ? <div className="av-showcmd">{props.pendingLabel}</div> : null}
      <div className="av-file">
        {props.fileLabel}
        {stat.dirty && (
          <button
            type="button"
            className="av-dirty"
            title={`unsaved — click to save (${chordLabel("Mod-s")})`}
            onMouseDown={(e) => e.preventDefault()} // keep the editor focused (Chromium focuses buttons on click)
            onClick={props.onSave}
          >
            [+]
          </button>
        )}
      </div>
      <div className="av-spacer" />
      <div className="av-stat">{stat.words} words</div>
      <div className="av-stat">
        {stat.line}:{stat.col}
      </div>
      <div className="av-stat av-pct">{stat.pct}</div>
    </div>
  );
}
