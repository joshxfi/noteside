// vim/machine.ts — the PURE vim key state machine: keys in, intents out. No
// ProseMirror, no DOM, no timers — exhaustively node-testable (machine.test.ts).
// The subset is deliberate (see AGENTS.md): navigation + line-editing, one
// unnamed register, no recording/marks/repeat — anything needing those is out.
export type VimMode = "normal" | "insert" | "visual";

export type Motion =
  | { t: "char"; dir: 1 | -1 } // h l
  | { t: "line"; dir: 1 | -1 } // j k (visual-vertical, injected in exec)
  | { t: "word"; which: "w" | "b" | "e" }
  | { t: "lineStart" } // 0
  | { t: "lineFirstNonBlank" } // ^
  | { t: "lineEnd" } // $
  | { t: "docStart" } // gg
  | { t: "docEnd" } // G
  | { t: "blockJump"; n: number } // N G / N gg — the Nth top-level block
  | { t: "para"; dir: 1 | -1 } // { }
  | { t: "seek"; cmd: "f" | "t" | "F" | "T"; ch: string };

export type Intent =
  | { kind: "mode"; to: VimMode }
  | { kind: "move"; motion: Motion; count: number; extend: boolean }
  | { kind: "deleteLines"; count: number } // dd (line-unit)
  | { kind: "yankLines"; count: number } // yy / Y
  | { kind: "deleteMotion"; motion: Motion } // dw db de d$ d0
  | { kind: "deleteChar"; count: number } // x
  | { kind: "deleteSelection" } // visual d/x
  | { kind: "yankSelection" } // visual y
  | { kind: "pasteSelection" } // visual p
  | { kind: "paste"; before: boolean; count: number } // p P
  | { kind: "insert"; where: "before" | "after" | "lineStart" | "lineEnd" | "below" | "above" }
  | { kind: "undo" }
  | { kind: "redo" }
  | { kind: "scroll"; dir: 1 | -1 } // Ctrl-d / Ctrl-u (macOS only — index gates)
  | { kind: "searchWord"; dir: 1 | -1 } // * #
  | { kind: "findNext" } // n
  | { kind: "findPrev" } // N
  | { kind: "app"; hook: "palette" | "exBar" | "findBar" | "follow" };

export interface VimState {
  mode: VimMode;
  /** Count accumulator; 0 = none. Capped at 999. */
  count: number;
  /** Operator / prefix waiting for its second key. */
  pending: "d" | "y" | "g" | null;
  /** Seek command waiting for its target character. */
  awaitSeek: "f" | "t" | "F" | "T" | null;
  /** Last completed seek, for ; and , */
  lastSeek: { cmd: "f" | "t" | "F" | "T"; ch: string } | null;
}

export const initialVimState: VimState = {
  mode: "normal",
  count: 0,
  pending: null,
  awaitSeek: null,
  lastSeek: null,
};

export interface KeyInput {
  key: string; // DOM event.key
  ctrl: boolean;
  shift: boolean;
  /** Ctrl-d/u scrolling is offered only where Ctrl is NOT the chord modifier. */
  allowCtrlScroll: boolean;
}

export interface FeedResult {
  state: VimState;
  intents: Intent[];
  /** true = the key was consumed (preventDefault + stop). Bare printables are
   *  ALWAYS consumed in normal/visual — nothing may type. */
  handled: boolean;
}

const SEEK_REVERSE: Record<string, "f" | "t" | "F" | "T"> = { f: "F", t: "T", F: "f", T: "t" };

const reset = (s: VimState): VimState => ({ ...s, count: 0, pending: null, awaitSeek: null });

/** One key in normal or visual mode. (Insert mode never reaches the machine —
 *  the extension handles only Esc/escMap there.) */
