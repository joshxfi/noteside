// The pure vim key machine: keys in, intents out. Everything here runs with
// zero ProseMirror — the machine is the layer that makes the subset testable.
import { describe, expect, it } from "vitest";
import {
  feedKey,
  initialVimState,
  isChangeIntent,
  pendingLabel,
  withCount,
  type Intent,
  type KeyInput,
  type VimState,
} from "./machine";

const input = (key: string, mods: Partial<KeyInput> = {}): KeyInput => ({
  key,
  ctrl: false,
  shift: false,
  allowCtrlScroll: true,
  ...mods,
});

const visualState: VimState = { ...initialVimState, mode: "visual", visual: "char" };
const visualLineState: VimState = { ...initialVimState, mode: "visual", visual: "line" };

/** Feed a key sequence, collecting every intent. */
function feed(keys: string[], start: VimState = initialVimState) {
  let state = start;
  const intents: Intent[] = [];
  let handled = true;
  for (const k of keys) {
    const r = feedKey(state, input(k));
    state = r.state;
    handled = r.handled;
    intents.push(...r.intents);
  }
  return { state, intents, handled };
}

describe("modifier keydowns", () => {
  // A real browser fires a keydown for the modifier ITSELF ("Shift") before the
  // shifted character arrives — the machine must look straight through it, or
  // every shifted motion/object/seek after an operator or count breaks (d$,
  // dG, ci", fA, 5G). Playwright's press("$") emits no such event, which is
  // why the e2e layer alone never caught it.
  const MODS = ["Shift", "Control", "Alt", "Meta", "CapsLock", "AltGraph"];

  it("are transparent while an operator is pending", () => {
    const r = feed(["d", "Shift", "$"]);
    expect(r.intents).toEqual([{ kind: "operate", op: "d", motion: { t: "lineEnd" }, count: 1 }]);
    expect(feed(["d", "Shift", "G"]).intents[0]).toMatchObject({
      kind: "operate",
      motion: { t: "docEnd" },
    });
    expect(feed(["c", "Shift", "}"]).intents[0]).toMatchObject({
      kind: "operate",
      motion: { t: "para", dir: 1 },
    });
  });

  it("are transparent inside a count, a seek, a replace, and a text object", () => {
    expect(feed(["2", "Shift", "G"]).intents[0]).toMatchObject({
      motion: { t: "blockJump", n: 2 },
    });
    expect(feed(["f", "Shift", "A"]).intents[0]).toMatchObject({
      motion: { t: "seek", cmd: "f", ch: "A" },
    });
    expect(feed(["r", "Shift", "X"]).intents[0]).toEqual({
      kind: "replaceChar",
      ch: "X",
      count: 1,
    });
    expect(feed(["d", "i", "Shift", '"']).intents[0]).toMatchObject({
      kind: "operate",
      motion: { t: "object", obj: '"', around: false },
    });
    expect(feed(["i", "Shift", '"'], visualState).intents.at(-1)).toMatchObject({
      kind: "move",
      motion: { t: "object", obj: '"' },
    });
  });

  it("never consume the key, and leave the state untouched", () => {
    for (const k of MODS) {
      const pending = feed(["2", "d"]).state;
      const r = feedKey(pending, input(k, { ctrl: k === "Control", shift: k === "Shift" }));
      expect(r.handled).toBe(false);
      expect(r.intents).toEqual([]);
      expect(r.state).toBe(pending);
    }
  });

  it("a dead key (macOS Option-e) is swallowed in normal mode — nothing may type", () => {
    const r = feedKey(initialVimState, input("Dead"));
    expect(r.handled).toBe(true);
    expect(r.intents).toEqual([]);
  });
});

