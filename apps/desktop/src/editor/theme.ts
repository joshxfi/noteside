import { HighlightStyle } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

// A single theme that reads the app's design tokens (CSS custom properties), so
// it follows light/dark + accent/font changes at runtime with no rebuild.
export const nsTheme = EditorView.theme({
  "&": { color: "var(--ink)", backgroundColor: "var(--paper)", height: "100%" },
  ".cm-scroller": {
    fontFamily: "var(--editor-font)",
    fontSize: "var(--editor-size)",
    lineHeight: "var(--editor-lh)",
    overflow: "auto",
  },
  ".cm-content": {
    caretColor: "var(--accent)",
    maxWidth: "760px",
    margin: "0 auto",
    padding: "40px 24px 36vh",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  // vim's block ("fat") cursor in normal/visual mode
  ".cm-fat-cursor": { background: "var(--accent)", color: "var(--accent-ink)" },
  "&:not(.cm-focused) .cm-fat-cursor": {
    background: "transparent",
    outline: "1px solid var(--accent)",
    color: "inherit",
  },
  ".cm-activeLine": { backgroundColor: "var(--active-line)" },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: "var(--accent)",
    fontWeight: "600",
  },
  ".cm-gutters": {
    backgroundColor: "var(--paper)",
    color: "var(--ink-soft)",
    border: "none",
    fontFamily: "var(--mono)",
    fontSize: "calc(var(--editor-size) * 0.8)",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 16px", minWidth: "36px" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "var(--sel)",
  },
  ".cm-content ::selection": { backgroundColor: "var(--sel)" },
  // vim hlsearch matches
  ".cm-searchMatch": {
    backgroundColor: "color-mix(in oklab, var(--accent), transparent 62%)",
    borderRadius: "2px",
  },
  ".cm-searchMatch-selected": {
    backgroundColor: "color-mix(in oklab, var(--accent), transparent 35%)",
  },
  // vim command line (the transient `:` / `/` panel)
  ".cm-panels": {
    backgroundColor: "var(--paper-2)",
    color: "var(--ink-soft)",
    borderTop: "1px solid var(--rule-soft)",
  },
  ".cm-vim-panel": {
    padding: "0 18px",
    height: "30px",
    display: "flex",
    alignItems: "center",
    fontFamily: "var(--mono)",
    fontSize: "12.5px",
    color: "var(--ink)",
  },
  ".cm-vim-panel input": {
    fontFamily: "var(--mono)",
    fontSize: "12.5px",
    color: "var(--ink)",
    backgroundColor: "transparent",
    border: "none",
    outline: "none",
    width: "100%",
  },
});

// Markdown syntax highlighting tuned to the warm palette. Markup punctuation
// (#, *, -, ```) is dimmed; headings and links take the accent.
export const noteHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.5em", fontWeight: "600", color: "var(--accent)" },
  { tag: t.heading2, fontSize: "1.3em", fontWeight: "600", color: "var(--accent)" },
  { tag: t.heading3, fontSize: "1.15em", fontWeight: "600", color: "var(--accent)" },
  { tag: t.heading, fontWeight: "600", color: "var(--accent)" },
  { tag: t.strong, fontWeight: "700", color: "var(--ink)" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "var(--accent)", textDecoration: "underline" },
  { tag: t.url, color: "var(--ink-faint)" },
  { tag: [t.monospace], fontFamily: "var(--mono)", color: "var(--ink-soft)" },
  { tag: t.quote, color: "var(--ink-soft)", fontStyle: "italic" },
  { tag: t.list, color: "var(--ink-soft)" },
  { tag: [t.processingInstruction, t.contentSeparator], color: "var(--ink-faint)" },
]);
