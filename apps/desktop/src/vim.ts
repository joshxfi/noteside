// vim.ts — a small, honest subset of vim.
// Pure-ish reducer: handleKey(state, key, mods) -> { state, action }
// state is treated as immutable from the caller's side (we clone at entry).
//
// Ported from the design prototype's avenr-vim.jsx, with types added and the
// behaviour kept byte-for-byte identical. When the Rust backend lands, the
// document model stays here; only persistence/search cross the IPC seam.

import type { HandleOpts, KeyMods, SelRange, VimAction, VimState } from "./types";

// ---- helpers ---------------------------------------------------------
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function charClass(c: string | undefined): number {
  if (c == null || /\s/.test(c)) return 0;
  return /[A-Za-z0-9_]/.test(c) ? 1 : 2;
}

function firstNonBlank(line: string): number {
  const i = line.search(/\S/);
  return i < 0 ? 0 : i;
}

function nextWordStart(lines: string[], row: number, col: number) {
  let r = row,
    c = col;
  const ln = () => lines[r] || "";
  const startCls = charClass(ln()[c]);
  if (startCls !== 0) {
    while (c < ln().length && charClass(ln()[c]) === startCls) c++;
  }
  // skip whitespace, crossing lines
  while (true) {
    if (c >= ln().length) {
      if (r < lines.length - 1) {
        r++;
        c = 0;
        if (ln().length === 0) return { row: r, col: 0 };
      } else {
        return { row: r, col: Math.max(0, ln().length - 1) };
      }
    } else if (charClass(ln()[c]) === 0) {
      c++;
    } else break;
  }
  return { row: r, col: c };
}

function prevWordStart(lines: string[], row: number, col: number) {
  let r = row,
    c = col;
  const len = (rr: number) => (lines[rr] || "").length;
  // step back one position
  if (c > 0) c--;
  else if (r > 0) {
    r--;
    c = Math.max(0, len(r) - 1);
  } else return { row: 0, col: 0 };
  // skip whitespace backward
  while (charClass((lines[r] || "")[c]) === 0) {
    if (c > 0) c--;
    else if (r > 0) {
      r--;
      c = Math.max(0, len(r) - 1);
      if (len(r) === 0) return { row: r, col: 0 };
    } else return { row: 0, col: 0 };
  }
  const cls = charClass((lines[r] || "")[c]);
  while (c > 0 && charClass((lines[r] || "")[c - 1]) === cls) c--;
  return { row: r, col: c };
}

function endOfWord(lines: string[], row: number, col: number) {
  let r = row,
    c = col;
  const ln = () => lines[r] || "";
  c++;
  while (true) {
    if (c >= ln().length) {
      if (r < lines.length - 1) {
        r++;
        c = 0;
      } else return { row: r, col: Math.max(0, ln().length - 1) };
    } else if (charClass(ln()[c]) === 0) {
      c++;
    } else break;
  }
  const cls = charClass(ln()[c]);
  while (c + 1 < ln().length && charClass(ln()[c + 1]) === cls) c++;
  return { row: r, col: c };
}

// ---- state ----------------------------------------------------------
export function initVim(text: string): VimState {
  const lines = String(text).split("\n");
  return {
    lines: lines.length ? lines : [""],
    row: 0,
    col: 0,
    desired: 0,
    mode: "normal",
    pending: "", // 'g' | 'd' | 'r'
    count: "",
    cmd: "", // command/search line buffer
    lastSearch: "",
    anchor: null, // visual anchor {row,col}
    register: { text: "", linewise: false },
    history: [],
    redo: [],
    message: "",
    keylog: [],
    iseq: "", // contiguous chars typed in insert (for jj-style escape)
  };
}

const lineLen = (s: VimState, r: number = s.row) => (s.lines[r] || "").length;
// max column the cursor may rest ON in normal mode
const normMax = (s: VimState, r: number = s.row) => Math.max(0, lineLen(s, r) - 1);

