import { describe, expect, it } from "vitest";
import { type Config, CONFIG_DEFAULTS, parseConfig, serializeConfig } from "./settings";

describe("config serialize/parse round-trip", () => {
  it("round-trips the defaults exactly", () => {
    const parsed = parseConfig(serializeConfig(CONFIG_DEFAULTS), CONFIG_DEFAULTS);
    expect(parsed).toEqual(CONFIG_DEFAULTS);
  });

  it("round-trips a fully customized config", () => {
    const cfg: Config = {
      theme: "dark",
      accent: "sage",
      editorFont: "spectral",
      uiFont: "jetbrains",
      fontSize: 22,
      lineHeight: 1.9,
      cursor: "bar",
      cursorBlink: false,
      livePreview: false,
      vimMode: false,
      escMap: "jj",
      keymaps: ["nmap <Space>w :w<CR>", "vmap > >gv"],
    };
    expect(parseConfig(serializeConfig(cfg), CONFIG_DEFAULTS)).toEqual(cfg);
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
    expect(small.fontSize).toBe(14);
    expect(small.lineHeight).toBe(1.4);
  });

  it("ignores comments and unknown keys", () => {
    const parsed = parseConfig('" a comment\nset bogus = 1\nset theme = dark', CONFIG_DEFAULTS);
    expect(parsed.theme).toBe("dark");
    expect(parsed.accent).toBe(CONFIG_DEFAULTS.accent);
  });
});
