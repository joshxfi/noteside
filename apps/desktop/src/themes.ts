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
  "--danger",
  // Deliberately NOT set for base16: --sel/--active-line/--desk-a/--desk-b derive
  // from --paper/--accent in the [data-theme] blocks; --shadow/--win-border inherit
  // the mode default; --accent-base is a builtins-only input to the block's --accent
  // definition, which the inline --accent above already shadows.
] as const;

// Guard thresholds. base16 schemes are authored for SYNTAX, not UI, so a couple of
// slots need safety nets. These are not "pathological schemes only" rules — both
// fire on the curated set by design: HOVER_FLAT on Nord/One Dark/Rosé Pine, and
// FAINT_MIN on 19 of 51. Fidelity is preserved where it costs nothing (a slot that
// already reads is passed through untouched) and traded only where the raw slot
// would be unusable as interface text.
const HOVER_FLAT = 0.04; // gamma-lightness gap (~10/255) below which base02≈base01
/** Contrast floor for tertiary ink (note metadata, the notebook subline, the status
 *  bar). base03 is a syntax COMMENT color — authored to recede inside a code buffer,
 *  not to carry UI text — and on a third of the curated set it all but disappears
 *  against base00 (Flexoki Light 1.55, Nord Light 1.61, Catppuccin Latte 1.61).
 *  Sits just under the catalog median (2.47), so it lifts only the faintest schemes
 *  and leaves the majority's authored color untouched. */
const FAINT_MIN = 2.2;

const rgbToHex = (c: number[]): string =>
  "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

/** sRGB interpolation from `a` to `b` at `t` (0..1), as a hex string. */
function blend(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]);
}

/**
 * Tertiary ink that is actually legible. Returns base03 untouched when it already
 * clears FAINT_MIN against the paper; otherwise deepens it TOWARD the body ink by
 * the smallest blend that does, which keeps the author's hue and moves the value as
 * little as possible (≤25% across the curated set).
 *
 * Deriving beats the old "fall back to base04" rule, which was blunt in both
 * directions: on Catppuccin it barely moved (1.72 → 2.23) while on Nord it overshot
 * to 9.25 — brighter than several themes' BODY text, which is not what a faint token
 * is for. A scheme whose base05 itself misses the floor simply lands on base05.
 */
export function readableFaint(base03: string, base05: string, paper: string): string {
  if (contrast(base03, paper) >= FAINT_MIN) return base03;
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 24; i++) {
    const midpoint = (lo + hi) / 2;
    if (contrast(blend(base03, base05, midpoint), paper) >= FAINT_MIN) hi = midpoint;
    else lo = midpoint;
  }
  return blend(base03, base05, hi);
}

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
  // Faint ink = comments (base03), deepened toward the body ink when it would be
  // too pale to read as UI text (see readableFaint).
  const inkFaint = readableFaint(p.base03, p.base05, p.base00);

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
    "--danger": p.base08, // base16 red
  };
}

/** The 3-stripe swatch (bg · ink · accent) both pickers render for a theme. */
export const previewGradient = (t: Theme): string =>
  `linear-gradient(90deg, ${t.preview[0]} 0 34%, ${t.preview[1]} 34% 67%, ${t.preview[2]} 67% 100%)`;

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
// The builtin previews transcribe --paper/--ink/--accent from the [data-theme]
// blocks in styles.css (the visual source of truth) — keep them in sync when
// retuning the Noteside palette there.
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