function snapshot(s: VimState) {
  s.history.push({ lines: s.lines.slice(), row: s.row, col: s.col });
  if (s.history.length > 300) s.history.shift();
  s.redo = [];
}

function setMessage(s: VimState, m: string) {
  s.message = m;
}

// ---- motions (shared by normal + visual) ----------------------------
// returns true if it handled the key as a motion
function applyMotion(s: VimState, key: string, n: number): boolean {
  switch (key) {
    case "ArrowLeft":
    case "h":
      s.col = clamp(s.col - n, 0, normMax(s));
      s.desired = s.col;
      return true;
    case "ArrowRight":
    case "l":
      s.col = clamp(s.col + n, 0, s.mode === "visual" ? lineLen(s) : normMax(s));
      s.desired = s.col;
      return true;
    case " ":
      s.col = clamp(s.col + n, 0, normMax(s));
      s.desired = s.col;
      return true;
    case "ArrowDown":
    case "j": {
      s.row = clamp(s.row + n, 0, s.lines.length - 1);
      s.col = clamp(s.desired, 0, s.mode === "visual" ? lineLen(s) : normMax(s));
      return true;
    }
    case "ArrowUp":
    case "k": {
      s.row = clamp(s.row - n, 0, s.lines.length - 1);
      s.col = clamp(s.desired, 0, s.mode === "visual" ? lineLen(s) : normMax(s));
      return true;
    }
    case "0":
      s.col = 0;
      s.desired = 0;
      return true;
    case "^":
      s.col = firstNonBlank(s.lines[s.row] || "");
      s.desired = s.col;
      return true;
    case "$":
      s.col = s.mode === "visual" ? lineLen(s) : normMax(s);
      s.desired = 9999;
      return true;
    case "w": {
      let p = { row: s.row, col: s.col };
      for (let i = 0; i < n; i++) p = nextWordStart(s.lines, p.row, p.col);
      s.row = p.row;
      s.col = p.col;
      s.desired = s.col;
      return true;
    }
    case "b": {
      let p = { row: s.row, col: s.col };
      for (let i = 0; i < n; i++) p = prevWordStart(s.lines, p.row, p.col);
      s.row = p.row;
      s.col = p.col;
      s.desired = s.col;
      return true;
    }
    case "e": {
      let p = { row: s.row, col: s.col };
      for (let i = 0; i < n; i++) p = endOfWord(s.lines, p.row, p.col);
      s.row = p.row;
      s.col = p.col;
      s.desired = s.col;
      return true;
    }
    case "G": {
      s.row = clamp(s.row, 0, s.lines.length - 1);
      s.row = s.lines.length - 1;
      s.col = firstNonBlank(s.lines[s.row] || "");
      s.desired = s.col;
      return true;
    }
    default:
      return false;
  }
}

// ---- editing ---------------------------------------------------------
function deleteLines(s: VimState, n: number) {
  snapshot(s);
  const start = s.row;
  const end = Math.min(s.lines.length, start + n);
  const removed = s.lines.slice(start, end);
  s.register = { text: removed.join("\n") + "\n", linewise: true };
  s.lines.splice(start, end - start);
  if (s.lines.length === 0) s.lines = [""];
  s.row = clamp(start, 0, s.lines.length - 1);
  s.col = firstNonBlank(s.lines[s.row] || "");
}

function deleteChars(s: VimState, n: number) {
  const line = s.lines[s.row] || "";
  if (line.length === 0) return;
  snapshot(s);
  const end = Math.min(line.length, s.col + n);
  s.register = { text: line.slice(s.col, end), linewise: false };
  s.lines[s.row] = line.slice(0, s.col) + line.slice(end);
  s.col = clamp(s.col, 0, normMax(s));
}

