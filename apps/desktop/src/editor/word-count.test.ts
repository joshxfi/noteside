// Drives the delta counter with REAL ChangeSet/Text values (@codemirror/state is
// pure JS — no DOM — so it loads fine in the node test env). The contract under
// test is that `total + wordCountDelta(...)` never diverges from a full rescan.
import { describe, expect, it } from "vitest";
import { ChangeSet, type ChangeSpec, Text } from "@codemirror/state";
import { countWordsIn, wordCountDelta } from "./word-count";

/** Apply `spec` to `text` and return the delta alongside the exact totals. */
function apply(lines: string[], spec: ChangeSpec) {
  const before = Text.of(lines);
  const changes = ChangeSet.of(spec, before.length);
  const after = changes.apply(before);
  return {
    delta: wordCountDelta(changes, before, after),
    exactBefore: countWordsIn(before.toString()),
    exactAfter: countWordsIn(after.toString()),
    after: after.toString(),
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

  it("is line-ending agnostic, so CRLF source matches the CRLF→LF normalized doc", () => {
    expect(countWordsIn("a b\r\nc d")).toBe(countWordsIn("a b\nc d"));
  });

  it("is not left stateful by a previous call (the regex is module-level)", () => {
    expect(countWordsIn("a b c")).toBe(3);
    expect(countWordsIn("a b c")).toBe(3);
  });
});

describe("wordCountDelta", () => {
  it("is zero for a change that neither adds nor removes a word", () => {
    const r = apply(["a b", "c d"], { from: 3, to: 3, insert: "x" }); // "a b" → "a bx"
    expect(r.delta).toBe(0);
    expectExact(r);
  });

  it("counts a word split by an inserted space", () => {
    const r = apply(["ab"], { from: 1, to: 1, insert: " " });
    expect(r.delta).toBe(1);
    expectExact(r);
  });

  it("counts words joined by deleting the newline between two lines", () => {
    // "a b" + "c d" = 4 words; "b" and "c" fuse into "bc", so one word is lost.
    const r = apply(["a b", "c d"], { from: 3, to: 4 });
    expect(r.after).toBe("a bc d");
    expect(r.delta).toBe(-1);
    expectExact(r);
  });

  it("counts a multi-line paste", () => {
    const r = apply(["intro"], { from: 5, to: 5, insert: "\none two\nthree" });
    expect(r.delta).toBe(3);
    expectExact(r);
  });

  it("counts a multi-line deletion", () => {
    // Drops the two middle lines whole: "keep\nkeep" is left.
    const r = apply(["keep", "one two", "three", "keep"], { from: 4, to: 18 });
    expect(r.after).toBe("keep\nkeep");
    expect(r.delta).toBe(-3);
    expectExact(r);
  });

  it("handles two separate edits on the SAME line without double counting", () => {
    // Both ranges expand to the same line — pushMerged must collapse them.
    const r = apply(
      ["one two three"],
      [
        { from: 0, to: 3, insert: "1" },
        { from: 8, to: 13, insert: "3" },
      ],
    );
    expect(r.after).toBe("1 two 3");
    expect(r.delta).toBe(0);
    expectExact(r);
  });

  it("handles edits on adjacent lines (expanded ranges abut, never overlap)", () => {
    const r = apply(
      ["one two", "three four"],
      [
        { from: 0, to: 3, insert: "" },
        { from: 8, to: 13, insert: "" },
      ],
    );
    expectExact(r);
  });

  it("handles far-apart edits that stay separate ranges", () => {
    // First and last line, two untouched lines apart — one word added at each end.
    const r = apply(
      ["a b", "filler", "filler", "c d"],
      [
        { from: 0, to: 0, insert: "zzz " },
        { from: 21, to: 21, insert: " yyy" },
      ],
    );
    expect(r.after).toBe("zzz a b\nfiller\nfiller\nc d yyy");
    expect(r.delta).toBe(2);
    expectExact(r);
  });

  it("handles an edit at the very start and end of the document", () => {
    expectExact(apply(["a b c"], { from: 0, to: 0, insert: "x " }));
    expectExact(apply(["a b c"], { from: 5, to: 5, insert: " x" }));
    expectExact(apply(["a b c"], { from: 0, to: 5, insert: "" }));
  });

  it("handles emptying and refilling the document", () => {
    expectExact(apply(["a b", "c d"], { from: 0, to: 7, insert: "" }));
    expectExact(apply([""], { from: 0, to: 0, insert: "a b\nc d" }));
  });

  it("stays exact across a long randomized edit sequence", () => {
    // Deterministic LCG — the fuzz has to reproduce on CI, not vary per run.
    let seed = 0x2f6e2b1;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const alphabet = ["a", "bb", " ", "\n", "  ", "cc dd", "\n\n", "e"];

    let doc = Text.of(["seed text", "second line", "third"]);
    let running = countWordsIn(doc.toString());

    for (let i = 0; i < 500; i++) {
      const from = rnd(doc.length + 1);
      const to = Math.min(doc.length, from + rnd(6));
      const insert = rnd(3) === 0 ? "" : alphabet[rnd(alphabet.length)];
      const changes = ChangeSet.of({ from, to, insert }, doc.length);
      const next = changes.apply(doc);
      running += wordCountDelta(changes, doc, next);
      expect(running).toBe(countWordsIn(next.toString()));
      doc = next;
    }
  });

  it("stays exact when one transaction carries many scattered edits", () => {
    let doc = Text.of(Array.from({ length: 40 }, (_, i) => `line ${i} of text`));
    let running = countWordsIn(doc.toString());
    for (let round = 0; round < 20; round++) {
      // Every third line, back-to-front so the offsets stay valid as specs.
      const specs: ChangeSpec[] = [];
      for (let n = 0; n < doc.lines; n += 3) {
        const line = doc.line(n + 1);
        specs.push({ from: line.from, to: line.to, insert: round % 2 ? "x y z" : "" });
      }
      const changes = ChangeSet.of(specs, doc.length);
      const next = changes.apply(doc);
      running += wordCountDelta(changes, doc, next);
      expect(running).toBe(countWordsIn(next.toString()));
      doc = next;
    }
  });
});
