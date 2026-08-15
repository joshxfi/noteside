// pm-doc.ts — adapters that let the CM-era delta word counter (word-count.ts,
// structurally typed on DocLike/ChangesLike) run over ProseMirror documents.
//
// The "line" unit becomes the enclosing TEXTBLOCK: textBetween renders a block
// boundary as "\n" and a leaf atom as " ", both whitespace, so the word-count
// proof ("no word can straddle a line boundary") holds verbatim for blocks. A
// position that is not inside a textblock (between blocks, inside table
// structure) expands to nothing — the boundary itself contributes only
// separators, and any text a change touched is still covered by the raw range.
//
// Multi-step transactions are counted STEP BY STEP against tr.docs[i], so each
// StepMap's coordinates are exact in their own before/after docs — no cross-step
// position mapping, and word-count.ts is reused unchanged per step.
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { countWordsIn, type DocLike, wordCountDelta } from "./word-count";

/** Block boundaries render as newlines, leaf atoms as a space — both whitespace,
 *  and stable between full counts and delta slices. */
const BLOCK_SEP = "\n";
const LEAF = " ";

/** Wrap a PM document (immutable) in the word counter's DocLike shape. */
export function pmDoc(doc: PMNode): DocLike {
  const size = doc.content.size;
  const clamp = (pos: number) => Math.max(0, Math.min(pos, size));
  return {
    lineAt(pos) {
      const p = clamp(pos);
      const $p = doc.resolve(p);
      if ($p.parent.isTextblock) return { from: $p.start(), to: $p.end() };
      return { from: p, to: p };
    },
    sliceString(from, to) {
      return doc.textBetween(clamp(from), clamp(to), BLOCK_SEP, LEAF);
    },
  };
}

/** Full word count of a PM document — the mount-time seed. */
export function docWordCount(doc: PMNode): number {
  return countWordsIn(doc.textBetween(0, doc.content.size, BLOCK_SEP, LEAF));
}

/** How much a transaction shifts the word count. O(changed blocks), not O(doc). */
export function transactionWordDelta(tr: Transaction): number {
  let delta = 0;
  for (let i = 0; i < tr.steps.length; i++) {
    const before = tr.docs[i];
    const after = i + 1 < tr.docs.length ? tr.docs[i + 1] : tr.doc;
    const map = tr.steps[i].getMap();
    delta += wordCountDelta(
      { iterChanges: (f) => map.forEach((fromA, toA, fromB, toB) => f(fromA, toA, fromB, toB)) },
      pmDoc(before),
      pmDoc(after),
    );
  }
  return delta;
}