function deleteToEnd(s: VimState) {
  const line = s.lines[s.row] || "";
  snapshot(s);
  s.register = { text: line.slice(s.col), linewise: false };
  s.lines[s.row] = line.slice(0, s.col);
  s.col = clamp(s.col, 0, normMax(s));
}

function deleteWordFwd(s: VimState) {
  const line = s.lines[s.row] || "";
  const tgt = nextWordStart(s.lines, s.row, s.col);
  snapshot(s);
  const end = tgt.row === s.row ? tgt.col : line.length;
  s.register = { text: line.slice(s.col, end), linewise: false };
  s.lines[s.row] = line.slice(0, s.col) + line.slice(end);
  s.col = clamp(s.col, 0, normMax(s));
}

function paste(s: VimState, after: boolean) {
  snapshot(s);
  const reg = s.register;
  if (!reg.text) return;
  if (reg.linewise) {
    const text = reg.text.replace(/\n$/, "");
    const newLines = text.split("\n");
    const at = after ? s.row + 1 : s.row;
    s.lines.splice(at, 0, ...newLines);
    s.row = at;
    s.col = firstNonBlank(s.lines[s.row]);
  } else {
    const line = s.lines[s.row] || "";
    const at = after ? Math.min(line.length, s.col + 1) : s.col;
    s.lines[s.row] = line.slice(0, at) + reg.text + line.slice(at);
    s.col = at + reg.text.length - 1;
  }
}

function undo(s: VimState) {
  if (!s.history.length) {
    setMessage(s, "Already at oldest change");
    return;
  }
  const snap = s.history.pop()!;
  s.redo.push({ lines: s.lines.slice(), row: s.row, col: s.col });
  s.lines = snap.lines.slice();
  s.row = clamp(snap.row, 0, s.lines.length - 1);
  s.col = clamp(snap.col, 0, normMax(s));
}

function enterInsert(s: VimState) {
  snapshot(s);
  s.mode = "insert";
  s.iseq = "";
}

// ---- visual selection range (normalized, inclusive) -----------------
export function selRange(s: VimState): SelRange | null {
  if (!s.anchor) return null;
  const a = s.anchor,
    b = { row: s.row, col: s.col };
  const before = a.row < b.row || (a.row === b.row && a.col <= b.col);
  return before ? { s: a, e: b } : { s: b, e: a };
}

function deleteSelection(s: VimState) {
  const r = selRange(s);
  if (!r) return;
  snapshot(s);
  if (r.s.row === r.e.row) {
    const line = s.lines[r.s.row];
    s.register = { text: line.slice(r.s.col, r.e.col + 1), linewise: false };
    s.lines[r.s.row] = line.slice(0, r.s.col) + line.slice(r.e.col + 1);
  } else {
    const first = s.lines[r.s.row],
      last = s.lines[r.e.row];
    const grabbed = [first.slice(r.s.col)].concat(
      s.lines.slice(r.s.row + 1, r.e.row),
      [last.slice(0, r.e.col + 1)],
    );
    s.register = { text: grabbed.join("\n"), linewise: false };
    s.lines.splice(r.s.row, r.e.row - r.s.row + 1, first.slice(0, r.s.col) + last.slice(r.e.col + 1));
  }
  s.row = r.s.row;
  s.col = clamp(r.s.col, 0, normMax(s));
}

function yankSelection(s: VimState) {
  const r = selRange(s);
  if (!r) return;
  if (r.s.row === r.e.row) {
    s.register = { text: s.lines[r.s.row].slice(r.s.col, r.e.col + 1), linewise: false };
  } else {
    const first = s.lines[r.s.row],
      last = s.lines[r.e.row];
    s.register = {
      text: [first.slice(r.s.col)]
        .concat(s.lines.slice(r.s.row + 1, r.e.row), [last.slice(0, r.e.col + 1)])
        .join("\n"),
      linewise: false,
    };
  }
  s.row = r.s.row;
  s.col = r.s.col;
}

