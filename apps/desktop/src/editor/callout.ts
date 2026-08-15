// callout.ts — Notion-style callouts stored as GFM alerts, the blockquote
// convention GitHub renders (`> [!NOTE]` … `> [!CAUTION]`). Degrades to a
// plain quote in any other markdown app, which is exactly why it's the
// chosen on-disk form.
//
// priority 110 > Blockquote's default: markdown token handlers run in
// extension-priority order, so this one sees every `blockquote` token first,
// claims the alert-marked ones, and passes the rest through (empty array =
// "not handled") to the stock blockquote.
import { Node } from "@tiptap/core";

export const CALLOUT_KINDS = ["note", "tip", "important", "warning", "caution"] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];

const MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/;

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  priority: 110,

  addAttributes() {
    return { kind: { default: "note" } };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-callout]",
        getAttrs: (el) => ({ kind: (el as HTMLElement).dataset.callout }),
      },
    ];
  },

  renderHTML({ node }) {
    const kind = node.attrs.kind as string;
    return ["div", { "data-callout": kind, class: "av-callout" }, 0];
  },

  markdownTokenName: "blockquote",

  parseMarkdown(token, h) {
    const inner = token.tokens ?? [];
    const first = inner[0];
    // The marker must open the quote's first paragraph, GitHub's rule.
    const firstText = first?.type === "paragraph" ? String(first.text ?? "") : "";
    const match = firstText.match(MARKER);
    if (!match) return []; // plain quote — next handler's business
    const kind = match[1].toLowerCase() as CalloutKind;

    // Re-lex the first paragraph without the marker so its inline content
    // parses normally; an empty remainder drops the paragraph entirely.
    const rest = firstText.replace(MARKER, "");
    const restTokens = rest.trim() && h.tokenizeInline ? h.tokenizeInline(rest) : null;
    const content = [
      ...(restTokens ? [{ type: "paragraph", content: h.parseInline(restTokens) }] : []),
      ...h.parseChildren(inner.slice(1)),
    ];
    return h.createNode(
      "callout",
      { kind },
      content.length ? content : [{ type: "paragraph", content: [] }],
    );
  },

  renderMarkdown(node, h) {
    // Claiming the `blockquote` token slot makes this the renderer for BOTH
    // node types (the manager resolves renderers through the token registry,
    // where this spec sorts first) — so plain blockquotes are rendered here
    // too, in their ordinary form.
    const body = h.renderChildren(node.content ?? [], "\n\n");
    const lead =
      node.type === "callout"
        ? `[!${((node.attrs?.kind as string) ?? "note").toUpperCase()}]\n`
        : "";
    return (lead + body)
      .split("\n")
      .map((line) => (line ? `> ${line}` : ">"))
      .join("\n");
  },
});
