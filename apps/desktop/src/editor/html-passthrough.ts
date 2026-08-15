// html-passthrough.ts — verbatim preservation for raw HTML BLOCKS in notes.
//
// Without this, @tiptap/markdown's fallback turns a `<div>…</div>` or
// `<details>` block into literal text whose `<`/`>` the serializer then
// entity-escapes — the note visibly corrupts on first edit (the top data-loss
// risk of the markdown round-trip). This node intercepts marked's block-level
// `html` tokens, holds the raw source verbatim, renders it as an opaque
// read-only source chip (never executed — textContent, not innerHTML), and
// serializes it back byte-identically.
//
// INLINE html (`<kbd>x</kbd>` inside a paragraph) cannot be intercepted — the
// markdown manager special-cases inline html tokens before extension handlers
// run. In the app (DOMParser available) recognized inline tags degrade to
// their equivalent marks; unrecognized ones become escaped text. Pinned as a
// documented lossy case in round-trip.test.ts; a custom marked tokenizer is
// the v2 path if it ever matters.
import { Node } from "@tiptap/core";

export const HtmlBlock = Node.create({
  name: "htmlBlock",
  group: "block",
  atom: true,
  defining: true,

  addAttributes() {
    return { content: { default: "" } };
  },

  parseHTML() {
    // In-app clipboard round-trip only; disk content never goes through this.
    return [
      {
        tag: "pre[data-ns-html-block]",
        getAttrs: (el) => ({ content: (el as HTMLElement).textContent ?? "" }),
      },
    ];
  },

  renderHTML({ node }) {
    // The SOURCE as text — executing arbitrary note HTML inside the editor is
    // a layout/XSS hazard with no upside for a notes app.
    return [
      "pre",
      { "data-ns-html-block": "", class: "av-htmlblock" },
      node.attrs.content as string,
    ];
  },

  markdownTokenName: "html",

  parseMarkdown(token) {
    // An empty array means "not handled — try the next handler" to the manager;
    // inline html is not ours (see header).
    if (!token.block) return [];
    const raw = String(token.raw ?? token.text ?? "");
    if (!raw.trim()) return [];
    // marked's block token carries its trailing blank line; the serializer
    // re-adds block separation, so store without it.
    return { type: "htmlBlock", attrs: { content: raw.replace(/\n+$/, "") } };
  },

  renderMarkdown(node) {
    return (node.attrs?.content as string) ?? "";
  },
});
