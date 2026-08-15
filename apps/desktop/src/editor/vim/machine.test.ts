// The pure vim key machine: keys in, intents out. Everything here runs with
// zero ProseMirror — the machine is the layer that makes the subset testable.
import { describe, expect, it } from "vitest";
import { feedKey, initialVimState, type Intent, type KeyInput, type VimState } from "./machine";

const input = (key: string, mods: Partial<KeyInput> = {}): KeyInput => ({
  key,
  ctrl: false,
  shift: false,
  allowCtrlScroll: true,
  ...mods,
});

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

describe("counts", () => {
  it("accumulates digits and applies to motions", () => {
    const r = feed(["1", "2", "j"]);
    expect(r.intents).toEqual([
      { kind: "move", motion: { t: "line", dir: 1 }, count: 12, extend: false },
    ]);
    expect(r.state.count).toBe(0); // consumed
  });

  it("bare 0 is a motion; 0 after digits is a count digit", () => {
    expect(feed(["0"]).intents[0]).toMatchObject({ motion: { t: "lineStart" } });
    expect(feed(["1", "0", "j"]).intents[0]).toMatchObject({ count: 10 });
  });

  it("caps at 999", () => {
    const r = feed(["9", "9", "9", "9"]);
    expect(r.state.count).toBe(999);
  });

  it("N G jumps to block N; bare G goes to the end", () => {
    expect(feed(["5", "G"]).intents[0]).toMatchObject({ motion: { t: "blockJump", n: 5 } });
    expect(feed(["G"]).intents[0]).toMatchObject({ motion: { t: "docEnd" } });
    expect(feed(["3", "g", "g"]).intents[0]).toMatchObject({ motion: { t: "blockJump", n: 3 } });
    expect(feed(["g", "g"]).intents[0]).toMatchObject({ motion: { t: "docStart" } });
  });
});

describe("operators", () => {
  it("dd deletes count lines", () => {
    expect(feed(["d", "d"]).intents).toEqual([{ kind: "deleteLines", count: 1 }]);
    expect(feed(["3", "d", "d"]).intents).toEqual([{ kind: "deleteLines", count: 3 }]);
  });

  it("d + motion", () => {
    expect(feed(["d", "w"]).intents[0]).toMatchObject({
      kind: "deleteMotion",
      motion: { t: "word", which: "w" },
    });
    expect(feed(["d", "$"]).intents[0]).toMatchObject({ motion: { t: "lineEnd" } });
    expect(feed(["D"]).intents[0]).toMatchObject({ motion: { t: "lineEnd" } });
  });

  it("d + garbage swallows and resets", () => {
    const r = feed(["d", "z"]);
    expect(r.intents).toEqual([]);
    expect(r.state.pending).toBe(null);
    expect(r.handled).toBe(true);
  });

  it("yy / Y yank lines", () => {
    expect(feed(["y", "y"]).intents).toEqual([{ kind: "yankLines", count: 1 }]);
    expect(feed(["2", "Y"]).intents).toEqual([{ kind: "yankLines", count: 2 }]);
  });

  it("x, p, P carry counts", () => {
    expect(feed(["4", "x"]).intents).toEqual([{ kind: "deleteChar", count: 4 }]);
    expect(feed(["p"]).intents).toEqual([{ kind: "paste", before: false, count: 1 }]);
    expect(feed(["2", "P"]).intents).toEqual([{ kind: "paste", before: true, count: 2 }]);
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
    const r = feed(["2", "f", "x"]);
    expect(r.intents[0]).toMatchObject({ count: 2 });
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
      const r = feed([k]);
      expect(r.intents).toEqual([
        { kind: "insert", where },
        { kind: "mode", to: "insert" },
      ]);
    }
  });

  it("v and V enter visual-line; either exits it", () => {
    const v = feed(["v"]);
    expect(v.intents).toEqual([{ kind: "mode", to: "visual" }]);
    const visual: VimState = { ...initialVimState, mode: "visual" };
    expect(feed(["V"], visual).intents).toEqual([{ kind: "mode", to: "normal" }]);
    expect(feed(["Escape"], visual).intents).toEqual([{ kind: "mode", to: "normal" }]);
  });

  it("visual motions extend; d/x/y/p act on the selection and exit", () => {
    const visual: VimState = { ...initialVimState, mode: "visual" };
    expect(feed(["j"], visual).intents[0]).toMatchObject({ extend: true });
    expect(feed(["d"], visual).intents).toEqual([
      { kind: "deleteSelection" },
      { kind: "mode", to: "normal" },
    ]);
    expect(feed(["y"], visual).intents[0]).toMatchObject({ kind: "yankSelection" });
    expect(feed(["p"], visual).intents[0]).toMatchObject({ kind: "pasteSelection" });
  });
});

describe("app hooks + search", () => {
  it("Space opens the leader palette only with nothing pending", () => {
    expect(feed([" "]).intents).toEqual([{ kind: "app", hook: "palette" }]);
    expect(feed(["2", " "]).intents).toEqual([]); // count pending — no palette
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
});

describe("key hygiene", () => {
  it("bare printables are ALWAYS consumed in normal mode (nothing types)", () => {
    for (const k of ["q", "z", "m", "R", "%", "~"]) {
      const r = feedKey(initialVimState, input(k));
      expect(r.handled, `key ${k}`).toBe(true);
      expect(r.intents).toEqual([]);
    }
  });

  it("Tab is swallowed; arrows and Enter pass through", () => {
    expect(feedKey(initialVimState, input("Tab")).handled).toBe(true);
    expect(feedKey(initialVimState, input("ArrowDown")).handled).toBe(false);
    expect(feedKey(initialVimState, input("Enter")).handled).toBe(false);
    expect(feedKey(initialVimState, input("Backspace")).handled).toBe(false);
  });

  it("Ctrl-d/u scroll only where Ctrl isn't the chord modifier", () => {
    expect(
      feedKey(initialVimState, input("d", { ctrl: true, allowCtrlScroll: true })).intents,
    ).toEqual([{ kind: "scroll", dir: 1 }]);
    expect(
      feedKey(initialVimState, input("u", { ctrl: true, allowCtrlScroll: true })).intents,
    ).toEqual([{ kind: "scroll", dir: -1 }]);
    const gated = feedKey(initialVimState, input("d", { ctrl: true, allowCtrlScroll: false }));
    expect(gated.intents).toEqual([]);
  });

  it("Ctrl-r redoes; unknown Ctrl combos pass through", () => {
    expect(feedKey(initialVimState, input("r", { ctrl: true })).intents).toEqual([
      { kind: "redo" },
    ]);
    expect(feedKey(initialVimState, input("k", { ctrl: true })).handled).toBe(false);
  });

  it("u undoes", () => {
    expect(feed(["u"]).intents).toEqual([{ kind: "undo" }]);
  });
});