describe("counts", () => {
  it("accumulates digits and applies to motions", () => {
    const r = feed(["1", "2", "j"]);
    expect(r.intents).toEqual([{ kind: "move", motion: { t: "line", dir: 1 }, count: 12 }]);
    expect(r.state.count).toBe(0); // consumed
  });

  it("bare 0 is a motion; 0 after digits is a count digit", () => {
    expect(feed(["0"]).intents[0]).toMatchObject({ motion: { t: "lineStart" } });
    expect(feed(["1", "0", "j"]).intents[0]).toMatchObject({ count: 10 });
  });

  it("caps at 999", () => {
    expect(feed(["9", "9", "9", "9"]).state.count).toBe(999);
  });

  it("N G jumps to block N; bare G goes to the end", () => {
    expect(feed(["5", "G"]).intents[0]).toMatchObject({ motion: { t: "blockJump", n: 5 } });
    expect(feed(["G"]).intents[0]).toMatchObject({ motion: { t: "docEnd" } });
    expect(feed(["3", "g", "g"]).intents[0]).toMatchObject({ motion: { t: "blockJump", n: 3 } });
    expect(feed(["g", "g"]).intents[0]).toMatchObject({ motion: { t: "docStart" } });
  });

  it("counts before AND after an operator multiply (2d3w = 6 words)", () => {
    expect(feed(["2", "d", "3", "w"]).intents).toEqual([
      { kind: "operate", op: "d", motion: { t: "word", which: "w" }, count: 6 },
    ]);
    expect(feed(["3", "d", "d"]).intents).toEqual([{ kind: "operateLines", op: "d", count: 3 }]);
    expect(feed(["d", "2", "d"]).intents).toEqual([{ kind: "operateLines", op: "d", count: 2 }]);
  });
});

