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
  // When the editor is blurred — e.g. while a command line, finder, or palette has
  // focus — hide the block cursor entirely (no hollow outline) so nothing lingers
  // in the page during a command.
  "&:not(.cm-focused) .cm-fat-cursor": { display: "none" },
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
  // CM6's baseTheme sets the FOCUSED selection color (#d7d4f0) via a high-specificity
  // selector (&light.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground).
  // This theme never declares `dark`, so CM applies its *light* default in BOTH app
  // themes — a light-lavender block that outranks a plain rule and washes out the text.
  // !important makes our theme-aware --sel token win regardless of CM's selector.
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "var(--sel) !important",
  },
  // With drawSelection active, the drawn layer above IS the selection; keep the native
  // selection transparent everywhere in the content so the browser default can't bleed.
  ".cm-content::selection, .cm-content ::selection, .cm-line::selection, .cm-line ::selection": {
    backgroundColor: "transparent",
  },
  // vim hlsearch matches
  ".cm-searchMatch": {
    backgroundColor: "color-mix(in oklab, var(--accent), transparent 62%)",
    borderRadius: "2px",
  },
  ".cm-searchMatch-selected": {
    backgroundColor: "color-mix(in oklab, var(--accent), transparent 35%)",
  },
  // [[wikilinks]]
  ".cm-wikilink": {
    color: "var(--accent)",
    textDecoration: "underline",
    textDecorationColor: "color-mix(in oklab, var(--accent), transparent 55%)",
    textUnderlineOffset: "3px",
  },
  // The "clickable" affordance is only true while Mod is held (Mod-click opens),
  // so surface the pointer cursor + brighter underline only then.
  "&.cm-mod-active .cm-wikilink": {
    cursor: "pointer",
    textDecorationColor: "var(--accent)",
  },
  // ── markdown live-preview rendering ──────────────────────────────────
  // rendered pipe tables (block-preview.ts widget)
  ".cm-mdtable-wrap": {
    overflowX: "auto",
    padding: "4px 0",
  },
  ".cm-mdtable": {
    borderCollapse: "collapse",
    fontSize: "0.9em",
    lineHeight: "1.55",
  },
  ".cm-mdtable th, .cm-mdtable td": {
    border: "1px solid var(--rule)",
    padding: "4px 12px",
    textAlign: "left",
    verticalAlign: "top",
  },
  ".cm-mdtable th": {
    backgroundColor: "var(--paper-2)",
    fontWeight: "600",
  },
  ".cm-mdtable-code": {
    fontFamily: "var(--mono)",
    fontSize: "0.88em",
    color: "var(--ink-soft)",
    backgroundColor: "color-mix(in oklab, var(--ink) 7%, transparent)",
    borderRadius: "4px",
    padding: "1px 5px",
  },
  ".cm-mdtable-more": {
    fontFamily: "var(--mono)",
    fontSize: "0.75em",
    color: "var(--ink-faint)",
    padding: "2px 4px",
  },
  // list bullets + task checkboxes (live-preview.ts widgets)
  ".cm-list-bullet": { color: "var(--ink-faint)" },
  ".cm-task-box": {
    accentColor: "var(--accent)",
    width: "0.85em",
    height: "0.85em",
    margin: "0",
    verticalAlign: "baseline",
    cursor: "pointer",
  },
  ".cm-task-done": {
    color: "var(--ink-faint)",
    textDecoration: "line-through",
    textDecorationColor: "color-mix(in oklab, var(--ink-faint), transparent 40%)",
  },
  // inline code chips
  ".cm-inline-code": {
    backgroundColor: "color-mix(in oklab, var(--ink) 7%, transparent)",
    borderRadius: "4px",
    padding: "1px 4px",
  },
  // fenced code blocks: whole-line styling from block-preview.ts. Vertical
  // padding is deliberately absent (line decorations must not change height);
  // the fence lines themselves act as the block's slim top/bottom caps.
  ".cm-codeblock": {
    fontFamily: "var(--mono)",
    fontSize: "calc(var(--editor-size) * 0.82)",
    backgroundColor: "color-mix(in oklab, var(--ink) 5%, transparent)",
    padding: "0 14px",
  },
  ".cm-codeblock-first": { borderRadius: "8px 8px 0 0", position: "relative" },
  ".cm-codeblock-last": { borderRadius: "0 0 8px 8px" },
  ".cm-code-lang": {
    color: "var(--ink-faint)",
    fontSize: "0.85em",
    letterSpacing: "0.06em",
  },
  ".cm-code-copy": {
    position: "absolute",
    right: "8px",
    top: "50%",
    transform: "translateY(-50%)",
    fontFamily: "var(--mono)",
    fontSize: "10px",
    color: "var(--ink-faint)",
    backgroundColor: "transparent",
    border: "1px solid var(--rule)",
    borderRadius: "5px",
    padding: "1px 7px",
    cursor: "pointer",
    opacity: "0.65",
  },
  ".cm-code-copy:hover": { opacity: "1", color: "var(--ink)" },
  ".cm-code-copy.is-copied": { color: "var(--accent)", borderColor: "var(--accent)", opacity: "1" },
  // blockquotes: the `>` marks hide in preview; the bar carries the meaning
  ".cm-blockquote": {
    borderLeft: "2px solid color-mix(in oklab, var(--accent), transparent 45%)",
    paddingLeft: "12px",
  },
  // horizontal rules: the widget spans the content width inside a normal line
  ".cm-hr": {
    display: "inline-block",
    width: "100%",
    height: "2px",
    verticalAlign: "middle",
    borderTop: "1px solid var(--rule)",
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
  // in-note search panel (@codemirror/search), shown at the top via search({ top: true })
  ".cm-panels.cm-panels-top": {
    borderTop: "none",
    borderBottom: "1px solid var(--rule-soft)",
  },
  ".cm-panel.cm-search": {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "8px",
    padding: "7px 14px",
    fontFamily: "var(--mono)",
    fontSize: "12px",
  },
  ".cm-search .cm-textfield": {
    fontFamily: "var(--mono)",
    fontSize: "12px",
    color: "var(--ink)",
    backgroundColor: "var(--paper)",
    border: "1px solid var(--rule)",
    borderRadius: "6px",
    padding: "3px 8px",
    outline: "none",
  },
  ".cm-search .cm-button": {
    fontFamily: "var(--mono)",
    fontSize: "11px",
    color: "var(--ink-soft)",
    backgroundColor: "var(--paper)",
    backgroundImage: "none",
    border: "1px solid var(--rule)",
    borderRadius: "6px",
    padding: "3px 9px",
    cursor: "pointer",
  },
  ".cm-search .cm-button:hover": {
    backgroundColor: "var(--paper-3)",
    color: "var(--ink)",
  },
  ".cm-search label": {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    fontSize: "11px",
    color: "var(--ink-faint)",
  },
  ".cm-search [name=close]": {
    color: "var(--ink-faint)",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    fontSize: "16px",
    padding: "0 4px",
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
  // Fenced-code token colors (codeLanguages). Deliberately restrained — themes
  // only own the base tokens (base16 syntax slots are a v2), so code reads as
  // a quiet two-tone: accent keywords, soft strings, faint comments.
  { tag: t.comment, color: "var(--ink-faint)", fontStyle: "italic" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "var(--ink-soft)" },
  {
    tag: [t.keyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword],
    color: "var(--accent)",
  },
  {
    tag: [t.number, t.bool, t.atom, t.null],
    color: "color-mix(in oklab, var(--accent), var(--ink) 45%)",
  },
  {
    tag: [t.typeName, t.className, t.function(t.variableName), t.function(t.propertyName)],
    fontWeight: "600",
  },
]);
