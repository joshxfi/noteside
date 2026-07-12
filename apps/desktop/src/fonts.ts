// Locally-bundled fonts (offline-first). Covers every family selectable in
// Settings so font choices work with no network (no Google Fonts request on
// launch); weights match the design's usage (Geist Mono gets 400/500/600 — it's
// the interface font + a selectable editor mono). Instead of @fontsource's per-weight
// CSS side-effect imports (which ship every unicode subset in woff2 AND woff —
// ~1.75 MB of assets, half of it dead weight), we import each subset's woff2
// only and author the @font-face rules ourselves: WKWebView always picks woff2,
// so the .woff copies were never used. Every subset a family ships (latin,
// latin-ext, cyrillic, cyrillic-ext, greek, vietnamese, Geist Mono's symbols2 —
// varies per family) is
// kept so non-latin notes still render in the bundled fonts. Family names,
// weights/styles, font-display, and unicode-ranges are copied verbatim from
// @fontsource so typography (and the CSS var font stacks) render identically.
// Imported for side effects: the rules are injected into <head> synchronously
// at module eval, before first render.

import geistMonoCyrillic400 from "@fontsource/geist-mono/files/geist-mono-cyrillic-400-normal.woff2";
import geistMonoCyrillic500 from "@fontsource/geist-mono/files/geist-mono-cyrillic-500-normal.woff2";
import geistMonoCyrillic600 from "@fontsource/geist-mono/files/geist-mono-cyrillic-600-normal.woff2";
import geistMonoCyrillicExt400 from "@fontsource/geist-mono/files/geist-mono-cyrillic-ext-400-normal.woff2";
import geistMonoCyrillicExt500 from "@fontsource/geist-mono/files/geist-mono-cyrillic-ext-500-normal.woff2";
import geistMonoCyrillicExt600 from "@fontsource/geist-mono/files/geist-mono-cyrillic-ext-600-normal.woff2";
import geistMonoLatin400 from "@fontsource/geist-mono/files/geist-mono-latin-400-normal.woff2";
import geistMonoLatin500 from "@fontsource/geist-mono/files/geist-mono-latin-500-normal.woff2";
import geistMonoLatin600 from "@fontsource/geist-mono/files/geist-mono-latin-600-normal.woff2";
import geistMonoLatinExt400 from "@fontsource/geist-mono/files/geist-mono-latin-ext-400-normal.woff2";
import geistMonoLatinExt500 from "@fontsource/geist-mono/files/geist-mono-latin-ext-500-normal.woff2";
import geistMonoLatinExt600 from "@fontsource/geist-mono/files/geist-mono-latin-ext-600-normal.woff2";
import geistMonoSymbols400 from "@fontsource/geist-mono/files/geist-mono-symbols2-400-normal.woff2";
import geistMonoSymbols500 from "@fontsource/geist-mono/files/geist-mono-symbols2-500-normal.woff2";
import geistMonoSymbols600 from "@fontsource/geist-mono/files/geist-mono-symbols2-600-normal.woff2";
import geistMonoVietnamese400 from "@fontsource/geist-mono/files/geist-mono-vietnamese-400-normal.woff2";
import geistMonoVietnamese500 from "@fontsource/geist-mono/files/geist-mono-vietnamese-500-normal.woff2";
import geistMonoVietnamese600 from "@fontsource/geist-mono/files/geist-mono-vietnamese-600-normal.woff2";
import ibmPlexMonoCyrillic400 from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-cyrillic-400-normal.woff2";
import ibmPlexMonoCyrillic500 from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-cyrillic-500-normal.woff2";
import ibmPlexMonoCyrillic600 from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-cyrillic-600-normal.woff2";
import ibmPlexMonoCyrillicExt400 from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-cyrillic-ext-400-normal.woff2";
import ibmPlexMonoCyrillicExt500 from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-cyrillic-ext-500-normal.woff2";
import ibmPlexMonoCyrillicExt600 from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-cyrillic-ext-600-normal.woff2";
import ibmPlexMonoLatin400 from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2";
import ibmPlexMonoLatin500 from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2";
import ibmPlexMonoLatin600 from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2";
import ibmPlexMonoLatinExt400 from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-ext-400-normal.woff2";
import ibmPlexMonoLatinExt500 from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-ext-500-normal.woff2";
import ibmPlexMonoLatinExt600 from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-ext-600-normal.woff2";
import ibmPlexMonoVietnamese400 from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-vietnamese-400-normal.woff2";
import ibmPlexMonoVietnamese500 from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-vietnamese-500-normal.woff2";
import ibmPlexMonoVietnamese600 from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-vietnamese-600-normal.woff2";
import jetbrainsMonoCyrillic400 from "@fontsource/jetbrains-mono/files/jetbrains-mono-cyrillic-400-normal.woff2";
import jetbrainsMonoCyrillic500 from "@fontsource/jetbrains-mono/files/jetbrains-mono-cyrillic-500-normal.woff2";
import jetbrainsMonoCyrillic600 from "@fontsource/jetbrains-mono/files/jetbrains-mono-cyrillic-600-normal.woff2";
import jetbrainsMonoCyrillicExt400 from "@fontsource/jetbrains-mono/files/jetbrains-mono-cyrillic-ext-400-normal.woff2";
import jetbrainsMonoCyrillicExt500 from "@fontsource/jetbrains-mono/files/jetbrains-mono-cyrillic-ext-500-normal.woff2";
import jetbrainsMonoCyrillicExt600 from "@fontsource/jetbrains-mono/files/jetbrains-mono-cyrillic-ext-600-normal.woff2";
import jetbrainsMonoGreek400 from "@fontsource/jetbrains-mono/files/jetbrains-mono-greek-400-normal.woff2";
import jetbrainsMonoGreek500 from "@fontsource/jetbrains-mono/files/jetbrains-mono-greek-500-normal.woff2";
import jetbrainsMonoGreek600 from "@fontsource/jetbrains-mono/files/jetbrains-mono-greek-600-normal.woff2";
import jetbrainsMonoLatin400 from "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2";
import jetbrainsMonoLatin500 from "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2";
import jetbrainsMonoLatin600 from "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-600-normal.woff2";
import jetbrainsMonoLatinExt400 from "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-ext-400-normal.woff2";
import jetbrainsMonoLatinExt500 from "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-ext-500-normal.woff2";
import jetbrainsMonoLatinExt600 from "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-ext-600-normal.woff2";
import jetbrainsMonoVietnamese400 from "@fontsource/jetbrains-mono/files/jetbrains-mono-vietnamese-400-normal.woff2";
import jetbrainsMonoVietnamese500 from "@fontsource/jetbrains-mono/files/jetbrains-mono-vietnamese-500-normal.woff2";
import jetbrainsMonoVietnamese600 from "@fontsource/jetbrains-mono/files/jetbrains-mono-vietnamese-600-normal.woff2";
import newsreaderItalicLatin400 from "@fontsource/newsreader/files/newsreader-latin-400-italic.woff2";
import newsreaderItalicLatin500 from "@fontsource/newsreader/files/newsreader-latin-500-italic.woff2";
import newsreaderItalicLatinExt400 from "@fontsource/newsreader/files/newsreader-latin-ext-400-italic.woff2";
import newsreaderItalicLatinExt500 from "@fontsource/newsreader/files/newsreader-latin-ext-500-italic.woff2";
import newsreaderItalicVietnamese400 from "@fontsource/newsreader/files/newsreader-vietnamese-400-italic.woff2";
import newsreaderItalicVietnamese500 from "@fontsource/newsreader/files/newsreader-vietnamese-500-italic.woff2";
import newsreaderLatin400 from "@fontsource/newsreader/files/newsreader-latin-400-normal.woff2";
import newsreaderLatin500 from "@fontsource/newsreader/files/newsreader-latin-500-normal.woff2";
import newsreaderLatin600 from "@fontsource/newsreader/files/newsreader-latin-600-normal.woff2";
import newsreaderLatinExt400 from "@fontsource/newsreader/files/newsreader-latin-ext-400-normal.woff2";
import newsreaderLatinExt500 from "@fontsource/newsreader/files/newsreader-latin-ext-500-normal.woff2";
import newsreaderLatinExt600 from "@fontsource/newsreader/files/newsreader-latin-ext-600-normal.woff2";
import newsreaderVietnamese400 from "@fontsource/newsreader/files/newsreader-vietnamese-400-normal.woff2";
import newsreaderVietnamese500 from "@fontsource/newsreader/files/newsreader-vietnamese-500-normal.woff2";
import newsreaderVietnamese600 from "@fontsource/newsreader/files/newsreader-vietnamese-600-normal.woff2";
import spectralCyrillic400 from "@fontsource/spectral/files/spectral-cyrillic-400-normal.woff2";
import spectralCyrillic500 from "@fontsource/spectral/files/spectral-cyrillic-500-normal.woff2";
import spectralCyrillic600 from "@fontsource/spectral/files/spectral-cyrillic-600-normal.woff2";
import spectralCyrillicExt400 from "@fontsource/spectral/files/spectral-cyrillic-ext-400-normal.woff2";
import spectralCyrillicExt500 from "@fontsource/spectral/files/spectral-cyrillic-ext-500-normal.woff2";
import spectralCyrillicExt600 from "@fontsource/spectral/files/spectral-cyrillic-ext-600-normal.woff2";
import spectralItalicCyrillic400 from "@fontsource/spectral/files/spectral-cyrillic-400-italic.woff2";
import spectralItalicCyrillicExt400 from "@fontsource/spectral/files/spectral-cyrillic-ext-400-italic.woff2";
import spectralItalicLatin400 from "@fontsource/spectral/files/spectral-latin-400-italic.woff2";
import spectralItalicLatinExt400 from "@fontsource/spectral/files/spectral-latin-ext-400-italic.woff2";
import spectralItalicVietnamese400 from "@fontsource/spectral/files/spectral-vietnamese-400-italic.woff2";
import spectralLatin400 from "@fontsource/spectral/files/spectral-latin-400-normal.woff2";
import spectralLatin500 from "@fontsource/spectral/files/spectral-latin-500-normal.woff2";
import spectralLatin600 from "@fontsource/spectral/files/spectral-latin-600-normal.woff2";
import spectralLatinExt400 from "@fontsource/spectral/files/spectral-latin-ext-400-normal.woff2";
import spectralLatinExt500 from "@fontsource/spectral/files/spectral-latin-ext-500-normal.woff2";
import spectralLatinExt600 from "@fontsource/spectral/files/spectral-latin-ext-600-normal.woff2";
import spectralVietnamese400 from "@fontsource/spectral/files/spectral-vietnamese-400-normal.woff2";
import spectralVietnamese500 from "@fontsource/spectral/files/spectral-vietnamese-500-normal.woff2";
import spectralVietnamese600 from "@fontsource/spectral/files/spectral-vietnamese-600-normal.woff2";

