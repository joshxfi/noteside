// themes.ts — the theme registry + the base16 → design-token mapping. Pure and
// framework-free (node-testable): no React, no CodeMirror, no DOM beyond a tiny
// style-target interface.
//
// Two kinds of theme:
//  - "builtin"  — Noteside's own light/dark. Applies NO overrides; the app renders
//    from the [data-theme] blocks in styles.css verbatim (zero-regression path).
//  - "base16"   — a curated tinted-theming scheme (src/bundled-schemes.json). Its 16
//    slots are mapped onto Noteside's ~12 primitive CSS custom properties; the
//    color-mix-derived tokens (--sel/--active-line/--desk-*) then recompute from
//    those inline primitives, so the whole app + editor re-skin with no remount.
//
// Community/user theme files (a ~/.noteside/themes dir scanned in Rust) are a
// deferred v2 — the loader will produce the same Base16Scheme shape and reuse
// schemeToPalette, so nothing here needs to change.
import BUNDLED from "./bundled-schemes.json";

/** A base16 palette: base00-07 = a bg→fg ramp, base08-0F = accent/syntax colors. */
export interface Base16Palette {
  base00: string;
  base01: string;
  base02: string;
  base03: string;
  base04: string;
  base05: string;
  base06: string;
  base07: string;
  base08: string;
  base09: string;
  base0a: string;
  base0b: string;
  base0c: string;
  base0d: string;
  base0e: string;
  base0f: string;
}

export interface Base16Scheme {
  id: string;
  name: string;
  author: string;
  variant: "light" | "dark";
  palette: Base16Palette;
}

export interface Theme {
  /** Stable id — the `set theme = <id>` value in ~/.notesiderc. */
  id: string;
  label: string;
  /** Drives the `data-theme` attribute (and thus the color-mix derivations). */
  mode: "light" | "dark";
  kind: "builtin" | "base16";
  /** Present iff kind === "base16". */
  scheme?: Base16Scheme;
  /** Picker swatch: [background, body ink, accent]. */
  preview: [string, string, string];
}

// ── color math (sRGB relative luminance + WCAG contrast) ─────────────────
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function relLuminance(hex: string): number {
  const chan = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}
/** Gamma-space perceived lightness (0..1) — a better "are these two surfaces
 *  visually distinct" proxy than linear luminance, which collapses toward 0 for
 *  dark colors and would flag distinct dark surfaces as identical. */
