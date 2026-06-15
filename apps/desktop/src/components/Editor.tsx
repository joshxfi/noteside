// Editor.tsx — the writing surface + status bar + command line + keystroke HUD.
import { useCallback, useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import * as V from "../vim";
import type { Mode, SelRange, VimAction, VimState } from "../types";

const MODE_LABEL: Record<Mode, string> = {
  normal: "NORMAL",
  insert: "INSERT",
  visual: "VISUAL",
  command: "COMMAND",
  search: "SEARCH",
};

export interface EditorNote {
  id: string;
  title: string;
  tag?: string;
  body: string;
}

export interface EditorMeta {
  mode: Mode;
  row: number;
  col: number;
  words: number;
  lines: number;
  dirty: boolean;
  cmd: string;
  message: string;
  cmdActive: boolean;
  prompt: string;
}

export interface EditorProps {
  note: EditorNote;
  savedText: string;
  ext?: string;
  initialRow?: number;
  relativeNumbers: boolean;
  hud: "auto" | "always" | "off";
  escMap: string;
  vimMode?: boolean;
  cursorStyle?: "block" | "bar" | "underline";
  cursorBlink?: boolean;
  refocusToken: number;
  onText?: (id: string, text: string) => void;
  onSaveText?: (id: string, text: string) => void;
  onQuit?: (id: string) => void;
  onMeta?: (meta: EditorMeta) => void;
  onOpenSettings?: () => void;
  onOpenConfig?: () => void;
  onToggleNav?: () => void;
  onOpenFinder?: (mode: "files" | "content") => void;
}

function within(sel: SelRange | null, row: number, col: number): boolean {
  if (!sel) return false;
  const { s, e } = sel;
  if (row < s.row || row > e.row) return false;
  if (s.row === e.row) return col >= s.col && col <= e.col;
  if (row === s.row) return col >= s.col;
  if (row === e.row) return col <= e.col;
  return true;
}

function LineView({
  text,
  rowIdx,
  vs,
  sel,
}: {
  text: string;
  rowIdx: number;
  vs: VimState;
  sel: SelRange | null;
}) {
  const active = rowIdx === vs.row;
  const insert = vs.mode === "insert";
  const showBlock = !insert; // normal/visual/command/search keep the block cursor
  const nodes: JSX.Element[] = [];
  for (let j = 0; j < text.length; j++) {
    if (insert && active && j === vs.col) nodes.push(<i className="av-caret" key={"k" + j} />);
    const isCursor = showBlock && active && j === vs.col;
    const inSel = !isCursor && within(sel, rowIdx, j);
    nodes.push(
      <span key={j} className={isCursor ? "av-cursor" : inSel ? "av-sel" : undefined}>
        {text[j]}
      </span>,
    );
  }
  if (insert && active && vs.col >= text.length) {
    nodes.push(<i className="av-caret" key="ke" />);
    nodes.push(<span key="z">{"​"}</span>);
  } else if (showBlock && active && vs.col >= text.length) {
    nodes.push(
      <span key="ke" className="av-cursor">
        {" "}
      </span>,
    );
  } else {
    nodes.push(<span key="z">{"​"}</span>);
  }
  return <div className={"av-line" + (active ? " is-active" : "")}>{nodes}</div>;
}

export function Editor({
  note,
  savedText,
  ext = ".md",
  initialRow = 0,
  relativeNumbers,
  hud,
  escMap,
  vimMode = true,
  cursorStyle,
  cursorBlink,
  refocusToken,
  onText,
  onSaveText,
  onQuit,
  onMeta,
  onOpenSettings,
  onOpenConfig,
  onToggleNav,
  onOpenFinder,
}: EditorProps) {
  const [vs, setVs] = useState<VimState>(() => {
    const s = V.initVim(note.body);
    if (initialRow) {
      s.row = Math.min(initialRow, s.lines.length - 1);
      s.col = 0;
      s.desired = 0;
    }
    return s;
  });
  const scrollerRef = useRef<HTMLDivElement>(null);
  const colRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [hudOn, setHudOn] = useState(false);
  const hudTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingAction = useRef<{ action: VimAction; text: string } | null>(null);
  const vsRef = useRef(vs);
  vsRef.current = vs;

  // when vim mode is toggled, snap into the right base mode
  useEffect(() => {
    setVs((s) => ({
      ...s,
      mode: vimMode ? "normal" : "insert",
      anchor: null,
      cmd: "",
      iseq: "",
      count: "",
      pending: "",
    }));
  }, [vimMode]);

  // focus the surface on mount + when asked to refocus (e.g. settings panel closed)
  useEffect(() => {
    hostRef.current?.focus();
  }, [note.id, refocusToken]);

  // report meta + working text upward, and flush any save/quit action
  useEffect(() => {
    const t = V.text(vs);
    onMeta?.({
      mode: vs.mode,
      row: vs.row,
      col: vs.col,
      words: V.wordCount(vs),
      lines: vs.lines.length,
      dirty: t !== savedText,
      cmd: vs.cmd,
      message: vs.message,
      cmdActive: vs.mode === "command" || vs.mode === "search",
      prompt: vs.mode === "search" ? "/" : ":",
    });
    onText?.(note.id, t);
    const pa = pendingAction.current;
    if (pa) {
      pendingAction.current = null;
      if (pa.action === "save" || pa.action === "savequit") onSaveText?.(note.id, pa.text);
      if (pa.action === "quit" || pa.action === "savequit") onQuit?.(note.id);
      if (pa.action === "settings") onOpenSettings?.();
      if (pa.action === "config") onOpenConfig?.();
      if (pa.action === "nav") onToggleNav?.();
      if (pa.action === "find") onOpenFinder?.("files");
      if (pa.action === "grep") onOpenFinder?.("content");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vs]);

  // keep cursor line in view (no scrollIntoView)
  useEffect(() => {
    const sc = scrollerRef.current,
      col = colRef.current;
    if (!sc || !col) return;
    const el = col.children[vs.row] as HTMLElement | undefined;
    if (!el) return;
    const pad = 48;
    const top = el.offsetTop,
      bottom = top + el.offsetHeight;
    if (top < sc.scrollTop + pad) sc.scrollTop = Math.max(0, top - pad);
    else if (bottom > sc.scrollTop + sc.clientHeight - pad)
      sc.scrollTop = bottom - sc.clientHeight + pad;
  }, [vs.row, vs.col]);

  const pokeHud = useCallback(() => {
    if (hud === "off") return;
    setHudOn(true);
    if (hudTimer.current) clearTimeout(hudTimer.current);
    hudTimer.current = setTimeout(() => setHudOn(false), 1300);
  }, [hud]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        onSaveText?.(note.id, V.text(vsRef.current));
        return;
      }
      if (e.metaKey || e.ctrlKey) return; // let other browser/system shortcuts through
      e.preventDefault();
      const mods = { ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey };
      setVs((prev) => {
        const { state, action } = V.handleKey(prev, e.key, mods, { escMap, vimMode });
        if (action) pendingAction.current = { action, text: V.text(state) };
        return state;
      });
      pokeHud();
    },
    [pokeHud, escMap, vimMode, note.id, onSaveText],
  );

  const sel = vs.mode === "visual" ? V.selRange(vs) : null;
  const text = V.text(vs);
  const dirty = text !== savedText;
  const percent =
    vs.lines.length <= 1 ? "All" : Math.round((vs.row / (vs.lines.length - 1)) * 100) + "%";
  const cmdActive = vs.mode === "command" || vs.mode === "search";
  const prompt = vs.mode === "search" ? "/" : ":";
  const modeKey = vs.mode;
  const hasKeys = vs.keylog.length > 0;
  const showHud =
    hud === "always" || (hud === "auto" && hudOn && (hasKeys || !!vs.pending || !!vs.count));

  return (
    <div
      className={
        "av-editor cs-" + (cursorStyle || "block") + (cursorBlink === false ? " no-blink" : "")
      }
      ref={hostRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseDown={() => hostRef.current?.focus()}
    >
      <div className="av-scroller" ref={scrollerRef}>
        <div className="av-page">
          <div className="av-gutter" aria-hidden="true">
            {vs.lines.map((_, i) => {
              const cur = i === vs.row;
              const num = relativeNumbers ? (cur ? i + 1 : Math.abs(i - vs.row)) : i + 1;
              return (
                <div key={i} className={"av-ln" + (cur ? " is-cur" : "")}>
                  {num}
                </div>
              );
            })}
          </div>
          <div className="av-col" ref={colRef}>
            {vs.lines.map((ln, i) => (
              <LineView key={i} text={ln} rowIdx={i} vs={vs} sel={sel} />
            ))}
          </div>
        </div>
      </div>

      {showHud && (
        <div className="av-hud" aria-hidden="true">
          {vs.keylog.slice(-6).map((k, i, arr) => {
            const pend = (vs.pending || vs.count) && i === arr.length - 1;
            return (
              <span key={i} className={"av-key" + (pend ? " is-pending" : "")}>
                {k}
              </span>
            );
          })}
          {!hasKeys && !vs.pending && !vs.count ? (
            <span className="av-key av-key-rest">·</span>
          ) : null}
        </div>
      )}

      <div className={"av-cmdline" + (cmdActive ? " is-active" : "")}>
        {cmdActive ? (
          <span className="av-cmd">
            <span className="av-prompt">{prompt}</span>
            {vs.cmd}
            <i className="av-caret" />
          </span>
        ) : vs.message ? (
          <span className="av-msg">{vs.message}</span>
        ) : (
          <span className="av-hint">
            {vimMode ? (
              <>
                — press <b>:</b> for commands · <b>/</b> to search · <b>i</b> to write —
              </>
            ) : (
              <>
                — plain text · <b>⌘S</b> to save · arrows to move —
              </>
            )}
          </span>
        )}
      </div>

      <div className="av-status">
        <div className={"av-mode " + (vimMode ? "mode-" + modeKey : "mode-text")}>
          {vimMode ? MODE_LABEL[modeKey] : "TEXT"}
        </div>
        <div className="av-file">
          {note.title}
          {ext && <span className="av-ext">{ext}</span>}
          {dirty && (
            <span className="av-dirty" title="unsaved">
              [+]
            </span>
          )}
        </div>
        <div className="av-spacer" />
        <div className="av-stat">{V.wordCount(vs)} words</div>
        <div className="av-stat">
          {vs.row + 1}:{vs.col + 1}
        </div>
        <div className="av-stat av-pct">{percent}</div>
      </div>
    </div>
  );
}