// Google Fonts subset unicode-ranges, verbatim from the @fontsource CSS
// (identical across all five families).
const LATIN =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const LATIN_EXT =
  "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";
const CYRILLIC = "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116";
const CYRILLIC_EXT = "U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F";
const GREEK = "U+0370-0377,U+037A-037F,U+0384-038A,U+038C,U+038E-03A1,U+03A3-03FF";
const VIETNAMESE =
  "U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB";
// Geist Mono's box-drawing / punctuation-space subset (no other family ships it).
const SYMBOLS2 = "U+2000-2001,U+2004-2008,U+200A,U+23B8-23BD,U+2500-259F";

function face(
  family: string,
  style: "normal" | "italic",
  weight: number,
  range: string,
  url: string,
): string {
  return `@font-face {
  font-family: "${family}";
  font-style: ${style};
  font-display: swap;
  font-weight: ${weight};
  src: url(${url}) format("woff2");
  unicode-range: ${range};
}`;
}

// Per face, rules follow the @fontsource CSS order: cyrillic-ext, cyrillic,
// (symbols2,) greek, vietnamese, latin-ext, latin. Subsets vary per family —
// Newsreader ships no cyrillic/greek; only JetBrains Mono ships greek; only
// Geist Mono ships symbols2.
const css = [
  // Geist Mono — the interface font + a selectable editor mono (subset order
  // per @fontsource).
  face("Geist Mono", "normal", 400, CYRILLIC_EXT, geistMonoCyrillicExt400),
  face("Geist Mono", "normal", 400, CYRILLIC, geistMonoCyrillic400),
  face("Geist Mono", "normal", 400, SYMBOLS2, geistMonoSymbols400),
  face("Geist Mono", "normal", 400, VIETNAMESE, geistMonoVietnamese400),
  face("Geist Mono", "normal", 400, LATIN_EXT, geistMonoLatinExt400),
  face("Geist Mono", "normal", 400, LATIN, geistMonoLatin400),
  face("Geist Mono", "normal", 500, CYRILLIC_EXT, geistMonoCyrillicExt500),
  face("Geist Mono", "normal", 500, CYRILLIC, geistMonoCyrillic500),
  face("Geist Mono", "normal", 500, SYMBOLS2, geistMonoSymbols500),
  face("Geist Mono", "normal", 500, VIETNAMESE, geistMonoVietnamese500),
  face("Geist Mono", "normal", 500, LATIN_EXT, geistMonoLatinExt500),
  face("Geist Mono", "normal", 500, LATIN, geistMonoLatin500),
  face("Geist Mono", "normal", 600, CYRILLIC_EXT, geistMonoCyrillicExt600),
  face("Geist Mono", "normal", 600, CYRILLIC, geistMonoCyrillic600),
  face("Geist Mono", "normal", 600, SYMBOLS2, geistMonoSymbols600),
  face("Geist Mono", "normal", 600, VIETNAMESE, geistMonoVietnamese600),
  face("Geist Mono", "normal", 600, LATIN_EXT, geistMonoLatinExt600),
  face("Geist Mono", "normal", 600, LATIN, geistMonoLatin600),
  face("Newsreader", "normal", 400, VIETNAMESE, newsreaderVietnamese400),
  face("Newsreader", "normal", 400, LATIN_EXT, newsreaderLatinExt400),
  face("Newsreader", "normal", 400, LATIN, newsreaderLatin400),
  face("Newsreader", "normal", 500, VIETNAMESE, newsreaderVietnamese500),
  face("Newsreader", "normal", 500, LATIN_EXT, newsreaderLatinExt500),
  face("Newsreader", "normal", 500, LATIN, newsreaderLatin500),
  face("Newsreader", "normal", 600, VIETNAMESE, newsreaderVietnamese600),
  face("Newsreader", "normal", 600, LATIN_EXT, newsreaderLatinExt600),
  face("Newsreader", "normal", 600, LATIN, newsreaderLatin600),
  face("Newsreader", "italic", 400, VIETNAMESE, newsreaderItalicVietnamese400),
  face("Newsreader", "italic", 400, LATIN_EXT, newsreaderItalicLatinExt400),
  face("Newsreader", "italic", 400, LATIN, newsreaderItalicLatin400),
  face("Newsreader", "italic", 500, VIETNAMESE, newsreaderItalicVietnamese500),
  face("Newsreader", "italic", 500, LATIN_EXT, newsreaderItalicLatinExt500),
  face("Newsreader", "italic", 500, LATIN, newsreaderItalicLatin500),
  face("Spectral", "normal", 400, CYRILLIC_EXT, spectralCyrillicExt400),
  face("Spectral", "normal", 400, CYRILLIC, spectralCyrillic400),
  face("Spectral", "normal", 400, VIETNAMESE, spectralVietnamese400),
  face("Spectral", "normal", 400, LATIN_EXT, spectralLatinExt400),
  face("Spectral", "normal", 400, LATIN, spectralLatin400),
  face("Spectral", "normal", 500, CYRILLIC_EXT, spectralCyrillicExt500),
  face("Spectral", "normal", 500, CYRILLIC, spectralCyrillic500),
  face("Spectral", "normal", 500, VIETNAMESE, spectralVietnamese500),
  face("Spectral", "normal", 500, LATIN_EXT, spectralLatinExt500),
  face("Spectral", "normal", 500, LATIN, spectralLatin500),
  face("Spectral", "normal", 600, CYRILLIC_EXT, spectralCyrillicExt600),
  face("Spectral", "normal", 600, CYRILLIC, spectralCyrillic600),
  face("Spectral", "normal", 600, VIETNAMESE, spectralVietnamese600),
  face("Spectral", "normal", 600, LATIN_EXT, spectralLatinExt600),
  face("Spectral", "normal", 600, LATIN, spectralLatin600),
  face("Spectral", "italic", 400, CYRILLIC_EXT, spectralItalicCyrillicExt400),
  face("Spectral", "italic", 400, CYRILLIC, spectralItalicCyrillic400),
  face("Spectral", "italic", 400, VIETNAMESE, spectralItalicVietnamese400),
  face("Spectral", "italic", 400, LATIN_EXT, spectralItalicLatinExt400),
  face("Spectral", "italic", 400, LATIN, spectralItalicLatin400),
  face("IBM Plex Mono", "normal", 400, CYRILLIC_EXT, ibmPlexMonoCyrillicExt400),
  face("IBM Plex Mono", "normal", 400, CYRILLIC, ibmPlexMonoCyrillic400),
  face("IBM Plex Mono", "normal", 400, VIETNAMESE, ibmPlexMonoVietnamese400),
  face("IBM Plex Mono", "normal", 400, LATIN_EXT, ibmPlexMonoLatinExt400),
  face("IBM Plex Mono", "normal", 400, LATIN, ibmPlexMonoLatin400),
  face("IBM Plex Mono", "normal", 500, CYRILLIC_EXT, ibmPlexMonoCyrillicExt500),
  face("IBM Plex Mono", "normal", 500, CYRILLIC, ibmPlexMonoCyrillic500),
  face("IBM Plex Mono", "normal", 500, VIETNAMESE, ibmPlexMonoVietnamese500),
  face("IBM Plex Mono", "normal", 500, LATIN_EXT, ibmPlexMonoLatinExt500),
  face("IBM Plex Mono", "normal", 500, LATIN, ibmPlexMonoLatin500),
  face("IBM Plex Mono", "normal", 600, CYRILLIC_EXT, ibmPlexMonoCyrillicExt600),
  face("IBM Plex Mono", "normal", 600, CYRILLIC, ibmPlexMonoCyrillic600),
  face("IBM Plex Mono", "normal", 600, VIETNAMESE, ibmPlexMonoVietnamese600),
  face("IBM Plex Mono", "normal", 600, LATIN_EXT, ibmPlexMonoLatinExt600),
  face("IBM Plex Mono", "normal", 600, LATIN, ibmPlexMonoLatin600),
  face("JetBrains Mono", "normal", 400, CYRILLIC_EXT, jetbrainsMonoCyrillicExt400),
  face("JetBrains Mono", "normal", 400, CYRILLIC, jetbrainsMonoCyrillic400),
  face("JetBrains Mono", "normal", 400, GREEK, jetbrainsMonoGreek400),
  face("JetBrains Mono", "normal", 400, VIETNAMESE, jetbrainsMonoVietnamese400),
  face("JetBrains Mono", "normal", 400, LATIN_EXT, jetbrainsMonoLatinExt400),
  face("JetBrains Mono", "normal", 400, LATIN, jetbrainsMonoLatin400),
  face("JetBrains Mono", "normal", 500, CYRILLIC_EXT, jetbrainsMonoCyrillicExt500),
  face("JetBrains Mono", "normal", 500, CYRILLIC, jetbrainsMonoCyrillic500),
  face("JetBrains Mono", "normal", 500, GREEK, jetbrainsMonoGreek500),
  face("JetBrains Mono", "normal", 500, VIETNAMESE, jetbrainsMonoVietnamese500),
  face("JetBrains Mono", "normal", 500, LATIN_EXT, jetbrainsMonoLatinExt500),
  face("JetBrains Mono", "normal", 500, LATIN, jetbrainsMonoLatin500),
  face("JetBrains Mono", "normal", 600, CYRILLIC_EXT, jetbrainsMonoCyrillicExt600),
  face("JetBrains Mono", "normal", 600, CYRILLIC, jetbrainsMonoCyrillic600),
  face("JetBrains Mono", "normal", 600, GREEK, jetbrainsMonoGreek600),
  face("JetBrains Mono", "normal", 600, VIETNAMESE, jetbrainsMonoVietnamese600),
  face("JetBrains Mono", "normal", 600, LATIN_EXT, jetbrainsMonoLatinExt600),
  face("JetBrains Mono", "normal", 600, LATIN, jetbrainsMonoLatin600),
].join("\n");

const styleEl = document.createElement("style");
styleEl.textContent = css;
document.head.appendChild(styleEl);