// ---- command line ----------------------------------------------------
function runCommand(s: VimState, raw: string): VimAction {
  const cmd = raw.trim();
  let action: VimAction = null;
  if (/^\d+$/.test(cmd)) {
    s.row = clamp(parseInt(cmd, 10) - 1, 0, s.lines.length - 1);
    s.col = firstNonBlank(s.lines[s.row]);
  } else if (cmd === "w") {
    action = "save";
  } else if (cmd === "q" || cmd === "q!") {
    action = "quit";
  } else if (cmd === "wq" || cmd === "x") {
    action = "savequit";
  } else if (cmd === "set" || cmd === "settings") {
    action = "settings";
  } else if (cmd === "config" || cmd === "prefs" || cmd === "e ~/.notesiderc") {
    action = "config";
  } else if (cmd === "nav" || cmd === "sidebar") {
    action = "nav";
  } else if (cmd === "find" || cmd === "ff" || cmd === "files") {
    action = "find";
  } else if (cmd === "grep" || cmd === "fg" || cmd === "rg") {
    action = "grep";
  } else if (cmd === "$") {
    s.row = s.lines.length - 1;
    s.col = firstNonBlank(s.lines[s.row]);
  } else if (cmd === "") {
    /* noop */
  } else {
    setMessage(s, `E492: Not an editor command: ${cmd}`);
  }
  return action;
}

function runSearch(s: VimState, raw: string, dir: number) {
  const needle = raw || s.lastSearch;
  if (!needle) return;
  s.lastSearch = needle;
  const N = s.lines.length;
  // search forward from just after cursor
  for (let i = 1; i <= N; i++) {
    const r = (((dir > 0 ? s.row + i : s.row - i) % N) + N) % N;
    const hay = s.lines[r];
    const idx =
      dir > 0
        ? hay.indexOf(needle, r === s.row ? s.col + 1 : 0)
        : hay.lastIndexOf(needle);
    if (idx >= 0) {
      s.row = r;
      s.col = idx;
      s.desired = idx;
      return;
    }
  }
  // wrap within current line for forward
  const here = s.lines[s.row];
  const idx = here.indexOf(needle);
  if (idx >= 0) {
    s.col = idx;
    s.desired = idx;
    setMessage(s, "search hit BOTTOM, continuing at TOP");
    return;
  }
  setMessage(s, `E486: Pattern not found: ${needle}`);
}

