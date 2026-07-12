import { describe, expect, it } from "vitest";
import {
  type Config,
  CONFIG_DEFAULTS,
  isFirstLaunch,
  parseConfig,
  serializeConfig,
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
      uiScale: 1.2,
      relativeNumbers: true,
      cursor: "bar",
      cursorBlink: false,
      livePreview: false,
      autoUpdateCheck: false,
      vimMode: false,
      escMap: "jj",
      keymaps: ["nmap <Space>w :w<CR>", "vmap > >gv"],
      chords: { find: "Ctrl-j", grep: "" },
    };
    expect(parseConfig(serializeConfig(cfg), CONFIG_DEFAULTS)).toEqual(cfg);
  });

  it("round-trips bind lines (rebind + unbind)", () => {
    const parsed = parseConfig("bind Ctrl-j find\nbind none grep", CONFIG_DEFAULTS);
    expect(parsed.chords).toEqual({ find: "Ctrl-j", grep: "" });
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

  it("ignores comments and unknown keys", () => {
    const parsed = parseConfig('" a comment\nset bogus = 1\nset theme = dark', CONFIG_DEFAULTS);
    expect(parsed.theme).toBe("noteside-dark"); // dark alias → builtin id
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
