// goto.test.ts — pins the agreement invariant behind gotoLine mapping: for
// every round-trip vector (and a set of tricky shapes), scanTopBlocks sees the
// SAME number of top-level blocks as the real markdown parser produces doc
// children. Divergence would land grep hits on the wrong block (the runtime
// clamps, but the map should be right, not rescued).
import { describe, expect, it } from "vitest";
import { MarkdownManager } from "@tiptap/markdown";
import { markdownExtensions } from "./extensions";
import { scanTopBlocks } from "../markdown";
import { splitNote } from "./markdown-io";

const manager = new MarkdownManager({ extensions: markdownExtensions() });

const childCount = (body: string): number => (manager.parse(body).content ?? []).length;
const scanCount = (body: string): number => scanTopBlocks(body.split("\n")).length;

const vectors = import.meta.glob("../test-vectors/round-trip/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("scanTopBlocks agrees with the parser", () => {
  for (const [path, raw] of Object.entries(vectors)) {
    const name = path.split("/").pop() as string;
    it(`vector ${name}`, () => {
      const io = splitNote(raw);
      expect(scanCount(io.body)).toBe(childCount(io.body));
    });
  }

  const CASES: Record<string, string> = {
    "blank gaps": "a\n\nb\n\n\nc\n\n\n\nd",
    "leading/trailing gaps": "\n\na\n\n",
    "heading interrupts paragraph": "text line\n# head\nmore text",
    "loose list": "- a\n\n- b\n\nafter",
    "nested list continuation": "- a\n  - a1\n\n  still a's content\n- b",
    "quote with lazy line": "> quoted\nlazy continuation\n\npara",
    "setext heading": "Title\n=====\n\nbody",
    "hr between paragraphs": "above\n\n---\n\nbelow",
    "table then paragraph": "| a | b |\n| --- | --- |\n| 1 | 2 |\n\nafter",
    "paragraph interrupted by table": "text\n| a | b |\n| --- | --- |\n| 1 | 2 |",
    "block math": "$$\nx + y\n$$\n\npara",
    "html block": "<div>\ncontent\n</div>\n\npara",
    "fence with inner blanks": "```\na\n\nb\n```\n\npara",
    "single paragraph": "just one line",
    empty: "",
  };
  for (const [name, body] of Object.entries(CASES)) {
    it(`case: ${name}`, () => {
      expect(scanCount(body)).toBe(childCount(body));
    });
  }
});