export function feedKey(s: VimState, input: KeyInput): FeedResult {
  const { key, ctrl } = input;
  const visual = s.mode === "visual";
  const out = (intents: Intent[], state: VimState = reset(s)): FeedResult => ({
    state,
    intents,
    handled: true,
  });
  const move = (motion: Motion, count = Math.max(1, s.count)): FeedResult =>
    out([{ kind: "move", motion, count, extend: visual }]);

  // ctrl combos: vim owns exactly these; everything else passes through
  if (ctrl) {
    if (key === "r") return out([{ kind: "redo" }]);
    if (key === "d") return input.allowCtrlScroll ? out([{ kind: "scroll", dir: 1 }]) : out([]);
    if (key === "u") return input.allowCtrlScroll ? out([{ kind: "scroll", dir: -1 }]) : out([]);
    if (key === "n" || key === "p") return out([]); // reserved — never paste/find
    return { state: s, intents: [], handled: false };
  }

  // a pending f/t/F/T consumes the NEXT printable as its target
  if (s.awaitSeek) {
    if (key.length === 1) {
      const cmd = s.awaitSeek;
      const motion: Motion = { t: "seek", cmd, ch: key };
      const count = Math.max(1, s.count);
      return {
        state: { ...reset(s), lastSeek: { cmd, ch: key } },
        intents: [{ kind: "move", motion, count, extend: visual }],
        handled: true,
      };
    }
    return out([]); // Esc / arrows / anything else cancels the seek
  }

  if (key === "Escape") {
    if (visual) return out([{ kind: "mode", to: "normal" }]);
    return out([]);
  }

  // count digits ("0" only continues an existing count — bare 0 is a motion)
  if (/^[0-9]$/.test(key) && (key !== "0" || s.count > 0)) {
    return {
      state: { ...s, count: Math.min(999, s.count * 10 + Number(key)) },
      intents: [],
      handled: true,
    };
  }

  // operator second keys
  if (s.pending === "d") {
    if (key === "d") return out([{ kind: "deleteLines", count: Math.max(1, s.count) }]);
    if (key === "w") return out([{ kind: "deleteMotion", motion: { t: "word", which: "w" } }]);
    if (key === "b") return out([{ kind: "deleteMotion", motion: { t: "word", which: "b" } }]);
    if (key === "e") return out([{ kind: "deleteMotion", motion: { t: "word", which: "e" } }]);
    if (key === "$") return out([{ kind: "deleteMotion", motion: { t: "lineEnd" } }]);
    if (key === "0") return out([{ kind: "deleteMotion", motion: { t: "lineStart" } }]);
    return out([]); // unknown motion — swallow, reset
  }
  if (s.pending === "y") {
    if (key === "y") return out([{ kind: "yankLines", count: Math.max(1, s.count) }]);
    return out([]);
  }
  if (s.pending === "g") {
    if (key === "g") {
      return s.count > 0 ? move({ t: "blockJump", n: s.count }) : move({ t: "docStart" }, 1);
    }
    if (key === "x") return out([{ kind: "app", hook: "follow" }]);
    return out([]);
  }

  switch (key) {
    // ── motions ─────────────────────────────────────────────
    case "h":
      return move({ t: "char", dir: -1 });
    case "l":
      return move({ t: "char", dir: 1 });
    case "j":
      return move({ t: "line", dir: 1 });
    case "k":
      return move({ t: "line", dir: -1 });
    case "w":
      return move({ t: "word", which: "w" });
    case "b":
      return move({ t: "word", which: "b" });
    case "e":
      return move({ t: "word", which: "e" });
    case "0":
      return move({ t: "lineStart" }, 1);
    case "^":
      return move({ t: "lineFirstNonBlank" }, 1);
    case "$":
      return move({ t: "lineEnd" }, 1);
    case "{":
      return move({ t: "para", dir: -1 });
    case "}":
      return move({ t: "para", dir: 1 });
    case "G":
      return s.count > 0 ? move({ t: "blockJump", n: s.count }, 1) : move({ t: "docEnd" }, 1);
    // ── seeks ───────────────────────────────────────────────
    case "f":
    case "t":
    case "F":
    case "T":
      return { state: { ...s, awaitSeek: key }, intents: [], handled: true };
    case ";":
      return s.lastSeek ? move({ t: "seek", ...s.lastSeek }) : out([]);
    case ",":
      return s.lastSeek
        ? move({ t: "seek", cmd: SEEK_REVERSE[s.lastSeek.cmd], ch: s.lastSeek.ch })
        : out([]);
    // ── operators / edits ───────────────────────────────────
    case "d":
      if (visual) return out([{ kind: "deleteSelection" }, { kind: "mode", to: "normal" }]);
      return { state: { ...s, pending: "d" }, intents: [], handled: true };
    case "y":
      if (visual) return out([{ kind: "yankSelection" }, { kind: "mode", to: "normal" }]);
      return { state: { ...s, pending: "y" }, intents: [], handled: true };
    case "Y":
      return out([{ kind: "yankLines", count: Math.max(1, s.count) }]);
    case "D":
      return out([{ kind: "deleteMotion", motion: { t: "lineEnd" } }]);
    case "x":
      if (visual) return out([{ kind: "deleteSelection" }, { kind: "mode", to: "normal" }]);
      return out([{ kind: "deleteChar", count: Math.max(1, s.count) }]);
    case "p":
      if (visual) return out([{ kind: "pasteSelection" }, { kind: "mode", to: "normal" }]);
      return out([{ kind: "paste", before: false, count: Math.max(1, s.count) }]);
    case "P":
      return out([{ kind: "paste", before: true, count: Math.max(1, s.count) }]);
    case "u":
      return out([{ kind: "undo" }]);
    case "r":
      return out([]); // replace mode is out of the v1 subset — swallow
    // ── mode changes ────────────────────────────────────────
    case "i":
      return out([
        { kind: "insert", where: "before" },
        { kind: "mode", to: "insert" },
      ]);
    case "a":
      return out([
        { kind: "insert", where: "after" },
        { kind: "mode", to: "insert" },
      ]);
    case "I":
      return out([
        { kind: "insert", where: "lineStart" },
        { kind: "mode", to: "insert" },
      ]);
    case "A":
      return out([
        { kind: "insert", where: "lineEnd" },
        { kind: "mode", to: "insert" },
      ]);
    case "o":
      return out([
        { kind: "insert", where: "below" },
        { kind: "mode", to: "insert" },
      ]);
    case "O":
      return out([
        { kind: "insert", where: "above" },
        { kind: "mode", to: "insert" },
      ]);
    case "v":
    case "V":
      // visual-line only in v1 — v aliases V; in visual either exits
      return out([{ kind: "mode", to: visual ? "normal" : "visual" }]);
    // ── search / scroll ─────────────────────────────────────
    case "/":
      return out([{ kind: "app", hook: "findBar" }]);
    case "n":
      return out([{ kind: "findNext" }]);
    case "N":
      return out([{ kind: "findPrev" }]);
    case "*":
      return out([{ kind: "searchWord", dir: 1 }]);
    case "#":
      return out([{ kind: "searchWord", dir: -1 }]);
    // ── app hooks ───────────────────────────────────────────
    case ":":
      return out([{ kind: "app", hook: "exBar" }]);
    case " ":
      if (s.count === 0 && !s.pending) return out([{ kind: "app", hook: "palette" }]);
      return out([]);
    case "g":
      return { state: { ...s, pending: "g" }, intents: [], handled: true };
  }

  // arrows, Home/End, PageUp/Down, Enter, Backspace pass through to the editor
  if (key.length > 1 && key !== "Escape") {
    if (key === "Tab") return out([]); // swallowed: focus never Tabs out
    return { state: s, intents: [], handled: false };
  }

  // any other bare printable is a no-op, but still swallowed
  return out([]);
}
