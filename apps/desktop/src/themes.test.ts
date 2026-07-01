import { describe, expect, it } from "vitest";
import {
  applyThemeVars,
  type Base16Palette,
  contrast,
  DEFAULT_THEME,
  resolveThemeId,
  schemeToPalette,
  THEME_VARS,
  type Theme,
  themeById,
  THEMES,
} from "./themes";

// A full, well-formed base16 palette (a monotonic dark ramp + accents) to tweak.
const ramp = (): Base16Palette => ({
  base00: "#101010",
  base01: "#202020",
  base02: "#303030",
  base03: "#606060",
  base04: "#909090",
  base05: "#d0d0d0",
  base06: "#e8e8e8",
  base07: "#ffffff",
  base08: "#e05050",
  base09: "#e0a050",
  base0a: "#e0e050",
  base0b: "#50e050",
  base0c: "#50e0e0",
  base0d: "#5080e0",
  base0e: "#a050e0",
  base0f: "#a06050",
});

describe("theme registry", () => {
  it("ships the two Noteside builtins plus the 14 curated schemes", () => {
    expect(THEMES).toHaveLength(16);
    const ids = THEMES.map((t) => t.id);
    expect(ids).toContain("noteside-light");
    expect(ids).toContain("noteside-dark");
    expect(ids).toContain("catppuccin-mocha");
    expect(ids).toContain("gruvbox-dark");
  });

  it("gives every theme a 3-color preview and a valid mode", () => {
    for (const t of THEMES) {
      expect(t.preview).toHaveLength(3);
      expect(["light", "dark"]).toContain(t.mode);
      if (t.kind === "base16") {
        expect(t.scheme).toBeDefined();
        // all 16 base slots present and hex
        for (let i = 0; i < 16; i++) {
          const key = `base${i.toString(16).padStart(2, "0")}` as keyof Base16Palette;
          expect(t.scheme!.palette[key]).toMatch(/^#[0-9a-f]{6}$/i);
        }
      }
    }
  });

  it("DEFAULT_THEME is a real builtin", () => {
    expect(themeById(DEFAULT_THEME).kind).toBe("builtin");
  });
});

describe("themeById + resolveThemeId", () => {
  it("resolves the light/dark aliases to the Noteside builtins", () => {
    expect(themeById("light").id).toBe("noteside-light");
    expect(themeById("dark").id).toBe("noteside-dark");
    expect(resolveThemeId("light")).toBe("noteside-light");
    expect(resolveThemeId("Dark")).toBe("noteside-dark");
  });

  it("matches by id and by label (case/space-insensitive)", () => {
    expect(resolveThemeId("catppuccin-mocha")).toBe("catppuccin-mocha");
    expect(resolveThemeId("Catppuccin Mocha")).toBe("catppuccin-mocha");
  });

  it("returns null for an unknown id (parse leaves the current value)", () => {
    expect(resolveThemeId("no-such-theme")).toBeNull();
  });

  it("falls back to the default theme on an unknown id", () => {
    expect(themeById("no-such-theme").id).toBe(DEFAULT_THEME);
  });
});

describe("contrast", () => {
  it("is ~21 for black on white and 1 for identical colors", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrast("#123456", "#123456")).toBeCloseTo(1, 5);
  });
});

describe("schemeToPalette", () => {
  it("maps the load-bearing slots onto the Noteside tokens", () => {
    const p = ramp();
    const v = schemeToPalette(p);
    expect(v["--paper"]).toBe(p.base00);
    expect(v["--paper-2"]).toBe(p.base01);
    expect(v["--paper-3"]).toBe(p.base02); // distinct steps → used directly
    expect(v["--ink"]).toBe(p.base05);
    expect(v["--ink-soft"]).toBe(p.base04);
    expect(v["--ink-faint"]).toBe(p.base03); // enough contrast → base03 kept
    expect(v["--accent"]).toBe(p.base0d);
    expect(v["--accent-base"]).toBe(p.base0d);
    expect(v["--danger"]).toBe(p.base08); // base16 red
    // borders are derived (a mix), not raw slots
    expect(v["--rule"]).toContain("color-mix");
    expect(v["--rule-soft"]).toContain("color-mix");
  });

  it("synthesizes a visible hover surface when base02 ≈ base01 (collapsed ramp)", () => {
    const p = ramp();
    p.base02 = p.base01; // no step → hover would be invisible
    const v = schemeToPalette(p);
    expect(v["--paper-3"]).toContain("color-mix");
    expect(v["--paper-3"]).not.toBe(p.base02);
  });

  it("rescues near-invisible faint ink by falling back to base04", () => {
    const p = ramp();
    p.base03 = p.base00; // contrast ~1 → below the floor
    const v = schemeToPalette(p);
    expect(v["--ink-faint"]).toBe(p.base04);
  });

  it("picks the accent-ink extreme that reads best on the accent", () => {
    const p = ramp();
    // base0d is a mid blue on a dark bg → the lightest ramp end should win
    const v = schemeToPalette(p);
    expect([p.base00, p.base07]).toContain(v["--accent-ink"]);
  });
});

describe("applyThemeVars", () => {
  function fakeEl() {
    const set: Record<string, string> = {};
    const removed: string[] = [];
    return {
      set,
      removed,
      style: {
        setProperty(n: string, val: string) {
          set[n] = val;
        },
        removeProperty(n: string) {
          removed.push(n);
          return "";
        },
      },
    };
  }

  it("clears every theme var for a builtin (styles.css renders verbatim)", () => {
    const el = fakeEl();
    const light = THEMES.find((t) => t.id === "noteside-light") as Theme;
    applyThemeVars(el, light);
    expect(Object.keys(el.set)).toHaveLength(0);
    expect(el.removed.sort()).toEqual([...THEME_VARS].sort());
  });

  it("sets exactly the mapped primitives for a base16 theme", () => {
    const el = fakeEl();
    const mocha = THEMES.find((t) => t.id === "catppuccin-mocha") as Theme;
    applyThemeVars(el, mocha);
    // it writes every one of the 12 primitives it controls…
    expect(Object.keys(el.set).sort()).toEqual([...THEME_VARS].sort());
    expect(el.set["--paper"]).toBeDefined();
    expect(el.set["--ink"]).toBeDefined();
    expect(el.set["--accent"]).toBeDefined();
    expect(el.set["--danger"]).toBeDefined();
    // …and never touches the derived/inherited tokens, so --sel / --active-line /
    // --desk-* / --shadow recompute from the [data-theme] block off the inline primitives.
    expect(el.removed).toHaveLength(0);
    expect(el.set["--sel"]).toBeUndefined();
    expect(el.set["--desk-a"]).toBeUndefined();
    expect(el.set["--shadow"]).toBeUndefined();
  });
});