function lightness(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}
/** WCAG contrast ratio (1..21). */
export function contrast(a: string, b: string): number {
  const la = relLuminance(a),
    lb = relLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** A perceptual mix, emitted as a CSS value so the browser does the blend. */
const mix = (a: string, b: string, pct: number) => `color-mix(in oklab, ${a}, ${b} ${pct}%)`;

// ── the mapping (the crux) ───────────────────────────────────────────────
/** Every design token a theme may control. applyThemeVars sets or clears each. */
export const THEME_VARS = [
  "--paper",
  "--paper-2",
  "--paper-3",
  "--ink",
  "--ink-soft",
  "--ink-faint",
  "--rule",
  "--rule-soft",
  "--accent",
  "--accent-ink",
  "--accent-base",
  "--danger",
  // Deliberately NOT set for base16 (they derive from --paper/--accent in the
  // [data-theme] blocks, or inherit the mode default): --sel, --active-line,
  // --desk-a, --desk-b, --shadow, --win-border.
] as const;

// Guard thresholds. base16 schemes are authored for syntax, not UI, so a couple
// of slots need safety nets — tuned to NOT fire on the curated set (fidelity),
// only rescuing pathological schemes (matters for the deferred user-import v2).
const HOVER_FLAT = 0.04; // gamma-lightness gap (~10/255) below which base02≈base01
const FAINT_MIN = 1.5; // contrast ratio below which faint ink is ~invisible

/**
 * Map a base16 palette onto Noteside's primitive design tokens. Returns hex/CSS
 * values keyed by CSS custom property. Borders are derived (base00→base05 mix)
 * for robustness; surfaces/ink use the ramp slots directly with two guards.
 */
export function schemeToPalette(p: Base16Palette): Record<string, string> {
  const paper = p.base00;
  const paper2 = p.base01;
  // Hover surface: base02, unless it's indistinguishable from base01 — then nudge
  // toward the foreground so hover is always visible.
  const paper3 =
    Math.abs(lightness(p.base02) - lightness(p.base01)) < HOVER_FLAT
      ? mix(p.base01, p.base05, 10)
      : p.base02;

  const ink = p.base05;
  const inkSoft = p.base04;
  // Faint ink = comments (base03), unless near-invisible → fall back to base04.
  const inkFaint = contrast(p.base03, p.base00) < FAINT_MIN ? p.base04 : p.base03;

  // Borders derived as faint ink-tinted paper — robust in both polarities and
  // visible even when the surface ramp is flat.
  const rule = mix(p.base00, p.base05, 15);
  const ruleSoft = mix(p.base00, p.base05, 8);

  const accent = p.base0d; // base16 convention: blue = functions/links/accent
  // Glyph placed ON the accent (block-cursor char, mode bar): pick the ramp
  // extreme that reads best on it.
  const accentInk =
    contrast(p.base00, p.base0d) >= contrast(p.base07, p.base0d) ? p.base00 : p.base07;

  return {
    "--paper": paper,
    "--paper-2": paper2,
    "--paper-3": paper3,
    "--ink": ink,
    "--ink-soft": inkSoft,
    "--ink-faint": inkFaint,
    "--rule": rule,
    "--rule-soft": ruleSoft,
    "--accent": accent,
    "--accent-ink": accentInk,
    "--accent-base": accent,
    "--danger": p.base08, // base16 red
  };
}

/** The CSS-var overrides a theme applies. Empty for builtin (use styles.css). */
export function resolveThemeVars(theme: Theme): Record<string, string> {
  if (theme.kind !== "base16" || !theme.scheme) return {};
  return schemeToPalette(theme.scheme.palette);
}

interface StyleTarget {
  style: {
    setProperty(name: string, value: string): void;
    removeProperty(name: string): unknown;
  };
}

/**
 * Write a theme's primitives onto an element's inline style (which outranks the
 * [data-theme] block), clearing any var the theme doesn't set so the block's
 * value / color-mix derivation takes over. Setting data-theme is the caller's job.
 */
export function applyThemeVars(el: StyleTarget, theme: Theme): void {
  const vars = resolveThemeVars(theme);
  for (const name of THEME_VARS) {
    const v = vars[name];
    if (v) el.style.setProperty(name, v);
    else el.style.removeProperty(name);
  }
}

// ── the registry ─────────────────────────────────────────────────────────
const BUILTIN: Theme[] = [
  {
    id: "noteside-light",
    label: "Noteside Light",
    mode: "light",
    kind: "builtin",
    preview: ["oklch(0.971 0.011 79)", "oklch(0.315 0.022 53)", "oklch(0.565 0.095 350)"],
  },
  {
    id: "noteside-dark",
    label: "Noteside Dark",
    mode: "dark",
    kind: "builtin",
    preview: ["oklch(0.232 0.012 58)", "oklch(0.892 0.016 78)", "oklch(0.66 0.09 350)"],
  },
];

const BASE16_THEMES: Theme[] = (BUNDLED as Base16Scheme[]).map((s) => ({
  id: s.id,
  label: s.name,
  mode: s.variant,
  kind: "base16" as const,
  scheme: s,
  preview: [s.palette.base00, s.palette.base05, s.palette.base0d],
}));

/** All selectable themes, in picker order (Noteside first, then the curated set). */
export const THEMES: Theme[] = [...BUILTIN, ...BASE16_THEMES];

// Old configs said `set theme = light|dark`; keep those working as the builtins.
const ALIASES: Record<string, string> = {
  light: "noteside-light",
  dark: "noteside-dark",
};

/** The canonical theme id for a config value (id / alias / label), or null if unknown. */
export function resolveThemeId(val: string): string | null {
  const n = val.trim().toLowerCase().replace(/\s+/g, "-");
  if (ALIASES[n]) return ALIASES[n];
  if (THEMES.some((t) => t.id === n)) return n;
  const byLabel = THEMES.find((t) => t.label.toLowerCase().replace(/\s+/g, "-") === n);
  return byLabel ? byLabel.id : null;
}

/** Look up a theme by id (resolving aliases); falls back to the default light theme. */
export function themeById(id: string): Theme {
  const resolved = ALIASES[id] ?? id;
  return THEMES.find((t) => t.id === resolved) ?? THEMES[0];
}

/** The default theme id (today's Noteside light look). */
export const DEFAULT_THEME = "noteside-light";
