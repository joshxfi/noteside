import { describe, expect, it } from "vitest";
import {
  type Config,
  CONFIG_DEFAULTS,
  isFirstLaunch,
  parseConfig,
  serializeConfig,
  unrecognizedDirectives,
} from "./settings";

describe("config serialize/parse round-trip", () => {
  it("round-trips the defaults exactly", () => {
    const parsed = parseConfig(serializeConfig(CONFIG_DEFAULTS), CONFIG_DEFAULTS);
    expect(parsed).toEqual(CONFIG_DEFAULTS);
  });

  it("round-trips a fully customized config", () => {
    const cfg: Config = {
      theme: "catppuccin-mocha",
      editorFont: "spectral",
      fontSize: 22,
      lineHeight: 1.9,
      tabWidth: 4,
      uiScale: 1.2,
      sidebarWidth: 320,
      relativeNumbers: true,
      cursor: "bar",
      cursorBlink: false,
      livePreview: false,
      autoUpdateCheck: false,
      vimMode: false,
      escMap: "jj",
      keymaps: ["nmap <Space>w :w<CR>", "vmap > >gv"],
      chords: { find: "Ctrl-j", grep: "" },
      extraLines: [],
    };
    expect(parseConfig(serializeConfig(cfg), CONFIG_DEFAULTS)).toEqual(cfg);
  });

  it("round-trips bind lines (rebind + unbind)", () => {
    const parsed = parseConfig("bind Ctrl-j find\nbind none grep", CONFIG_DEFAULTS);
    expect(parsed.chords).toEqual({ find: "Ctrl-j", grep: "" });
  });

  it("ignores bind lines that would hijack ordinary editor keys", () => {
    const parsed = parseConfig(
      [
        "bind a new",
        "bind Shift-a grep",
        "bind Tab nav",
        "bind Ctrl-j find",
        "bind F4 searchNext",
        "bind none grep",
      ].join("\n"),
      CONFIG_DEFAULTS,
    );
    expect(parsed.chords).toEqual({ find: "Ctrl-j", searchNext: "F4", grep: "" });

    const serialized = serializeConfig({
      ...CONFIG_DEFAULTS,
      chords: { new: "a", nav: "Tab", find: "Ctrl-j", grep: "" },
    });
    expect(serialized).not.toMatch(/^bind (?:a|Tab) /m);
    expect(serialized).toMatch(/^bind Ctrl-j find$/m);
    expect(serialized).toMatch(/^bind none grep$/m);
  });

  it("round-trips uiScale and accepts %/decimal forms, clamped + snapped", () => {
    const cfg: Config = { ...CONFIG_DEFAULTS, uiScale: 1.15 };
    expect(serializeConfig(cfg)).toMatch(/^set ui-scale\s*=\s*115%$/m);
    expect(parseConfig(serializeConfig(cfg), CONFIG_DEFAULTS).uiScale).toBe(1.15);
    expect(parseConfig("set ui-scale = 1.1", CONFIG_DEFAULTS).uiScale).toBe(1.1);
    expect(parseConfig("set ui-scale = 200%", CONFIG_DEFAULTS).uiScale).toBe(1.3); // clamp
    expect(parseConfig("set ui-scale = 50%", CONFIG_DEFAULTS).uiScale).toBe(0.9); // clamp
  });

  it("distinguishes reset (no bind line → default) from unbind (bind none)", () => {
    // unbind: "" → emits `bind none <id>` → round-trips back to ""
    const unbound = serializeConfig({ ...CONFIG_DEFAULTS, chords: { find: "" } });
    expect(unbound).toMatch(/^bind none find$/m);
    expect(parseConfig(unbound, CONFIG_DEFAULTS).chords).toEqual({ find: "" });
    // reset: key absent → NO bind line → parses back absent (the table default applies)
    const reset = serializeConfig({ ...CONFIG_DEFAULTS, chords: {} });
    expect(reset).not.toMatch(/^bind \S/m);
    expect(parseConfig(reset, CONFIG_DEFAULTS).chords).toEqual({});
  });

  it("collects nmap/vmap lines into keymaps (not the escMap imap)", () => {
    const parsed = parseConfig("imap jj <Esc>\nnmap <Space>w :w<CR>\nvmap > >gv", CONFIG_DEFAULTS);
    expect(parsed.escMap).toBe("jj");
    expect(parsed.keymaps).toEqual(["nmap <Space>w :w<CR>", "vmap > >gv"]);
  });

  it("parses an imap line into escMap and clears it when absent", () => {
    expect(parseConfig("imap jk <Esc>", CONFIG_DEFAULTS).escMap).toBe("jk");
    expect(parseConfig("set vim = on", CONFIG_DEFAULTS).escMap).toBe("");
  });

  it("clamps font-size and line-height to their ranges", () => {
    const big = parseConfig("set font-size = 99\nset line-height = 9", CONFIG_DEFAULTS);
    expect(big.fontSize).toBe(28);
    expect(big.lineHeight).toBe(2.1);
    const small = parseConfig("set font-size = 2\nset line-height = 0.2", CONFIG_DEFAULTS);
    expect(small.fontSize).toBe(16);
    expect(small.lineHeight).toBe(1.4);
  });

  it("applies known keys alongside unknown ones", () => {
    const parsed = parseConfig('" a comment\nset bogus = 1\nset theme = dark', CONFIG_DEFAULTS);
    expect(parsed.theme).toBe("noteside-dark"); // dark alias → builtin id
  });

  // ISSUE #24: the config buffer is a view of the Config object, not a real
  // file, so serialize() used to regenerate it from scratch — silently eating
  // every line the parser didn't know, including the user's own comments.
  describe("unrecognized lines survive the round-trip", () => {
    it("keeps unknown directives and user comments verbatim", () => {
      const parsed = parseConfig(
        'set theme = dark\nset bogus = 1\n" my own note\nset mystery on',
        CONFIG_DEFAULTS,
      );
      expect(parsed.extraLines).toEqual(["set bogus = 1", '" my own note', "set mystery on"]);
      const reopened = serializeConfig(parsed);
      expect(reopened).toContain("set bogus = 1");
      expect(reopened).toContain('" my own note');
      expect(reopened).toContain("set mystery on");
    });

    it("is idempotent — reopening never duplicates or drops the kept lines", () => {
      const once = serializeConfig(parseConfig("set bogus = 1", CONFIG_DEFAULTS));
      const twice = serializeConfig(parseConfig(once, CONFIG_DEFAULTS));
      expect(twice).toBe(once);
      expect(twice.match(/set bogus = 1/g)).toHaveLength(1);
    });

    it("never re-collects Noteside's own boilerplate as a user line", () => {
      // Regression guard for the obvious way this breaks: if the generated
      // comments weren't recognized as ours they'd accumulate on every save.
      let text = serializeConfig(CONFIG_DEFAULTS);
      for (let i = 0; i < 3; i++) text = serializeConfig(parseConfig(text, CONFIG_DEFAULTS));
      expect(parseConfig(text, CONFIG_DEFAULTS).extraLines).toEqual([]);
      expect(text.match(/Noteside configuration/g)).toHaveLength(1);
    });

    it("stops keeping a line once Noteside learns to parse it", () => {
      // `set tabstop=4` is exactly what the issue reporter tried.
      const parsed = parseConfig("set tabstop=4", CONFIG_DEFAULTS);
      expect(parsed.tabWidth).toBe(4);
      expect(parsed.extraLines).toEqual([]);
    });

    // REGRESSION (stability pass): a RECOGNIZED key with a value that fails to
    // resolve used to be consumed anyway — the line vanished on the next open
    // with no report, the exact silent-eat contract issue #24 forbids.
    it("keeps and reports recognized keys whose value does not resolve", () => {
      const text = [
        "set theme = catpuccin-mocha", // typo'd id, not dark/light-ish
        "set editor-font = Comic Sans",
        "set font-size = huge",
        "set cursor = wedge",
        "set vim = onn", // boolean typo — must not silently mean "off"
      ].join("\n");
      const parsed = parseConfig(text, CONFIG_DEFAULTS);
      expect(parsed.theme).toBe(CONFIG_DEFAULTS.theme);
      expect(parsed.editorFont).toBe(CONFIG_DEFAULTS.editorFont);
      expect(parsed.fontSize).toBe(CONFIG_DEFAULTS.fontSize);
      expect(parsed.cursor).toBe(CONFIG_DEFAULTS.cursor);
      expect(parsed.vimMode).toBe(CONFIG_DEFAULTS.vimMode);
      expect(parsed.extraLines).toEqual(text.split("\n"));
      expect(unrecognizedDirectives(parsed)).toEqual(text.split("\n"));
      // ...and they survive a reopen verbatim.
      const reopened = serializeConfig(parsed);
      for (const line of text.split("\n")) expect(reopened).toContain(line);
    });

    it("still applies both boolean spellings", () => {
      expect(parseConfig("set vim = on", CONFIG_DEFAULTS).vimMode).toBe(true);
      expect(parseConfig("set vim = off", CONFIG_DEFAULTS).vimMode).toBe(false);
      expect(parseConfig("set cursor-blink = false", CONFIG_DEFAULTS).cursorBlink).toBe(false);
    });
  });

  // ISSUE #23/#24: someone reaching for indent width types vim's spelling.
  describe("tab width", () => {
    it("accepts the Noteside key and vim's aliases", () => {
      for (const line of [
        "set tab-width = 4",
        "set tabwidth=4",
        "set tabstop=4",
        "set ts=4",
        "set shiftwidth = 4",
        "set sw=4",
      ]) {
        expect(parseConfig(line, CONFIG_DEFAULTS).tabWidth, line).toBe(4);
      }
    });

    it("clamps to a sane range and ignores garbage", () => {
      expect(parseConfig("set tab-width = 0", CONFIG_DEFAULTS).tabWidth).toBe(1);
      expect(parseConfig("set tab-width = 99", CONFIG_DEFAULTS).tabWidth).toBe(8);
      expect(parseConfig("set tab-width = wide", CONFIG_DEFAULTS).tabWidth).toBe(
        CONFIG_DEFAULTS.tabWidth,
      );
    });

    it("defaults to CodeMirror's own indent unit, so existing users see no change", () => {
      expect(CONFIG_DEFAULTS.tabWidth).toBe(2);
    });
  });

  describe("unrecognizedDirectives", () => {
    it("reports directives but not comments (the toast should not nag about prose)", () => {
      const parsed = parseConfig('set bogus = 1\n" just a note', CONFIG_DEFAULTS);
      expect(unrecognizedDirectives(parsed)).toEqual(["set bogus = 1"]);
    });

    it("is empty for a config Noteside fully understands", () => {
      expect(unrecognizedDirectives(parseConfig("set vim = off", CONFIG_DEFAULTS))).toEqual([]);
    });
  });

  it("resolves theme ids + light/dark aliases and ignores stale accent lines", () => {
    expect(parseConfig("set theme = catppuccin-mocha", CONFIG_DEFAULTS).theme).toBe(
      "catppuccin-mocha",
    );
    expect(parseConfig("set theme = light", CONFIG_DEFAULTS).theme).toBe("noteside-light");
    expect(parseConfig("set theme = dark", CONFIG_DEFAULTS).theme).toBe("noteside-dark");
    // dark/light-ish strings keep the pre-themes parser's tolerance
    expect(parseConfig("set theme = dark mode", CONFIG_DEFAULTS).theme).toBe("noteside-dark");
    expect(parseConfig("set theme = darkmode", CONFIG_DEFAULTS).theme).toBe("noteside-dark");
    expect(parseConfig("set theme = LIGHT!", CONFIG_DEFAULTS).theme).toBe("noteside-light");
    // unknown theme id → keep the base value, never crash
    expect(parseConfig("set theme = bogus-theme", CONFIG_DEFAULTS).theme).toBe(
      CONFIG_DEFAULTS.theme,
    );
    // a stale `set accent = …` line from a pre-themes config is silently dropped
    const p = parseConfig("set accent = plum\nset theme = nord", CONFIG_DEFAULTS);
    expect(p.theme).toBe("nord");
    expect("accent" in p).toBe(false);
  });
});

describe("isFirstLaunch", () => {
  it("is true only with no stored config and no last notebook", () => {
    expect(isFirstLaunch(null, null)).toBe(true);
  });

  it("is false once a config has been stored (choice already made)", () => {
    expect(isFirstLaunch({ vimMode: false }, null)).toBe(false);
    expect(isFirstLaunch({}, null)).toBe(false); // an empty object still counts as stored
  });

  it("is false for an existing user with a remembered notebook", () => {
    expect(isFirstLaunch(null, "/notes")).toBe(false);
    expect(isFirstLaunch({ vimMode: true }, "/notes")).toBe(false);
  });
});
