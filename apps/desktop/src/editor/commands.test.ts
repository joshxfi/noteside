import { describe, expect, it } from "vitest";
import type { AppCommand } from "./ex-commands";
import {
  chordConflict,
  chordLabel,
  COMMAND_BY_ID,
  COMMANDS,
  commandChordKeymap,
  effectiveChord,
  eventChord,
  globalCommandForEvent,
  makeGlobalChordMap,
  paletteCommands,
  resolveGlobalChord,
  withChordOverrides,
} from "./commands";

// Mirror of the AppCommand union — the table must cover every one of these.
const APP_COMMANDS: AppCommand[] = [
  "find",
  "grep",
  "nav",
  "settings",
  "config",
  "new",
  "delete",
  "palette",
  "commands",
  "togglePreview",
  "backlinks",
  "reopen",
  "nextNote",
  "prevNote",
  "cheatsheet",
];

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

  it("commandChordKeymap yields one binding per chord and dispatches", () => {
    const ran: string[] = [];
    const km = commandChordKeymap((c) => ran.push(c.id));
    expect(km.length).toBe(COMMANDS.filter((c) => c.chord).length);
    const find = km.find((b) => b.key === "Mod-p");
    expect(find?.run?.({} as never)).toBe(true);
    expect(ran).toEqual(["find"]);
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
    it("effectiveChord applies a rebind, an unbind, and the default", () => {
      expect(effectiveChord(COMMAND_BY_ID.find, { find: "Mod-g" })).toBe("Mod-g");
      expect(effectiveChord(COMMAND_BY_ID.find, { find: "" })).toBeUndefined();
      expect(effectiveChord(COMMAND_BY_ID.find, {})).toBe("Mod-p");
    });
    it("commandChordKeymap honors overrides", () => {
      const km = commandChordKeymap(() => {}, { find: "Mod-g", grep: "" });
      const keys = km.map((b) => b.key);
      expect(keys).toContain("Mod-g"); // find rebound
      expect(keys).not.toContain("Mod-p"); // old find chord gone
      expect(keys).not.toContain("Mod-Shift-f"); // grep unbound
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
});
