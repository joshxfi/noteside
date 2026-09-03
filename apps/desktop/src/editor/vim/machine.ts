// vim/machine.ts — the PURE vim key state machine: keys in, intents out. No
// ProseMirror, no DOM, no timers — exhaustively node-testable (machine.test.ts).
// The subset is deliberate (see AGENTS.md): navigation, operators + motions +
// text objects, one unnamed register, `.` over the last change — no named
// registers, macros, or marks (anything needing recording plumbing is out).
export type VimMode = "normal" | "insert" | "visual";
export type VisualKind = "char" | "line";
export type Operator = "d" | "c" | "y" | ">" | "<";
export type SeekCmd = "f" | "t" | "F" | "T";
/** Text-object kinds: word, paragraph (linewise), quotes, bracket pairs. */
export type TextObject = "w" | "p" | '"' | "'" | "`" | "(" | "[" | "{" | "<";

export type Motion =
  | { t: "char"; dir: 1 | -1 } // h l (line-confined)
  | { t: "line"; dir: 1 | -1 } // j k (visual-vertical, injected in exec)
  | { t: "word"; which: "w" | "b" | "e" }
  | { t: "lineStart" } // 0
  | { t: "lineFirstNonBlank" } // ^
  | { t: "lineEnd" } // $
  | { t: "docStart" } // gg
  | { t: "docEnd" } // G
  | { t: "blockJump"; n: number } // N G / N gg — the Nth top-level block
  | { t: "para"; dir: 1 | -1 } // { }
  | { t: "seek"; cmd: SeekCmd; ch: string }
  | { t: "matchPair" } // %
  | { t: "object"; obj: TextObject; around: boolean }; // iw aw i" a( …

export type InsertWhere = "before" | "after" | "lineStart" | "lineEnd" | "below" | "above";

export type Intent =
  | { kind: "mode"; to: VimMode; visual?: VisualKind }
  | { kind: "move"; motion: Motion; count: number }
  | { kind: "operate"; op: Operator; motion: Motion; count: number } // dw ce y$ >} d3j …
  | { kind: "operateLines"; op: Operator; count: number } // dd cc yy >> << (S Y)
  | { kind: "operateSelection"; op: Operator } // visual d c y > <
  | { kind: "deleteChar"; count: number; before: boolean } // x X
  | { kind: "paste"; before: boolean; count: number } // p P
  | { kind: "pasteSelection" } // visual p
  | { kind: "replaceChar"; ch: string; count: number } // r<ch>
  | { kind: "caseChange"; to: "toggle" | "upper" | "lower"; count: number; selection: boolean } // ~ (visual u U)
  | { kind: "join"; count: number; selection: boolean } // J
  | { kind: "insert"; where: InsertWhere }
  | { kind: "visualSwap" } // visual o
  | { kind: "undo" }
  | { kind: "redo" }
  | { kind: "scroll"; dir: 1 | -1; page: "half" | "full" } // Ctrl-d/u/f/b (macOS only — index gates)
  | { kind: "scrollCaret"; where: "center" | "top" | "bottom" } // zz zt zb
  | { kind: "searchWord"; dir: 1 | -1 } // * #
  | { kind: "findNext" } // n
  | { kind: "findPrev" } // N
  | { kind: "repeat"; count: number } // .
  | { kind: "app"; hook: "palette" | "exBar" | "findBar" | "follow" };

export interface VimState {
  mode: VimMode;
  /** Which visual flavor is active while mode === "visual". */
  visual: VisualKind;
  /** Count accumulator; 0 = none. Capped at 999. */
  count: number;
  /** Operator waiting for its motion, with the count typed BEFORE it (2d3w = 6). */
  op: { op: Operator; count: number } | null;
  /** g / z prefix waiting for its second key. */
  prefix: "g" | "z" | null;
  /** Seek command waiting for its target character. */
  awaitSeek: SeekCmd | null;
  /** r waiting for its replacement character. */
  awaitReplace: boolean;
  /** i / a after an operator (or in visual) waiting for the object kind. */
  awaitObject: "i" | "a" | null;
  /** Last completed seek, for ; and , */
  lastSeek: { cmd: SeekCmd; ch: string } | null;
}

export const initialVimState: VimState = {
  mode: "normal",
  visual: "char",
  count: 0,
  op: null,
  prefix: null,
  awaitSeek: null,
  awaitReplace: false,
  awaitObject: null,
  lastSeek: null,
};