describe("operators + motions", () => {
  it("d waits for a motion, then operates", () => {
    const pending = feed(["d"]);
    expect(pending.intents).toEqual([]);
    expect(pending.state.op).toEqual({ op: "d", count: 0 });
    expect(pendingLabel(pending.state)).toBe("d");
    expect(feed(["d", "w"]).intents[0]).toMatchObject({
      kind: "operate",
      op: "d",
      motion: { t: "word", which: "w" },
    });
    expect(feed(["d", "$"]).intents[0]).toMatchObject({ op: "d", motion: { t: "lineEnd" } });
    expect(feed(["d", "j"]).intents[0]).toMatchObject({ op: "d", motion: { t: "line", dir: 1 } });
    expect(feed(["d", "G"]).intents[0]).toMatchObject({ op: "d", motion: { t: "docEnd" } });
    expect(feed(["d", "g", "g"]).intents[0]).toMatchObject({ op: "d", motion: { t: "docStart" } });
    expect(feed(["d", "}"]).intents[0]).toMatchObject({ op: "d", motion: { t: "para", dir: 1 } });
    expect(feed(["d", "%"]).intents[0]).toMatchObject({ op: "d", motion: { t: "matchPair" } });
    expect(feed(["d", "l"]).intents[0]).toMatchObject({ op: "d", motion: { t: "char", dir: 1 } });
  });

  it("d + seek waits for the char (df x) and records it for ;", () => {
    const r = feed(["d", "f", "x"]);
    expect(r.intents).toEqual([
      { kind: "operate", op: "d", motion: { t: "seek", cmd: "f", ch: "x" }, count: 1 },
    ]);
    expect(r.state.lastSeek).toEqual({ cmd: "f", ch: "x" });
    expect(pendingLabel(feed(["d", "t"]).state)).toBe("dt");
  });

  it("c is the change operator: cw / cc / C / S / s all end in insert mode", () => {
    expect(feed(["c", "w"]).intents).toEqual([
      { kind: "operate", op: "c", motion: { t: "word", which: "w" }, count: 1 },
      { kind: "mode", to: "insert" },
    ]);
    expect(feed(["c", "c"]).intents).toEqual([
      { kind: "operateLines", op: "c", count: 1 },
      { kind: "mode", to: "insert" },
    ]);
    expect(feed(["c", "i", "w"]).intents[1]).toEqual({ kind: "mode", to: "insert" });
    expect(feed(["d", "w"]).intents).toHaveLength(1);
    expect(feed(["C"]).intents).toEqual([
      { kind: "operate", op: "c", motion: { t: "lineEnd" }, count: 1 },
      { kind: "mode", to: "insert" },
    ]);
    expect(feed(["S"]).intents).toEqual([
      { kind: "operateLines", op: "c", count: 1 },
      { kind: "mode", to: "insert" },
    ]);
    expect(feed(["3", "s"]).intents).toEqual([
      { kind: "operate", op: "c", motion: { t: "char", dir: 1 }, count: 3 },
      { kind: "mode", to: "insert" },
    ]);
  });

  it("D / Y are d$ / yy", () => {
    expect(feed(["D"]).intents[0]).toMatchObject({ op: "d", motion: { t: "lineEnd" } });
    expect(feed(["2", "Y"]).intents).toEqual([{ kind: "operateLines", op: "y", count: 2 }]);
  });

  it("y takes motions too (yw, y$, yy)", () => {
    expect(feed(["y", "w"]).intents[0]).toMatchObject({
      op: "y",
      motion: { t: "word", which: "w" },
    });
    expect(feed(["y", "$"]).intents[0]).toMatchObject({ op: "y", motion: { t: "lineEnd" } });
    expect(feed(["y", "y"]).intents).toEqual([{ kind: "operateLines", op: "y", count: 1 }]);
  });

  it(">> / << shift lines; > + motion shifts too", () => {
    expect(feed([">", ">"]).intents).toEqual([{ kind: "operateLines", op: ">", count: 1 }]);
    expect(feed(["<", "<"]).intents).toEqual([{ kind: "operateLines", op: "<", count: 1 }]);
    expect(feed([">", "j"]).intents[0]).toMatchObject({ op: ">", motion: { t: "line", dir: 1 } });
  });

  it("text objects: operator + i/a + kind", () => {
    expect(feed(["d", "i", "w"]).intents).toEqual([
      { kind: "operate", op: "d", motion: { t: "object", obj: "w", around: false }, count: 1 },
    ]);
    expect(feed(["c", "a", "w"]).intents[0]).toMatchObject({
      op: "c",
      motion: { t: "object", obj: "w", around: true },
    });
    expect(feed(["d", "i", '"']).intents[0]).toMatchObject({ motion: { obj: '"', around: false } });
    expect(feed(["y", "i", "("]).intents[0]).toMatchObject({ motion: { obj: "(", around: false } });
    expect(feed(["d", "a", ")"]).intents[0]).toMatchObject({ motion: { obj: "(", around: true } });
    expect(feed(["d", "i", "b"]).intents[0]).toMatchObject({ motion: { obj: "(" } });
    expect(feed(["d", "i", "B"]).intents[0]).toMatchObject({ motion: { obj: "{" } });
    expect(feed(["d", "i", "]"]).intents[0]).toMatchObject({ motion: { obj: "[" } });
    expect(feed(["d", "i", "p"]).intents[0]).toMatchObject({ motion: { obj: "p" } });
    expect(pendingLabel(feed(["c", "i"]).state)).toBe("ci");
  });

  it("d + garbage swallows and resets; an unknown object kind too", () => {
    const r = feed(["d", "z"]);
    expect(r.intents).toEqual([]);
    expect(r.state.op).toBe(null);
    expect(r.handled).toBe(true);
    expect(feed(["d", "i", "z"]).intents).toEqual([]);
  });

  it("Escape cancels a pending operator", () => {
    const r = feed(["2", "d", "Escape"]);
    expect(r.intents).toEqual([]);
    expect(r.state.op).toBe(null);
    expect(r.state.count).toBe(0);
  });
});

