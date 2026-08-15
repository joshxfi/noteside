// Drives the delta counter with REAL ProseMirror docs/transactions through the
// pm-doc.ts adapters (prosemirror-model/state are pure JS — no DOM — so they
// load fine in the node test env, the same precedent @codemirror/state set).
// The contract under test is unchanged from the CM era: `total +
// transactionWordDelta(tr)` never diverges from a full rescan of the new doc.
import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import type { Node as PMNode } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import { countWordsIn } from "./word-count";
import { docWordCount, transactionWordDelta } from "./pm-doc";

const schema = getSchema([StarterKit]);

/** One paragraph per entry — the block-editor analogue of "one line per entry". */
function docOf(paragraphs: string[]): PMNode {
  return schema.node(
    "doc",
    null,
    paragraphs.map((p) => schema.node("paragraph", null, p ? [schema.text(p)] : [])),
  );
}

/** Build a transaction over `doc`, return the delta alongside the exact totals. */
function apply(doc: PMNode, f: (tr: Transaction) => void) {
  const state = EditorState.create({ schema, doc });
  const tr = state.tr;
  f(tr);
  return {
    delta: transactionWordDelta(tr),
    exactBefore: docWordCount(doc),
    exactAfter: docWordCount(tr.doc),
    after: tr.doc,
  };
}

/** The invariant: the delta reproduces a full rescan of the new document. */
function expectExact(r: ReturnType<typeof apply>) {
  expect(r.exactBefore + r.delta).toBe(r.exactAfter);
}

describe("countWordsIn", () => {
  it("counts runs of non-whitespace", () => {
    expect(countWordsIn("")).toBe(0);
    expect(countWordsIn("   \n\t ")).toBe(0);
    expect(countWordsIn("one")).toBe(1);
    expect(countWordsIn("  leading and trailing  ")).toBe(3);
    expect(countWordsIn("a\nb\nc")).toBe(3);
  });

  it("is line-ending agnostic, so CRLF source matches the normalized doc", () => {
    expect(countWordsIn("a b\r\nc d")).toBe(countWordsIn("a b\nc d"));
  });

  it("is not left stateful by a previous call (the regex is module-level)", () => {
    expect(countWordsIn("a b c")).toBe(3);
    expect(countWordsIn("a b c")).toBe(3);
  });
});

describe("docWordCount", () => {
  it("treats block boundaries as whitespace", () => {
    expect(docWordCount(docOf(["a b", "c d"]))).toBe(4);
    expect(docWordCount(docOf(["", ""]))).toBe(0);
    expect(docWordCount(docOf(["one"]))).toBe(1);
  });
});

describe("transactionWordDelta", () => {
  it("is zero for a change that neither adds nor removes a word", () => {
    // First paragraph content starts at pos 1: "a b" → "a bx".
    const r = apply(docOf(["a b", "c d"]), (tr) => tr.insertText("x", 4, 4));
    expect(r.delta).toBe(0);
    expectExact(r);
  });

  it("counts a word split by an inserted space", () => {
    const r = apply(docOf(["ab"]), (tr) => tr.insertText(" ", 2, 2));
    expect(r.delta).toBe(1);
    expectExact(r);
  });

  it("counts words joined by deleting the boundary between two paragraphs", () => {
    // "a b" | "c d" = 4 words; joining fuses "b" and "c" into "bc" → 3.
    const doc = docOf(["a b", "c d"]);
    // Delete from before "b"’s end boundary to after "c"’s start: [4, 7) spans
    // the paragraph break (paragraph 1 is positions 0..5, paragraph 2 starts at 5).
    const r = apply(doc, (tr) => tr.delete(4, 7));
    expect(r.delta).toBe(-1);
    expectExact(r);
  });

  it("counts a paragraph split through the middle of a word", () => {
    const r = apply(docOf(["onetwo"]), (tr) => tr.split(4));
    expect(r.delta).toBe(1);
    expectExact(r);
  });

  it("counts a multi-paragraph paste", () => {
    const r = apply(docOf(["intro"]), (tr) =>
      tr.insert(7, [docOf(["one two"]).child(0), docOf(["three"]).child(0)]),
    );
    expect(r.delta).toBe(3);
    expectExact(r);
  });

  it("counts a multi-paragraph deletion", () => {
    const doc = docOf(["keep", "one two", "three", "keep"]);
    // Remove the two middle paragraph nodes wholesale.
    const from = 6; // end of "keep" paragraph (node spans 0..6)
    const to = 6 + 9 + 7; // + "one two" node (9) + "three" node (7)
    const r = apply(doc, (tr) => tr.delete(from, to));
    expect(r.delta).toBe(-3);
    expectExact(r);
  });

  it("handles several edits in ONE transaction (per-step docs keep coords exact)", () => {
    const r = apply(docOf(["one two three"]), (tr) => {
      tr.insertText("1", 1, 4); // "one" → "1"
      tr.insertText("3", 7, 12); // "three" → "3" (post-step coords)
    });
    expect(r.delta).toBe(0);
    expectExact(r);
  });

  it("handles edits at the very start and end of the document", () => {
    expectExact(apply(docOf(["a b c"]), (tr) => tr.insertText("x ", 1, 1)));
    expectExact(apply(docOf(["a b c"]), (tr) => tr.insertText(" x", 6, 6)));
    expectExact(apply(docOf(["a b c"]), (tr) => tr.delete(1, 6)));
  });

  it("stays exact across a long randomized edit sequence", () => {
    // Deterministic LCG — the fuzz has to reproduce on CI, not vary per run.
    let seed = 0x2f6e2b1;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const alphabet = ["a", "bb", " ", "  ", "cc dd", "e"];

    let state = EditorState.create({ schema, doc: docOf(["seed text", "second line", "third"]) });
    let running = docWordCount(state.doc);

    for (let i = 0; i < 400; i++) {
      const tr = state.tr;
      const size = tr.doc.content.size;
      const from = rnd(size + 1);
      const to = Math.min(size, from + rnd(6));
      try {
        if (rnd(8) === 0) {
          tr.split(Math.max(1, Math.min(size - 1, from)));
        } else if (rnd(3) === 0) {
          tr.delete(from, to);
        } else {
          tr.insertText(alphabet[rnd(alphabet.length)], from, to);
        }
      } catch {
        continue; // invalid position for this op — skip, determinism holds
      }
      running += transactionWordDelta(tr);
      state = state.apply(tr);
      expect(running).toBe(docWordCount(state.doc));
    }
  });

  it("stays exact when one transaction carries many scattered edits", () => {
    let state = EditorState.create({
      schema,
      doc: docOf(Array.from({ length: 40 }, (_, i) => `line ${i} of text`)),
    });
    let running = docWordCount(state.doc);
    for (let round = 0; round < 10; round++) {
      const tr = state.tr;
      // Every third paragraph, back-to-front so positions stay valid per step.
      for (let n = tr.doc.childCount - 1; n >= 0; n -= 3) {
        let pos = 0;
        for (let k = 0; k < n; k++) pos += tr.doc.child(k).nodeSize;
        const node = tr.doc.child(n);
        if (round % 2) tr.insertText("x y z", pos + 1, pos + node.nodeSize - 1);
        else tr.delete(pos + 1, pos + node.nodeSize - 1);
      }
      running += transactionWordDelta(tr);
      state = state.apply(tr);
      expect(running).toBe(docWordCount(state.doc));
    }
  });
});