export interface KeyInput {
  key: string; // DOM event.key
  ctrl: boolean;
  shift: boolean;
  /** Ctrl-d/u/f/b scrolling is offered only where Ctrl is NOT the chord modifier. */
  allowCtrlScroll: boolean;
}

export interface FeedResult {
  state: VimState;
  intents: Intent[];
  /** true = the key was consumed (preventDefault + stop). Bare printables are
   *  ALWAYS consumed in normal/visual — nothing may type. */
  handled: boolean;
}

const SEEK_REVERSE: Record<SeekCmd, SeekCmd> = { f: "F", t: "T", F: "f", T: "t" };

const OBJECT_KEYS: Record<string, TextObject> = {
  w: "w",
  W: "w",
  p: "p",
  '"': '"',
  "'": "'",
  "`": "`",
  "(": "(",
  ")": "(",
  b: "(",
  "[": "[",
  "]": "[",
  "{": "{",
  "}": "{",
  B: "{",
  "<": "<",
  ">": "<",
};

const isSeek = (k: string): k is SeekCmd => k === "f" || k === "t" || k === "F" || k === "T";

/** Everything pending cleared; mode/visual/lastSeek kept. */
const clearPending = (s: VimState): VimState => ({
  ...s,
  count: 0,
  op: null,
  prefix: null,
  awaitSeek: null,
  awaitReplace: false,
  awaitObject: null,
});

/** The showcmd string for a pending sequence ("2d", "d3", "f", "ci", "g"). */
export function pendingLabel(s: VimState): string {
  let l = "";
  if (s.op) l += (s.op.count || "") + s.op.op;
  if (s.count) l += s.count;
  if (s.prefix) l += s.prefix;
  if (s.awaitSeek) l += s.awaitSeek;
  if (s.awaitReplace) l += "r";
  if (s.awaitObject) l += s.awaitObject;
  return l;
}

/** A change for `.` purposes: anything that edits the document. */
export function isChangeIntent(i: Intent): boolean {
  switch (i.kind) {
    case "operate":
    case "operateLines":
      return i.op !== "y";
    case "deleteChar":
    case "paste":
    case "replaceChar":
    case "caseChange":
    case "join":
    case "insert":
      return true;
    default:
      return false;
  }
}

/** Re-count an intent for `N.` (only kinds that carry a count change). */
export function withCount(i: Intent, count: number): Intent {
  switch (i.kind) {
    case "operate":
    case "operateLines":
    case "deleteChar":
    case "paste":
    case "replaceChar":
    case "caseChange":
    case "join":
      return { ...i, count };
    default:
      return i;
  }
}

/** One key in normal or visual mode. (Insert mode never reaches the machine —
 *  the extension handles only Esc/escMap there.) */
