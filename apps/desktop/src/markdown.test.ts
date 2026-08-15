import { describe, expect, it } from "vitest";
import { frontmatterEndLine, scanFrontmatter, scanTopBlocks, splitRow } from "./markdown";

const lines = (s: string) => s.split("\n");

describe("splitRow", () => {
  it("strips the optional leading and trailing pipes", () => {
    expect(splitRow("| a | b |")?.map((c) => c.text)).toEqual(["a", "b"]);
    expect(splitRow("a | b")?.map((c) => c.text)).toEqual(["a", "b"]);
    expect(splitRow("| a | b")?.map((c) => c.text)).toEqual(["a", "b"]);
  });

  it("keeps empty middle cells and a single empty cell", () => {
    expect(splitRow("| a |  | c |")?.map((c) => c.text)).toEqual(["a", "", "c"]);
    expect(splitRow("|  |")?.map((c) => c.text)).toEqual([""]);
  });

  it("does not split on escaped pipes", () => {
    expect(splitRow("| a \\| b | c |")?.map((c) => c.text)).toEqual(["a \\| b", "c"]);
  });

  it("returns null for a line without any pipe", () => {
    expect(splitRow("plain text")).toBeNull();
  });

  it("reports the source offset of each cell's content", () => {
    const cells = splitRow("| foo |   bar |")!;
    expect(cells[0]).toEqual({ text: "foo", from: 2 });
    expect(cells[1]).toEqual({ text: "bar", from: 10 });
  });
});

// Mirrors Rust split_frontmatter (notebook.rs) — the editor must hide exactly
// what parse_meta reads, or a pinned note shows YAML as prose.
describe("scanFrontmatter", () => {
  it("finds the closed leading block's line range", () => {
    expect(scanFrontmatter(lines("---\ntitle: T\npinned: true\n---\n# Body"))).toEqual({
      fromLine: 0,
      toLine: 3,
    });
  });

  it("tolerates trailing whitespace on the closing fence, like Rust does", () => {
    expect(scanFrontmatter(lines("---\na: 1\n--- \nbody"))?.toLine).toBe(2);
  });

  it("requires a bare `---` opener on line 0", () => {
    expect(scanFrontmatter(lines("# Note\n---\na: 1\n---"))).toBeNull();
    expect(scanFrontmatter(lines("--- \na: 1\n---"))).toBeNull();
    expect(scanFrontmatter(lines("----\na: 1\n---"))).toBeNull();
    expect(scanFrontmatter([])).toBeNull();
  });

  it("is null for an unclosed block (a bare `---` stays a thematic rule)", () => {
    expect(scanFrontmatter(lines("---\na: 1\nbody"))).toBeNull();
    expect(scanFrontmatter(lines("---\n\nsome note"))).toBeNull();
  });

  it("closes on the FIRST `---`, not a later one", () => {
    expect(scanFrontmatter(lines("---\njust text\na: 1\n---\nb: 2\n---"))?.toLine).toBe(3);
  });

  it("reports an empty block (never null)", () => {
    expect(scanFrontmatter(lines("---\n---\nbody"))).toEqual({ fromLine: 0, toLine: 1 });
  });

  // Live preview calls this per keystroke via bodyStart(), so it must never walk
  // the whole document — a note with frontmatter would pay O(doc) on every edit.
  it("reads only as far as the closing fence", () => {
    const read: number[] = [];
    const src = ["---", "a: 1", "---", ...Array.from({ length: 5000 }, (_, i) => `line ${i}`)];
    const at = (i: number) => {
      read.push(i);
      return src[i];
    };
    expect(frontmatterEndLine(src.length, at)).toBe(2);
    expect(read).toEqual([0, 1, 2]);
  });

  it("reads exactly one line when the note has no frontmatter", () => {
    const read: number[] = [];
    const src = Array.from({ length: 5000 }, (_, i) => `line ${i}`);
    expect(
      frontmatterEndLine(src.length, (i) => {
        read.push(i);
        return src[i];
      }),
    ).toBe(-1);
    expect(read).toEqual([0]);
  });
});

describe("scanTopBlocks (pure segmentation — parser agreement lives in goto.test.ts)", () => {
  const ranges = (s: string) => scanTopBlocks(lines(s)).map((b) => [b.fromLine, b.toLine]);

  it("splits blank-separated blocks and folds runs", () => {
    expect(ranges("# Head\n\npara one\npara one cont\n\n- a\n- b")).toEqual([
      [0, 0],
      [2, 3],
      [5, 6],
    ]);
  });

  it("keeps fences and quotes whole", () => {
    expect(ranges("```\na\n\nb\n```\n\n> q1\n> q2")).toEqual([
      [0, 4],
      [6, 7],
    ]);
  });

  it("emits zero-width blocks for implicit empty paragraphs", () => {
    // a 3-blank-line gap materializes one empty paragraph in the parser
    const r = ranges("a\n\n\n\nb");
    expect(r).toEqual([
      [0, 0],
      [1, 1],
      [4, 4],
    ]);
  });

  it("link reference definitions produce no block", () => {
    expect(ranges("[ref]: https://x.dev\n\npara")).toEqual([[2, 2]]);
  });
});
