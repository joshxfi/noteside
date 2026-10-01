// code-highlight.ts — incremental lowlight decorations for code blocks.
//
// The stock CodeBlockLowlight plugin walked the whole document twice
// (findChildren on the old AND new doc) on EVERY transaction — caret moves
// included — and on any edit inside a code block re-highlighted EVERY code
// block in the note. On a long note that was most of the per-keystroke cost.
// This plugin keeps the set mapped through each transaction and re-highlights
// only the code blocks a step touched (exact: a block's highlighting depends
// on nothing but its own text and language, so an untouched block's mapped
// decorations equal fresh ones — `code-highlight.test.ts` pins
// `incremental === full rebuild` under a fuzz). Selection-only transactions
// return the previous set untouched.
//
// A grammar landing refreshes through code-block.ts's meta-only transaction
// (`codeHighlightKey` meta), which rebuilds the whole set once.
import { getChangedRanges } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import highlight from "highlight.js/lib/core";
import type { createLowlight } from "lowlight";

type Lowlight = ReturnType<typeof createLowlight>;
type HastNode = {
  type: string;
  value?: string;
  children?: HastNode[];
  properties?: { className?: string[] };
};

export const codeHighlightKey = new PluginKey<DecorationSet>("nsCodeHighlight");

function flatten(
  nodes: HastNode[],
  className: string[] = [],
): { text: string; classes: string[] }[] {
  return nodes.flatMap((node) => {
    const classes = [...className, ...(node.properties?.className ?? [])];
    if (node.children) return flatten(node.children, classes);
    return { text: node.value ?? "", classes };
  });
}

/** One block's decorations — the stock plugin's per-block logic, verbatim in
 *  behavior (explicit language when registered anywhere, else auto-detect). */
function blockDecorations(
  node: PMNode,
  pos: number,
  lowlight: Lowlight,
  defaultLanguage: string | null,
): Decoration[] {
  const language = (node.attrs.language as string | null) || defaultLanguage;
  const known =
    !!language &&
    (lowlight.listLanguages().includes(language) ||
      !!highlight.getLanguage(language) ||
      lowlight.registered(language));
  const tree = known
    ? lowlight.highlight(language, node.textContent)
    : lowlight.highlightAuto(node.textContent);
  const out: Decoration[] = [];
  let from = pos + 1;
  for (const leaf of flatten(tree.children as HastNode[])) {
    const to = from + leaf.text.length;
    if (leaf.classes.length)
      out.push(Decoration.inline(from, to, { class: leaf.classes.join(" ") }));
    from = to;
  }
  return out;
}

/** Every code block, from scratch — the reference the incremental path must
 *  equal, and the plugin's init. */
export function fullHighlight(
  doc: PMNode,
  typeName: string,
  lowlight: Lowlight,
  defaultLanguage: string | null = null,
): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== typeName) return true;
    decos.push(...blockDecorations(node, pos, lowlight, defaultLanguage));
    return false;
  });
  return DecorationSet.create(doc, decos);
}

export function codeHighlightPlugin(opts: {
  typeName: string;
  lowlight: Lowlight;
  defaultLanguage?: string | null;
}): Plugin<DecorationSet> {
  const { typeName, lowlight } = opts;
  const defaultLanguage = opts.defaultLanguage ?? null;
  return new Plugin<DecorationSet>({
    key: codeHighlightKey,
    state: {
      init: (_, { doc }) => fullHighlight(doc, typeName, lowlight, defaultLanguage),
      apply(tr, prev) {
        // A grammar landed (code-block.ts): unlabeled blocks may auto-detect
        // differently now, so rebuild everything once.
        if (tr.getMeta(codeHighlightKey)) {
          return fullHighlight(tr.doc, typeName, lowlight, defaultLanguage);
        }
        if (!tr.docChanged) return prev;
        let set = prev.map(tr.mapping, tr.doc);
        // Every TEXTBLOCK overlapping a changed range (widened by one so a
        // change flush against a block's edge still counts), each once — not
        // just code blocks: a join can carry highlighted code text into a
        // paragraph, and its mapped decorations must go.
        const touched = new Map<number, PMNode>();
        const size = tr.doc.content.size;
        for (const { newRange } of getChangedRanges(tr)) {
          const from = Math.max(0, newRange.from - 1);
          const to = Math.min(size, newRange.to + 1);
          tr.doc.nodesBetween(from, to, (node, pos) => {
            if (!node.isTextblock) return true;
            touched.set(pos, node);
            return false;
          });
        }
        for (const [pos, node] of touched) {
          set = set.remove(set.find(pos, pos + node.nodeSize));
          if (node.type.name === typeName) {
            set = set.add(tr.doc, blockDecorations(node, pos, lowlight, defaultLanguage));
          }
        }
        return set;
      },
    },
    props: {
      decorations: (state) => codeHighlightKey.getState(state),
    },
  });
}