export function feedKey(s: VimState, input: KeyInput): FeedResult {
  const { ctrl } = input;
  const key = ctrl && input.key === "[" ? "Escape" : input.key;
  const visual = s.mode === "visual";
  const out = (intents: Intent[], state: VimState = clearPending(s)): FeedResult => ({
    state,
    intents,
    handled: true,
  });
  const hold = (patch: Partial<VimState>): FeedResult => ({
    state: { ...s, ...patch },
    intents: [],
    handled: true,
  });
  const hasCount = s.count > 0 || (s.op?.count ?? 0) > 0;
  const total = () => Math.max(1, s.count) * Math.max(1, s.op?.count ?? 0);
  /** A motion resolved: operator-pending → operate; else a (visual-extending) move. */
  const toNormal: Intent = { kind: "mode", to: "normal" };
  const toInsert: Intent = { kind: "mode", to: "insert" };
  const motion = (m: Motion, count = total()): FeedResult => {
    if (s.op) {
      const op: Intent = { kind: "operate", op: s.op.op, motion: m, count };
      return out(s.op.op === "c" ? [op, toInsert] : [op]);
    }
    return out([{ kind: "move", motion: m, count }]);
  };

  // ctrl combos: vim owns exactly these; everything else passes through
  if (ctrl && key !== "Escape") {
    if (key === "r") return out([{ kind: "redo" }]);
    if (key === "d" || key === "u" || key === "f" || key === "b") {
      if (!input.allowCtrlScroll) return out([]);
      const dir = key === "d" || key === "f" ? 1 : -1;
      return out([{ kind: "scroll", dir, page: key === "d" || key === "u" ? "half" : "full" }]);
    }
    if (key === "n" || key === "p" || key === "v") return out([]); // reserved — never paste/find/blockwise
    return { state: s, intents: [], handled: false };
  }

  if (key === "Escape") {
    if (visual) return out([toNormal]);
    return out([]);
  }

  // a pending f/t/F/T consumes the NEXT printable as its target
  if (s.awaitSeek) {
    if (key.length !== 1) return out([]); // arrows / anything else cancels the seek
    const cmd = s.awaitSeek;
    const r = motion({ t: "seek", cmd, ch: key });
    return { ...r, state: { ...r.state, lastSeek: { cmd, ch: key } } };
  }

  // r waits for its replacement character
  if (s.awaitReplace) {
    if (key.length !== 1) return out([]);
    return out([{ kind: "replaceChar", ch: key, count: total() }]);
  }

  // i/a after an operator (or in visual) waits for the object kind
  if (s.awaitObject) {
    const obj = OBJECT_KEYS[key];
    if (!obj) return out([]);
    return motion({ t: "object", obj, around: s.awaitObject === "a" }, 1);
  }

  // count digits ("0" only continues an existing count — bare 0 is a motion)
  if (/^[0-9]$/.test(key) && (key !== "0" || s.count > 0)) {
    return hold({ count: Math.min(999, s.count * 10 + Number(key)) });
  }

  if (s.prefix === "g") {
    if (key === "g") {
      return hasCount ? motion({ t: "blockJump", n: total() }, 1) : motion({ t: "docStart" }, 1);
    }
    if (key === "x" && !s.op) return out([{ kind: "app", hook: "follow" }]);
    return out([]);
  }
  if (s.prefix === "z") {
    if (key === "z") return out([{ kind: "scrollCaret", where: "center" }]);
    if (key === "t") return out([{ kind: "scrollCaret", where: "top" }]);
    if (key === "b") return out([{ kind: "scrollCaret", where: "bottom" }]);
    return out([]);
  }

  // operator second keys that aren't motions
  if (s.op) {
    if (key === s.op.op) {
      const lines: Intent = { kind: "operateLines", op: s.op.op, count: total() };
      return out(s.op.op === "c" ? [lines, toInsert] : [lines]);
    }
    if (key === "i" || key === "a") return hold({ awaitObject: key });
  } else if (visual && (key === "i" || key === "a")) {
    return hold({ awaitObject: key });
  }

  // ── motions (shared by normal, visual, and operator-pending) ──────────
  switch (key) {
    case "h":
    case "Backspace":
      return motion({ t: "char", dir: -1 });
    case "l":
      return motion({ t: "char", dir: 1 });
    case " ":
      if (visual || s.op) return motion({ t: "char", dir: 1 });
      break;
    case "j":
    case "Enter":
      return motion({ t: "line", dir: 1 });
    case "k":
      return motion({ t: "line", dir: -1 });
    case "w":
      return motion({ t: "word", which: "w" });
    case "b":
      return motion({ t: "word", which: "b" });
    case "e":
      return motion({ t: "word", which: "e" });
    case "0":
      return motion({ t: "lineStart" }, 1);
    case "^":
      return motion({ t: "lineFirstNonBlank" }, 1);
    case "$":
      return motion({ t: "lineEnd" }, 1);
    case "{":
      return motion({ t: "para", dir: -1 });
    case "}":
      return motion({ t: "para", dir: 1 });
    case "G":
      return hasCount ? motion({ t: "blockJump", n: total() }, 1) : motion({ t: "docEnd" }, 1);
    case "%":
      return motion({ t: "matchPair" }, 1);
    case ";":
      return s.lastSeek ? motion({ t: "seek", ...s.lastSeek }) : out([]);
    case ",":
      return s.lastSeek
        ? motion({ t: "seek", cmd: SEEK_REVERSE[s.lastSeek.cmd], ch: s.lastSeek.ch })
        : out([]);
    case "g":
      return hold({ prefix: "g" });
  }
  if (isSeek(key)) return hold({ awaitSeek: key });

  // anything else after an operator: swallow and reset (vim beeps)
  if (s.op) {
    if (key.length > 1 && key !== "Tab")
      return { state: clearPending(s), intents: [], handled: false };
    return out([]);
  }

  const count = total();
  switch (key) {
    // ── operators ───────────────────────────────────────────
    case "d":
    case "c":
    case "y":
    case ">":
    case "<":
      if (visual) {
        const ops: Intent[] = [{ kind: "operateSelection", op: key }];
        ops.push(key === "c" ? toInsert : toNormal);
        return out(ops);
      }
      return {
        state: { ...clearPending(s), op: { op: key, count: s.count } },
        intents: [],
        handled: true,
      };
    case "D":
      if (visual) return out([{ kind: "operateSelection", op: "d" }, toNormal]);
      return out([{ kind: "operate", op: "d", motion: { t: "lineEnd" }, count: 1 }]);
    case "C":
      if (visual) return out([{ kind: "operateSelection", op: "c" }, toInsert]);
      return out([{ kind: "operate", op: "c", motion: { t: "lineEnd" }, count: 1 }, toInsert]);
    case "S":
      if (visual) return out([{ kind: "operateSelection", op: "c" }, toInsert]);
      return out([{ kind: "operateLines", op: "c", count }, toInsert]);
    case "Y":
      if (visual) return out([{ kind: "operateSelection", op: "y" }, toNormal]);
      return out([{ kind: "operateLines", op: "y", count }]);
    case "s":
      if (visual) return out([{ kind: "operateSelection", op: "c" }, toInsert]);
      return out([{ kind: "operate", op: "c", motion: { t: "char", dir: 1 }, count }, toInsert]);
    case "x":
    case "Delete":
      if (visual) return out([{ kind: "operateSelection", op: "d" }, toNormal]);
      return out([{ kind: "deleteChar", count, before: false }]);
    case "X":
      if (visual) return out([{ kind: "operateSelection", op: "d" }, toNormal]);
      return out([{ kind: "deleteChar", count, before: true }]);
    case "p":
    case "P":
      if (visual) return out([{ kind: "pasteSelection" }, toNormal]);
      return out([{ kind: "paste", before: key === "P", count }]);
    case "r":
      if (visual) return out([]);
      return hold({ awaitReplace: true });
    case "~":
      if (visual)
        return out([{ kind: "caseChange", to: "toggle", count: 1, selection: true }, toNormal]);
      return out([{ kind: "caseChange", to: "toggle", count, selection: false }]);
    case "u":
      if (visual)
        return out([{ kind: "caseChange", to: "lower", count: 1, selection: true }, toNormal]);
      return out([{ kind: "undo" }]);
    case "U":
      if (visual)
        return out([{ kind: "caseChange", to: "upper", count: 1, selection: true }, toNormal]);
      return out([]);
    case "J":
      if (visual) return out([{ kind: "join", count: 1, selection: true }, toNormal]);
      return out([{ kind: "join", count, selection: false }]);
    case ".":
      if (visual) return out([]);
      return out([{ kind: "repeat", count: s.count }]);
    // ── mode changes ────────────────────────────────────────
    case "i":
      return out([{ kind: "insert", where: "before" }, toInsert]);
    case "a":
      return out([{ kind: "insert", where: "after" }, toInsert]);
    case "I":
      if (visual) return out([]);
      return out([{ kind: "insert", where: "lineStart" }, toInsert]);
    case "A":
      if (visual) return out([]);
      return out([{ kind: "insert", where: "lineEnd" }, toInsert]);
    case "o":
      if (visual) return out([{ kind: "visualSwap" }]);
      return out([{ kind: "insert", where: "below" }, toInsert]);
    case "O":
      if (visual) return out([{ kind: "visualSwap" }]);
      return out([{ kind: "insert", where: "above" }, toInsert]);
    case "v":
    case "V": {
      const want: VisualKind = key === "v" ? "char" : "line";
      if (visual)
        return out(s.visual === want ? [toNormal] : [{ kind: "mode", to: "visual", visual: want }]);
      return out([{ kind: "mode", to: "visual", visual: want }]);
    }
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
    case "z":
      return hold({ prefix: "z" });
    // ── app hooks ───────────────────────────────────────────
    case ":":
      return out([{ kind: "app", hook: "exBar" }]);
    case " ":
      if (s.count === 0) return out([{ kind: "app", hook: "palette" }]);
      return out([]);
  }

  // arrows, Home/End, PageUp/Down pass through to the editor
  if (key.length > 1) {
    if (key === "Tab") return out([]); // swallowed: focus never Tabs out
    return { state: clearPending(s), intents: [], handled: false };
  }

  // any other bare printable is a no-op, but still swallowed
  return out([]);
}
