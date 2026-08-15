import { describe, expect, it } from "vitest";
import {
  APP_COMMANDS,
  chordConflict,
  chordLabel,
  COMMAND_BY_ID,
  COMMANDS,
  effectiveChord,
  eventChord,
  globalCommandForEvent,
  isSafeChord,
  makeEditorChordMap,
  makeGlobalChordMap,
  paletteCommands,
  resolveGlobalChord,
  withChordOverrides,
} from "./commands";

const ev = (
  key: string,
  mods: Partial<{ meta: boolean; ctrl: boolean; alt: boolean; shift: boolean }> = {},
) => ({
  metaKey: !!mods.meta,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
  key,
});

describe("command table", () => {
  it("covers every AppCommand", () => {
    const dispatched = new Set(COMMANDS.map((c) => c.command).filter(Boolean));
    for (const id of APP_COMMANDS) {
      expect(dispatched.has(id), `missing AppCommand: ${id}`).toBe(true);
    }
  });

  it("has unique ex-names, so no two commands claim the same `:` word", () => {
    const ex = COMMANDS.flatMap((c) => c.ex ?? []);
    expect(new Set(ex).size, `duplicate ex name in ${ex.join(", ")}`).toBe(ex.length);
  });

  // REGRESSION: pin/unpin were one toggling command with ex: ["pin", "unpin"],
  // so `:unpin` on an unpinned note PINNED it. An ex-name must describe the
  // effect it actually has, which means state-setting pairs are two commands.
  it("pin and unpin are separate, state-guarded commands", () => {
    expect(COMMAND_BY_ID.pin?.ex).toEqual(["pin"]);
    expect(COMMAND_BY_ID.unpin?.ex).toEqual(["unpin"]);
    expect(COMMAND_BY_ID.pin?.needsPinned).toBe(false); // offered when unpinned
    expect(COMMAND_BY_ID.unpin?.needsPinned).toBe(true); // offered when pinned
  });

  it("has unique ids and unique chords", () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const chords = COMMANDS.map((c) => c.chord).filter(Boolean) as string[];
    expect(new Set(chords).size).toBe(chords.length);
  });

  it("avoids the verified CM defaultKeymap collisions", () => {
    const chords = COMMANDS.map((c) => c.chord).filter(Boolean) as string[];
    expect(chords).not.toContain("Mod-Shift-k"); // deleteLine
    expect(chords).not.toContain("Mod-Enter"); // insertBlankLine
    // shifted punctuation can't match on event.key — none should be used
    expect(chords.some((c) => /Shift-[,./;]/.test(c))).toBe(false);
  });

  it("every command is runnable (an AppCommand or an editor action)", () => {
    for (const c of COMMANDS) {
      expect(!!c.command || !!c.editor, `unrunnable command: ${c.id}`).toBe(true);
    }
  });

  it("in-note search is bound to Mod-f as an editor action (not in the App palette)", () => {
    const s = COMMAND_BY_ID.search;
    expect(s?.chord).toBe("Mod-f");
    expect(s?.editor).toBe("search");
    expect(s?.inPalette).toBe(false); // needs the editor view, can't run from the App-level palette
  });

  it("chordLabel renders the modifiers per platform", () => {
    expect(chordLabel("Mod-p", false)).toBe("Ctrl+P");
    expect(chordLabel("Mod-Shift-f", false)).toBe("Ctrl+Shift+F");
    expect(chordLabel("Mod-/", false)).toBe("Ctrl+/");
    expect(chordLabel("Mod-,", false)).toBe("Ctrl+,");
    expect(chordLabel("Mod-p", true)).toBe("⌘P");
    expect(chordLabel("Mod-Shift-f", true)).toBe("⌘⇧F");
  });

  it("matches keyboard events to the right global command", () => {
    expect(globalCommandForEvent(ev("p", { meta: true }))?.id).toBe("find");
    expect(globalCommandForEvent(ev("P", { ctrl: true, shift: true }))?.id).toBe("commands");
    expect(globalCommandForEvent(ev("F", { meta: true, shift: true }))?.id).toBe("grep");
    expect(globalCommandForEvent(ev("b", { ctrl: true }))?.id).toBe("nav");
  });

  it("does NOT match editor-action chords globally (need a focused editor)", () => {
    // Mod-s is `save` (editor action) — not reachable via the no-editor fallback.
    expect(globalCommandForEvent(ev("s", { meta: true }))).toBeUndefined();
    // a bare key is never a global chord
    expect(globalCommandForEvent(ev("p"))).toBeUndefined();
  });

  it("eventChord normalizes modifier order and case", () => {
    expect(eventChord(ev("F", { ctrl: true, shift: true }))).toBe("Mod-Shift-f");
    expect(eventChord(ev("p", { meta: true }))).toBe("Mod-p");
  });

  // Zoom chords: the "-" key must survive chord parsing, and shifted
  // punctuation ("+", "_") must fold back to its base key.
  describe("font/UI zoom chords", () => {
    const ctx = { enabled: true, editingTarget: false };
    it("the '-' key parses as a chord key (trailing dash)", () => {
      expect(eventChord(ev("-", { meta: true }))).toBe("Mod--");
      expect(resolveGlobalChord(ev("-", { meta: true }), ctx)).toBe("fontDown");
      expect(chordLabel("Mod--", false)).toBe("Ctrl+-");
      expect(chordLabel("Mod--", true)).toBe("⌘-");
    });
    it("shifted '+' and '_' fold to '=' and '-'", () => {
      expect(eventChord(ev("+", { meta: true, shift: true }))).toBe("Mod-Shift-=");
      expect(eventChord(ev("_", { meta: true, shift: true }))).toBe("Mod-Shift--");
      // layouts with an unshifted '+' key: Cmd-+ still means zoom-in
      expect(eventChord(ev("+", { meta: true }))).toBe("Mod-=");
      expect(resolveGlobalChord(ev("+", { meta: true, shift: true }), ctx)).toBe("uiUp");
      expect(resolveGlobalChord(ev("_", { meta: true, shift: true }), ctx)).toBe("uiDown");
    });
    it("editor zoom resolves globally on = / - / 0", () => {
      expect(resolveGlobalChord(ev("=", { meta: true }), ctx)).toBe("fontUp");
      expect(resolveGlobalChord(ev("0", { meta: true }), ctx)).toBe("fontReset");
    });
    it("uiReset ships without a default chord (Shift+0 is layout-dependent)", () => {
      expect(COMMAND_BY_ID.uiReset?.chord).toBeUndefined();
      expect(COMMAND_BY_ID.uiReset?.command).toBe("uiReset");
    });
  });

  it("makeEditorChordMap has one entry per default chord, editor actions included", () => {
    const map = makeEditorChordMap();
    const chords = COMMANDS.map((c) => c.chord).filter(Boolean) as string[];
    expect(map.size).toBe(chords.length);
    expect(map.get("Mod-p")?.id).toBe("find");
    expect(map.get("Mod-s")?.id).toBe("save"); // editor-action commands ARE in this map
    expect(map.get("F3")?.id).toBe("searchNext");
  });

  it("editor chords match shifted-glyph events through eventChord's fold (no aliases needed)", () => {
    // event.key reports "+" for Shift-= — SHIFT_BASE folds it back, so the map
    // lookup lands on the canonical chord on every platform (the CM keymap
    // needed per-glyph alias bindings for WebKitGTK/Linux here).
    const map = makeEditorChordMap();
    expect(map.get(eventChord(ev("+", { meta: true, shift: true })))?.id).toBe("uiUp");
    expect(map.get(eventChord(ev("_", { meta: true, shift: true })))?.id).toBe("uiDown");
    expect(map.get(eventChord(ev("+", { meta: true })))?.id).toBe("fontUp"); // real '+' key layouts
  });

  describe("resolveGlobalChord (document-level fallback guard)", () => {
    const cmdP = ev("p", { meta: true });
    it("returns the command when enabled and nothing is being edited", () => {
      expect(resolveGlobalChord(cmdP, { enabled: true, editingTarget: false })).toBe("find");
    });
    it("defers when an overlay is open (enabled=false)", () => {
      expect(resolveGlobalChord(cmdP, { enabled: false, editingTarget: false })).toBe(null);
    });
    it("defers when an input/editor owns focus", () => {
      expect(resolveGlobalChord(cmdP, { enabled: true, editingTarget: true })).toBe(null);
    });
    it("ignores editor-action chords (save) and bare keys", () => {
      expect(
        resolveGlobalChord(ev("s", { meta: true }), { enabled: true, editingTarget: false }),
      ).toBe(null);
      expect(resolveGlobalChord(ev("p"), { enabled: true, editingTarget: false })).toBe(null);
    });
  });

  describe("chord overrides (bind)", () => {
    it("accepts command chords but rejects keys that would hijack text editing", () => {
      expect(isSafeChord("Mod-p")).toBe(true);
      expect(isSafeChord("Ctrl-j")).toBe(true);
      expect(isSafeChord("Alt-Enter")).toBe(true);
      expect(isSafeChord("F3")).toBe(true);
      expect(isSafeChord("Shift-F3")).toBe(true);

      expect(isSafeChord("a")).toBe(false);
      expect(isSafeChord("Shift-a")).toBe(false);
      expect(isSafeChord("Tab")).toBe(false);
      expect(isSafeChord("Enter")).toBe(false);
      expect(isSafeChord("ArrowLeft")).toBe(false);
    });

    // REGRESSION (stability pass): an unknown modifier token must fail validation
    // outright — CM's key normalization THROWS on it while building the keymap on
    // keydown, killing ALL keyboard handling until the bind line is fixed.
    it("rejects chords with unrecognized modifier tokens", () => {
      expect(isSafeChord("Mod-Sift-p")).toBe(false); // typo'd Shift
      expect(isSafeChord("Cmdd-p")).toBe(false);
      expect(isSafeChord("Mod-Hyper-k")).toBe(false);
      expect(isSafeChord("c-p")).toBe(false); // single-letter CM aliases: one spelling rules
      expect(isSafeChord("ctrl-shift-p")).toBe(true); // lowercase spellings are fine
    });

    // REGRESSION (stability pass): a lowercase modifier spelling must normalize
    // like the canonical one — dropping it registered `bind ctrl-p` as bare `p`
    // in the document-level map, hijacking plain typing in the no-note state.
    it("the global fallback normalizes lowercase modifier spellings", () => {
      const map = makeGlobalChordMap({ find: "ctrl-p" });
      const ctx = { enabled: true, editingTarget: false };
      expect(resolveGlobalChord(ev("p", { ctrl: true }), ctx, map)).toBe("find");
      expect(resolveGlobalChord(ev("p"), ctx, map)).toBe(null); // bare p stays typing
    });

    it("effectiveChord applies a rebind, an unbind, and the default", () => {
      expect(effectiveChord(COMMAND_BY_ID.find, { find: "Mod-g" })).toBe("Mod-g");
      expect(effectiveChord(COMMAND_BY_ID.find, { find: "" })).toBeUndefined();
      expect(effectiveChord(COMMAND_BY_ID.find, {})).toBe("Mod-p");
    });
    it("makeEditorChordMap honors overrides", () => {
      const map = makeEditorChordMap({ find: "Mod-g", grep: "" });
      expect(map.get("Mod-g")?.id).toBe("find"); // find rebound
      expect(map.has("Mod-p")).toBe(false); // old find chord gone
      expect(map.has("Mod-Shift-f")).toBe(false); // grep unbound
    });
    it("drops unsafe overrides at both editor and global dispatch boundaries", () => {
      const overrides = { new: "a", nav: "Tab" };
      expect(makeEditorChordMap(overrides).has("a")).toBe(false);
      expect(
        resolveGlobalChord(
          ev("a"),
          { enabled: true, editingTarget: false },
          makeGlobalChordMap(overrides),
        ),
      ).toBe(null);
    });
    it("the global fallback respects an override", () => {
      const map = makeGlobalChordMap({ find: "Mod-g" });
      const ctx = { enabled: true, editingTarget: false };
      expect(resolveGlobalChord(ev("g", { meta: true }), ctx, map)).toBe("find");
      expect(resolveGlobalChord(ev("p", { meta: true }), ctx, map)).toBe(null);
    });
    it("withChordOverrides reflects the rebind in the displayed chord", () => {
      const [find] = withChordOverrides([COMMAND_BY_ID.find], { find: "Mod-g" });
      expect(find.chord).toBe("Mod-g");
    });
  });

  describe("chordConflict (in-app keymap editor)", () => {
    it("flags a chord already used by another command's default", () => {
      // 'new' defaults to Mod-n — binding anything else to Mod-n clashes with it
      expect(chordConflict({}, "Mod-n", "find")?.id).toBe("new");
    });
    it("returns undefined for a free chord", () => {
      expect(chordConflict({}, "Mod-y", "find")).toBeUndefined();
    });
    it("excludes the command being edited (re-binding to its own chord is no clash)", () => {
      expect(chordConflict({}, "Mod-p", "find")).toBeUndefined();
    });
    it("checks EFFECTIVE chords — override vs override", () => {
      expect(chordConflict({ grep: "Mod-y" }, "Mod-y", "find")?.id).toBe("grep");
    });
    it("an unbound ('') override frees that command's default chord", () => {
      // 'new' unbound → Mod-n is no longer taken
      expect(chordConflict({ new: "" }, "Mod-n", "find")).toBeUndefined();
    });
  });

  it("the searchable palette excludes editor-context and self-opening commands", () => {
    const ids = paletteCommands.map((c) => c.id);
    expect(ids).not.toContain("save"); // needs editor text
    expect(ids).not.toContain("follow"); // needs cursor context
    expect(ids).not.toContain("commands"); // don't list "open the palette" in the palette
    expect(ids).toContain("find");
    expect(ids).toContain("new");
  });

  // The pointer-parity invariant (AGENTS.md §What this is): every command must
  // be reachable by mouse AND by keyboard. The mouse guarantee is transitive —
  // the searchable palette has a titlebar button and clickable rows, so being
  // in paletteCommands IS a pointer path. Guard both directions.
  describe("pointer-parity invariants", () => {
    it("every command keeps a keyboard path", () => {
      // A chord, an ex-command, or a leader key is a direct path; the searchable
      // palette also counts (it opens on a chord and runs on Enter) — that's the
      // only path uiReset has, deliberately (Shift+0 is layout-dependent).
      for (const c of COMMANDS) {
        expect(
          Boolean(c.chord || c.ex?.length || c.leader || c.inPalette !== false),
          `command "${c.id}" has no keyboard path`,
        ).toBe(true);
      }
    });

    it("palette exclusions are a conscious set, each with its own pointer story", () => {
      // save → the status bar's [+] chip; follow → Mod-click on links;
      // search* → the find bar's own buttons once open; commands → the
      // titlebar button IS the pointer path (don't list "open the palette"
      // in the palette); saveQuit → keyboard-only composite of two
      // pointer-reachable actions.
      // Adding an id here means consciously answering "what's its mouse path?".
      const excluded = COMMANDS.filter((c) => c.inPalette === false)
        .map((c) => c.id)
        .sort();
      expect(excluded).toEqual(
        ["commands", "follow", "save", "saveQuit", "search", "searchNext", "searchPrev"].sort(),
      );
    });
  });
});
