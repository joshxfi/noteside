// tokenizer-bounds.test.ts — the bounded tokenizers must be INVISIBLE: every
// document parses to the same tree as with the stock Tiptap tokenizers. The
// fuzz leans on the shapes the prefix proofs reason about (loose and lazy list
// items, nested tasks across blank lines, tables with and without a trailing
// blank line, list markers inside table rows, leading blank lines).
import { describe, expect, it } from "vitest";
import { MarkdownManager } from "@tiptap/markdown";
import { OrderedList, TaskList } from "@tiptap/extension-list";
import { Table } from "@tiptap/extension-table";
import type { AnyExtension } from "@tiptap/core";
import { markdownExtensions, privateMarked } from "./extensions";

const STOCK: Record<string, unknown> = {
  orderedList: OrderedList.config.markdownTokenizer,
  taskList: TaskList.config.markdownTokenizer,
  table: Table.config.markdownTokenizer,
};

const bounded = new MarkdownManager({ marked: privateMarked(), extensions: markdownExtensions() });
const stock = new MarkdownManager({
  marked: privateMarked(),
  extensions: markdownExtensions().map((ext: AnyExtension) =>
    ext.name in STOCK ? ext.extend({ markdownTokenizer: STOCK[ext.name] }) : ext,
  ),
});

const FRAGMENTS = [
  "1. first",
  "2. second",
  "3) paren item",
  "a. alpha item",
  "iv. roman item",
  "10. ten",
  "   1. indented ordered",
  "  - nested bullet",
  "- bullet",
  "* star bullet",
  "- [ ] open task",
  "- [x] done task",
  "  - [ ] nested task",
  "    - [X] deeper task",
  "lazy continuation line",
  "  indented continuation",
  "",
  "",
  "   ",
  "# Heading",
  "## Sub heading",
  "> quote line",
  "> [!NOTE]",
  "```ts\nconst x = 1;\n```",
  "| a | b |\n|---|---|\n| 1 | 2 |",
  "| x | y |\n| - | - |",
  "1. a | b\n---|---",
  "plain | not a table",
  "|---|---|",
  "Some *prose* with `code`.",
  "$$x^2$$",
  "***",
];

function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

function randomDoc(rand: () => number): string {
  const n = 1 + Math.floor(rand() * 24);
  const lines: string[] = [];
  for (let i = 0; i < n; i++) lines.push(FRAGMENTS[Math.floor(rand() * FRAGMENTS.length)]);
  const sep = rand() < 0.5 ? "\n" : "\n\n";
  return (rand() < 0.2 ? "\n" : "") + lines.join(sep) + (rand() < 0.3 ? "\n" : "");
}

describe("bounded markdown tokenizers", () => {
  it("parse identically to the stock tokenizers (differential fuzz)", () => {
    const rand = rng(20261001);
    // Some fragment mixes crash the STOCK parser too (marked's blockquote
    // tokenizer on a callout + lazy ordered item) — equal means the same throw.
    const outcome = (m: MarkdownManager, md: string) => {
      try {
        return { doc: m.parse(md) };
      } catch (e) {
        return { threw: String(e) };
      }
    };
    for (let i = 0; i < 1500; i++) {
      const md = randomDoc(rand);
      expect(outcome(bounded, md), md).toEqual(outcome(stock, md));
    }
  });

  it("parse a long list-and-table-heavy note in linear time", () => {
    const block = [
      "## Section",
      "1. one\n2. two\n   continued",
      "- [ ] task\n  - [x] nested",
      "| a | b |\n|---|---|\n| 1 | 2 |",
      "A paragraph of prose.",
    ];
    const doc = (n: number) =>
      Array.from({ length: n }, (_, i) => block[i % block.length]).join("\n\n");
    const time = (md: string) => {
      let best = Infinity;
      for (let i = 0; i < 3; i++) {
        const t = performance.now();
        bounded.parse(md);
        best = Math.min(best, performance.now() - t);
      }
      return best;
    };
    const small = time(doc(1000));
    const large = time(doc(4000));
    // 4× the blocks; quadratic would be ~16×. Generous bound for CI noise.
    expect(large / small).toBeLessThan(8);
  });
});