describe("edits", () => {
  it("x / X / Delete carry counts", () => {
    expect(feed(["4", "x"]).intents).toEqual([{ kind: "deleteChar", count: 4, before: false }]);
    expect(feed(["X"]).intents).toEqual([{ kind: "deleteChar", count: 1, before: true }]);
    expect(feed(["Delete"]).intents).toEqual([{ kind: "deleteChar", count: 1, before: false }]);
  });

  it("p / P carry counts", () => {
    expect(feed(["p"]).intents).toEqual([{ kind: "paste", before: false, count: 1 }]);
    expect(feed(["2", "P"]).intents).toEqual([{ kind: "paste", before: true, count: 2 }]);
  });

  it("r waits for its char, then replaces count chars", () => {
    expect(pendingLabel(feed(["r"]).state)).toBe("r");
    expect(feed(["r", "x"]).intents).toEqual([{ kind: "replaceChar", ch: "x", count: 1 }]);
    expect(feed(["3", "r", "-"]).intents).toEqual([{ kind: "replaceChar", ch: "-", count: 3 }]);
    expect(feed(["r", "Escape"]).intents).toEqual([]);
  });

  it("~ toggles case, J joins", () => {
    expect(feed(["~"]).intents).toEqual([
      { kind: "caseChange", to: "toggle", count: 1, selection: false },
    ]);
    expect(feed(["3", "J"]).intents).toEqual([{ kind: "join", count: 3, selection: false }]);
  });

  it(". repeats with an optional count", () => {
    expect(feed(["."]).intents).toEqual([{ kind: "repeat", count: 0 }]);
    expect(feed(["3", "."]).intents).toEqual([{ kind: "repeat", count: 3 }]);
  });

  it("isChangeIntent / withCount drive the repeat record", () => {
    const dw = feed(["d", "w"]).intents[0];
    expect(isChangeIntent(dw)).toBe(true);
    expect(isChangeIntent(feed(["y", "w"]).intents[0])).toBe(false);
    expect(isChangeIntent(feed(["j"]).intents[0])).toBe(false);
    expect(isChangeIntent({ kind: "insert", where: "after" })).toBe(true);
    expect(withCount(dw, 3)).toMatchObject({ count: 3 });
    expect(withCount({ kind: "insert", where: "after" }, 3)).toEqual({
      kind: "insert",
      where: "after",
    });
  });
});

describe("seeks", () => {
  it("f waits for its char, then ; repeats and , reverses", () => {
    const r = feed(["f", "x"]);
    expect(r.intents[0]).toMatchObject({ motion: { t: "seek", cmd: "f", ch: "x" } });
    expect(r.state.lastSeek).toEqual({ cmd: "f", ch: "x" });

    const rep = feed([";"], r.state);
    expect(rep.intents[0]).toMatchObject({ motion: { t: "seek", cmd: "f", ch: "x" } });
    const rev = feed([","], r.state);
    expect(rev.intents[0]).toMatchObject({ motion: { t: "seek", cmd: "F", ch: "x" } });
  });

  it("counts apply to seeks (2fx = second x)", () => {
    expect(feed(["2", "f", "x"]).intents[0]).toMatchObject({ count: 2 });
  });

  it("Escape cancels a pending seek", () => {
    const r = feed(["f", "Escape"]);
    expect(r.intents).toEqual([]);
    expect(r.state.awaitSeek).toBe(null);
  });
});