// ---- main reducer ----------------------------------------------------
export function handleKey(
  state: VimState,
  key: string,
  mods: KeyMods,
  opts: HandleOpts,
): { state: VimState; action: VimAction } {
  const s: VimState = {
    ...state,
    lines: state.lines.slice(),
    history: state.history.slice(),
    redo: state.redo.slice(),
    anchor: state.anchor ? { ...state.anchor } : null,
    register: { ...state.register },
  };
  s.message = "";
  mods = mods || {};
  opts = opts || {};
  const escMap = opts.escMap || "";
  const vimMode = opts.vimMode !== false;
  if (!vimMode && s.mode !== "insert") s.mode = "insert";
  let action: VimAction = null;

  // keylog (printable + a few named)
  const named: Record<string, string> = {
    Escape: "⎋",
    Enter: "↵",
    Backspace: "⌫",
    Tab: "⇥",
    " ": "␣",
    ArrowLeft: "←",
    ArrowRight: "→",
    ArrowUp: "↑",
    ArrowDown: "↓",
  };
  if (s.mode === "normal" || s.mode === "visual") {
    const disp = named[key] || (key.length === 1 ? key : "");
    if (disp) s.keylog = [...s.keylog, disp].slice(-12);
  }

  // ===== COMMAND / SEARCH line =====
  if (s.mode === "command" || s.mode === "search") {
    if (key === "Escape") {
      s.mode = "normal";
      s.cmd = "";
    } else if (key === "Backspace") {
      if (s.cmd.length === 0) {
        s.mode = "normal";
      } else s.cmd = s.cmd.slice(0, -1);
    } else if (key === "Enter") {
      if (s.mode === "command") action = runCommand(s, s.cmd);
      else runSearch(s, s.cmd, 1);
      s.mode = "normal";
      s.cmd = "";
    } else if (key.length === 1 && !mods.ctrl && !mods.meta) {
      s.cmd += key;
    }
    return { state: s, action };
  }

  // ===== INSERT =====
  if (s.mode === "insert") {
    const line = s.lines[s.row] || "";
    if (key === "Escape") {
      if (vimMode) {
        s.mode = "normal";
        s.col = clamp(s.col - 1, 0, normMax(s));
        s.desired = s.col;
      }
      s.iseq = "";
    } else if (key === "ArrowLeft") {
      s.iseq = "";
      s.col = clamp(s.col - 1, 0, line.length);
      s.desired = s.col;
    } else if (key === "ArrowRight") {
      s.iseq = "";
      s.col = clamp(s.col + 1, 0, line.length);
      s.desired = s.col;
    } else if (key === "ArrowUp") {
      s.iseq = "";
      s.row = clamp(s.row - 1, 0, s.lines.length - 1);
      s.col = clamp(s.col, 0, lineLen(s));
    } else if (key === "ArrowDown") {
      s.iseq = "";
      s.row = clamp(s.row + 1, 0, s.lines.length - 1);
      s.col = clamp(s.col, 0, lineLen(s));
    } else if (key === "Home") {
      s.iseq = "";
      s.col = 0;
      s.desired = 0;
    } else if (key === "End") {
      s.iseq = "";
      s.col = line.length;
      s.desired = s.col;
    } else if (key === "Backspace") {
      s.iseq = "";
      if (s.col > 0) {
        s.lines[s.row] = line.slice(0, s.col - 1) + line.slice(s.col);
        s.col--;
      } else if (s.row > 0) {
        const prev = s.lines[s.row - 1];
        s.col = prev.length;
        s.lines[s.row - 1] = prev + line;
        s.lines.splice(s.row, 1);
        s.row--;
      }
    } else if (key === "Enter") {
      s.iseq = "";
      const indent = (line.match(/^\s*/) || [""])[0];
      s.lines.splice(s.row, 1, line.slice(0, s.col), indent + line.slice(s.col));
      s.row++;
      s.col = indent.length;
    } else if (key === "Tab") {
      s.iseq = "";
      s.lines[s.row] = line.slice(0, s.col) + "  " + line.slice(s.col);
      s.col += 2;
    } else if (key.length === 1 && !mods.ctrl && !mods.meta) {
      s.lines[s.row] = line.slice(0, s.col) + key + line.slice(s.col);
      s.col++;
      // jj-style escape: if the just-typed run ends with the mapped sequence,
      // strip it and drop back to normal mode.
      s.iseq = (s.iseq + key).slice(-Math.max(escMap.length, 1));
      if (escMap && s.iseq.slice(-escMap.length) === escMap) {
        const ln = s.lines[s.row];
        const start = s.col - escMap.length;
        s.lines[s.row] = ln.slice(0, start) + ln.slice(s.col);
        s.col = clamp(start - 1, 0, normMax(s));
        s.mode = "normal";
        s.desired = s.col;
        s.iseq = "";
      }
    }
    s.desired = s.col;
    return { state: s, action };
  }

  // ===== count prefix =====
  if (/^[1-9]$/.test(key) || (key === "0" && s.count !== "")) {
    s.count += key;
    return { state: s, action };
  }
  const n = Math.max(1, parseInt(s.count || "1", 10));
  const resetCount = () => {
    s.count = "";
  };

  // ===== pending operators =====
  if (s.pending === "r") {
    s.pending = "";
    if (key.length === 1 && !mods.ctrl && !mods.meta) {
      const line = s.lines[s.row] || "";
      if (line.length) {
        snapshot(s);
        s.lines[s.row] = line.slice(0, s.col) + key + line.slice(s.col + 1);
      }
    }
    resetCount();
    return { state: s, action };
  }
  if (s.pending === "g") {
    s.pending = "";
    if (key === "g") {
      s.row = s.count ? clamp(n - 1, 0, s.lines.length - 1) : 0;
      s.col = firstNonBlank(s.lines[s.row]);
      s.desired = s.col;
    }
    resetCount();
    return { state: s, action };
  }
  if (s.pending === "d") {
    s.pending = "";
    if (key === "d") deleteLines(s, n);
    else if (key === "w") deleteWordFwd(s);
    else if (key === "$") deleteToEnd(s);
    else if (key === "0") {
      const line = s.lines[s.row] || "";
      snapshot(s);
      s.register = { text: line.slice(0, s.col), linewise: false };
      s.lines[s.row] = line.slice(s.col);
      s.col = 0;
    }
    resetCount();
    return { state: s, action };
  }

  // ===== VISUAL =====
  if (s.mode === "visual") {
    if (key === "Escape") {
      s.mode = "normal";
      s.anchor = null;
    } else if (key === "d" || key === "x") {
      deleteSelection(s);
      s.mode = "normal";
      s.anchor = null;
    } else if (key === "y") {
      yankSelection(s);
      s.mode = "normal";
      s.anchor = null;
      setMessage(s, "yanked");
    } else if (key === "g") {
      s.pending = "g";
    } else applyMotion(s, key, n);
    resetCount();
    return { state: s, action };
  }

  // ===== NORMAL =====
  if (applyMotion(s, key, n)) {
    resetCount();
    return { state: s, action };
  }
  switch (key) {
    case "i":
      enterInsert(s);
      break;
    case "I":
      s.col = firstNonBlank(s.lines[s.row]);
      enterInsert(s);
      break;
    case "a":
      enterInsert(s);
      s.col = clamp(s.col + 1, 0, lineLen(s));
      break;
    case "A":
      enterInsert(s);
      s.col = lineLen(s);
      break;
    case "o":
      snapshot(s);
      {
        const indent = ((s.lines[s.row] || "").match(/^\s*/) || [""])[0];
        s.lines.splice(s.row + 1, 0, indent);
        s.row++;
        s.col = indent.length;
        s.mode = "insert";
        s.iseq = "";
      }
      break;
    case "O":
      snapshot(s);
      {
        const indent = ((s.lines[s.row] || "").match(/^\s*/) || [""])[0];
        s.lines.splice(s.row, 0, indent);
        s.col = indent.length;
        s.mode = "insert";
        s.iseq = "";
      }
      break;
    case "x":
      deleteChars(s, n);
      break;
    case "D":
      deleteToEnd(s);
      break;
    case "C":
      deleteToEnd(s);
      s.mode = "insert";
      s.iseq = "";
      snapshot(s);
      break;
    case "d":
      s.pending = "d";
      break;
    case "g":
      s.pending = "g";
      break;
    case "r":
      s.pending = "r";
      break;
    case "v":
      s.mode = "visual";
      s.anchor = { row: s.row, col: s.col };
      break;
    case "u":
      undo(s);
      break;
    case "p":
      paste(s, true);
      break;
    case "P":
      paste(s, false);
      break;
    case "n":
      runSearch(s, s.lastSearch, 1);
      break;
    case "N":
      runSearch(s, s.lastSearch, -1);
      break;
    case ":":
      s.mode = "command";
      s.cmd = "";
      break;
    case "/":
      s.mode = "search";
      s.cmd = "";
      break;
    default:
      break;
  }
  resetCount();
  return { state: s, action };
}

export function text(s: VimState): string {
  return s.lines.join("\n");
}

export function wordCount(s: VimState): number {
  const m = text(s).match(/\S+/g);
  return m ? m.length : 0;
}
