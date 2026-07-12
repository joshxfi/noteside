import { describe, expect, it } from "vitest";
import { type Inline, parseInline, scanBlocks, splitRow } from "./markdown";

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

describe("scanBlocks: tables", () => {
  it("finds a basic table with header, delimiter and rows", () => {
    const { tables } = scanBlocks(lines("| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |"));
    expect(tables).toHaveLength(1);
    const t = tables[0];
    expect(t.fromLine).toBe(0);
    expect(t.toLine).toBe(3);
    expect(t.header.cells.map((c) => c.text)).toEqual(["a", "b"]);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[1].cells.map((c) => c.text)).toEqual(["3", "4"]);
  });

  it("parses column alignment from the delimiter row", () => {
    const { tables } = scanBlocks(lines("| a | b | c | d |\n| :-- | :-: | --: | --- |"));
    expect(tables[0].align).toEqual(["left", "center", "right", null]);
    expect(tables[0].toLine).toBe(1); // header + delimiter only, no body
  });

  it("rejects a header/delimiter cell-count mismatch", () => {
    expect(scanBlocks(lines("| a | b |\n| --- |")).tables).toHaveLength(0);
  });

  it("rejects an invalid delimiter row", () => {
    expect(scanBlocks(lines("| a |\n| === |")).tables).toHaveLength(0);
    expect(scanBlocks(lines("| a |\n| : |")).tables).toHaveLength(0);
  });

  it("ends the table at a blank line, quote, fence, or pipe-less line", () => {
    const src = "| a |\n| - |\n| 1 |\n\n| 2 |";
    expect(scanBlocks(lines(src)).tables[0].toLine).toBe(2);
    const src2 = "| a |\n| - |\n| 1 |\nplain paragraph";
    expect(scanBlocks(lines(src2)).tables[0].toLine).toBe(2);
  });

  it("keeps ragged rows verbatim (the widget pads/clips)", () => {
    const { tables } = scanBlocks(lines("| a | b |\n| - | - |\n| only |\n| 1 | 2 | 3 |"));
    expect(tables[0].rows[0].cells).toHaveLength(1);
    expect(tables[0].rows[1].cells).toHaveLength(3);
  });

  it("supports single-column tables", () => {
    const { tables } = scanBlocks(lines("| a |\n| --- |\n| 1 |"));
    expect(tables).toHaveLength(1);
    expect(tables[0].header.cells.map((c) => c.text)).toEqual(["a"]);
  });

  it("skips tables inside fenced code", () => {
    const src = "```\n| a |\n| - |\n```";
    expect(scanBlocks(lines(src)).tables).toHaveLength(0);
  });

  it("skips quote lines and list items as table headers", () => {
    expect(scanBlocks(lines("> | a |\n| - |")).tables).toHaveLength(0);
    expect(scanBlocks(lines("- | a |\n| - |")).tables).toHaveLength(0);
  });

  it("skips headers indented 4+ spaces (indented code)", () => {
    expect(scanBlocks(lines("    | a |\n    | - |")).tables).toHaveLength(0);
  });

  it("finds multiple tables in one document", () => {
    const src = "| a |\n| - |\n\ntext\n\n| b |\n| - |\n| 1 |";
    const { tables } = scanBlocks(lines(src));
    expect(tables.map((t) => [t.fromLine, t.toLine])).toEqual([
      [0, 1],
      [5, 7],
    ]);
  });
});

describe("scanBlocks: fences and quotes", () => {
  it("tracks fenced blocks with language and closure", () => {
    const { fences } = scanBlocks(lines("```ts\nconst x = 1\n```\n\n~~~\nraw\n~~~"));
    expect(fences).toEqual([
      { fromLine: 0, toLine: 2, closed: true, lang: "ts" },
      { fromLine: 4, toLine: 6, closed: true, lang: "" },
    ]);
  });

  it("runs an unclosed fence to the end of the document", () => {
    const { fences } = scanBlocks(lines("```py\nprint(1)\nstill code"));
    expect(fences).toEqual([{ fromLine: 0, toLine: 2, closed: false, lang: "py" }]);
  });

  it("requires the closing fence to match the opening marker", () => {
    // a ~~~ can't close a ``` fence, and a shorter run can't close a longer one
    const { fences } = scanBlocks(lines("````\n```\n~~~\n````"));
    expect(fences).toEqual([{ fromLine: 0, toLine: 3, closed: true, lang: "" }]);
  });

  it("does not open a backtick fence from an info string with backticks", () => {
    expect(scanBlocks(lines("``` a`b\ntext")).fences).toHaveLength(0);
  });

  it("collects blockquote line indexes", () => {
    const { quotes } = scanBlocks(lines("> one\n>two\ntext\n  > indented"));
    expect(quotes).toEqual([0, 1, 3]);
  });
});

// Renders an Inline tree back to a debug string, so expectations stay terse.
const show = (nodes: Inline[]): string =>
  nodes
    .map((n) => {
      switch (n.t) {
        case "text":
          return n.text;
        case "code":
          return `code(${n.text})`;
        case "strong":
          return `strong(${show(n.children)})`;
        case "em":
          return `em(${show(n.children)})`;
        case "strike":
          return `strike(${show(n.children)})`;
        case "link":
          return `link(${n.text}→${n.url})`;
      }
    })
    .join("");

describe("parseInline", () => {
  it("passes plain text through", () => {
    expect(show(parseInline("just words"))).toBe("just words");
  });

  it("parses strong, em, strikethrough, and the nested triple-star form", () => {
    expect(show(parseInline("**b** and *i* and _u_ and ~~s~~"))).toBe(
      "strong(b) and em(i) and em(u) and strike(s)",
    );
    expect(show(parseInline("***bi***"))).toBe("strong(em(bi))");
    expect(show(parseInline("**bold *nested* here**"))).toBe("strong(bold em(nested) here)");
  });

  it("keeps unterminated or space-flanked markers literal", () => {
    expect(show(parseInline("**open"))).toBe("**open");
    expect(show(parseInline("2 * 3 * 4"))).toBe("2 * 3 * 4");
    expect(show(parseInline("snake_case_name"))).toBe("snake_case_name");
  });

  it("parses code spans, protecting their content", () => {
    expect(show(parseInline("`a | b` x"))).toBe("code(a | b) x");
    expect(show(parseInline("`` a`b ``"))).toBe("code(a`b)");
    expect(show(parseInline("`**not bold**`"))).toBe("code(**not bold**)");
  });

  it("parses web links; relative targets and images collapse to their text", () => {
    expect(show(parseInline("[docs](https://x.dev)"))).toBe("link(docs→https://x.dev)");
    expect(show(parseInline("[a](./local.md)"))).toBe("a");
    expect(show(parseInline("![alt text](img.png)"))).toBe("alt text");
  });

  it("resolves backslash escapes to literals", () => {
    expect(show(parseInline("\\*not em\\* and \\| pipe"))).toBe("*not em* and | pipe");
  });
});