describe("modes", () => {
  it("insert entries emit placement + mode", () => {
    for (const [k, where] of [
      ["i", "before"],
      ["a", "after"],
      ["I", "lineStart"],
      ["A", "lineEnd"],
      ["o", "below"],
      ["O", "above"],
    ] as const) {
      expect(feed([k]).intents).toEqual([
        { kind: "insert", where },
        { kind: "mode", to: "insert" },
      ]);
    }
  });

  it("v is charwise, V linewise; the same key exits, the other switches", () => {
    expect(feed(["v"]).intents).toEqual([{ kind: "mode", to: "visual", visual: "char" }]);
    expect(feed(["V"]).intents).toEqual([{ kind: "mode", to: "visual", visual: "line" }]);
    expect(feed(["v"], visualState).intents).toEqual([{ kind: "mode", to: "normal" }]);
    expect(feed(["V"], visualState).intents).toEqual([
      { kind: "mode", to: "visual", visual: "line" },
    ]);
    expect(feed(["v"], visualLineState).intents).toEqual([
      { kind: "mode", to: "visual", visual: "char" },
    ]);
    expect(feed(["Escape"], visualState).intents).toEqual([{ kind: "mode", to: "normal" }]);
  });

  it("visual: motions move; d/x/y/c/>/< act on the selection and exit", () => {
    expect(feed(["j"], visualState).intents[0]).toMatchObject({ kind: "move" });
    expect(feed(["d"], visualState).intents).toEqual([
      { kind: "operateSelection", op: "d" },
      { kind: "mode", to: "normal" },
    ]);
    expect(feed(["x"], visualState).intents[0]).toMatchObject({
      kind: "operateSelection",
      op: "d",
    });
    expect(feed(["y"], visualState).intents[0]).toMatchObject({
      kind: "operateSelection",
      op: "y",
    });
    expect(feed(["c"], visualState).intents).toEqual([
      { kind: "operateSelection", op: "c" },
      { kind: "mode", to: "insert" },
    ]);
    expect(feed(["s"], visualState).intents[0]).toMatchObject({
      kind: "operateSelection",
      op: "c",
    });
    expect(feed([">"], visualState).intents[0]).toMatchObject({
      kind: "operateSelection",
      op: ">",
    });
    expect(feed(["p"], visualState).intents[0]).toMatchObject({ kind: "pasteSelection" });
  });

  it("visual: iw/aw/i( select objects, o swaps ends, ~ u U J act on the selection", () => {
    expect(feed(["i", "w"], visualState).intents).toEqual([
      { kind: "move", motion: { t: "object", obj: "w", around: false }, count: 1 },
    ]);
    expect(feed(["a", "("], visualState).intents[0]).toMatchObject({
      motion: { obj: "(", around: true },
    });
    expect(feed(["o"], visualState).intents).toEqual([{ kind: "visualSwap" }]);
    expect(feed(["~"], visualState).intents[0]).toMatchObject({
      kind: "caseChange",
      to: "toggle",
      selection: true,
    });
    expect(feed(["u"], visualState).intents[0]).toMatchObject({ kind: "caseChange", to: "lower" });
    expect(feed(["U"], visualState).intents[0]).toMatchObject({ kind: "caseChange", to: "upper" });
    expect(feed(["J"], visualState).intents[0]).toMatchObject({ kind: "join", selection: true });
  });
});

describe("app hooks + search + scroll", () => {
  it("Space opens the leader palette only with nothing pending (and not in visual)", () => {
    expect(feed([" "]).intents).toEqual([{ kind: "app", hook: "palette" }]);
    expect(feed(["2", " "]).intents).toEqual([]); // count pending — no palette
    expect(feed([" "], visualState).intents[0]).toMatchObject({ motion: { t: "char", dir: 1 } });
  });

  it(": / gx / slash route to their hooks", () => {
    expect(feed([":"]).intents).toEqual([{ kind: "app", hook: "exBar" }]);
    expect(feed(["g", "x"]).intents).toEqual([{ kind: "app", hook: "follow" }]);
    expect(feed(["/"]).intents).toEqual([{ kind: "app", hook: "findBar" }]);
  });

  it("n/N cycle matches; * and # search the word under the caret", () => {
    expect(feed(["n"]).intents).toEqual([{ kind: "findNext" }]);
    expect(feed(["N"]).intents).toEqual([{ kind: "findPrev" }]);
    expect(feed(["*"]).intents).toEqual([{ kind: "searchWord", dir: 1 }]);
    expect(feed(["#"]).intents).toEqual([{ kind: "searchWord", dir: -1 }]);
  });

  it("zz / zt / zb scroll the caret line", () => {
    expect(feed(["z", "z"]).intents).toEqual([{ kind: "scrollCaret", where: "center" }]);
    expect(feed(["z", "t"]).intents).toEqual([{ kind: "scrollCaret", where: "top" }]);
    expect(feed(["z", "b"]).intents).toEqual([{ kind: "scrollCaret", where: "bottom" }]);
    expect(pendingLabel(feed(["z"]).state)).toBe("z");
  });

  it("% is a motion", () => {
    expect(feed(["%"]).intents).toEqual([{ kind: "move", motion: { t: "matchPair" }, count: 1 }]);
  });
});

describe("key hygiene", () => {
  it("bare printables are ALWAYS consumed in normal mode (nothing types)", () => {
    for (const k of ["q", "z", "m", "R", "&", "Q"]) {
      const r = feedKey(initialVimState, input(k));
      expect(r.handled, `key ${k}`).toBe(true);
      expect(r.intents).toEqual([]);
    }
  });

  it("Backspace/Enter/Delete are vim keys in normal mode — they never edit or pass through", () => {
    expect(feed(["Backspace"]).intents[0]).toMatchObject({ motion: { t: "char", dir: -1 } });
    expect(feed(["Enter"]).intents[0]).toMatchObject({ motion: { t: "line", dir: 1 } });
    expect(feed(["Delete"]).intents[0]).toMatchObject({ kind: "deleteChar" });
    expect(feed(["Backspace"]).handled).toBe(true);
  });

  it("Tab is swallowed; arrows pass through (and cancel a pending operator)", () => {
    expect(feedKey(initialVimState, input("Tab")).handled).toBe(true);
    expect(feedKey(initialVimState, input("ArrowDown")).handled).toBe(false);
    const r = feed(["d", "ArrowDown"]);
    expect(r.handled).toBe(false);
    expect(r.state.op).toBe(null);
  });

  it("Ctrl-d/u/f/b scroll only where Ctrl isn't the chord modifier", () => {
    expect(feedKey(initialVimState, input("d", { ctrl: true })).intents).toEqual([
      { kind: "scroll", dir: 1, page: "half" },
    ]);
    expect(feedKey(initialVimState, input("u", { ctrl: true })).intents).toEqual([
      { kind: "scroll", dir: -1, page: "half" },
    ]);
    expect(feedKey(initialVimState, input("f", { ctrl: true })).intents).toEqual([
      { kind: "scroll", dir: 1, page: "full" },
    ]);
    expect(feedKey(initialVimState, input("b", { ctrl: true })).intents).toEqual([
      { kind: "scroll", dir: -1, page: "full" },
    ]);
    const gated = feedKey(initialVimState, input("d", { ctrl: true, allowCtrlScroll: false }));
    expect(gated.intents).toEqual([]);
    expect(gated.handled).toBe(true);
  });

  it("Ctrl-r redoes; Ctrl-[ is Escape; unknown Ctrl combos pass through", () => {
    expect(feedKey(initialVimState, input("r", { ctrl: true })).intents).toEqual([
      { kind: "redo" },
    ]);
    expect(feedKey(visualState, input("[", { ctrl: true })).intents).toEqual([
      { kind: "mode", to: "normal" },
    ]);
    expect(feedKey(initialVimState, input("k", { ctrl: true })).handled).toBe(false);
  });

  it("u undoes", () => {
    expect(feed(["u"]).intents).toEqual([{ kind: "undo" }]);
  });

  it("pendingLabel reads back the typed prefix", () => {
    expect(pendingLabel(initialVimState)).toBe("");
    expect(pendingLabel(feed(["2"]).state)).toBe("2");
    expect(pendingLabel(feed(["2", "d"]).state)).toBe("2d");
    expect(pendingLabel(feed(["2", "d", "3"]).state)).toBe("2d3");
    expect(pendingLabel(feed(["g"]).state)).toBe("g");
    expect(pendingLabel(feed(["f"]).state)).toBe("f");
  });
});
