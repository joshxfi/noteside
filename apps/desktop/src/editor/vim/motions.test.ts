// Position math over REAL ProseMirror docs built from the app's own schema —
// the doc-pure half of the vim layer (the view-coordinate j/k is e2e-only).
import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import type { Node as PMNode } from "@tiptap/pm/model";
import { markdownExtensions } from "../extensions";
import { motionTarget } from "./exec";
import { blockStart, lineUnitAt, lineUnitSpan, seekTarget, wordTarget } from "./motions";

const exts = markdownExtensions();
const schema = getSchema(exts);
const manager = new MarkdownManager({ extensions: exts });
const docOf = (md: string): PMNode => schema.nodeFromJSON(manager.parse(md));

describe("lineUnitAt", () => {
  it("a top-level paragraph is its own unit", () => {
    const doc = docOf("first para\n\nsecond para");
    const unit = lineUnitAt(doc, 3); // inside "first para"
    expect(unit).toMatchObject({ from: 0, to: doc.child(0).nodeSize, kind: "node" });
  });

  it("a list item is the unit, not the whole list", () => {
    const doc = docOf("- alpha\n- beta");
    // find beta's position
    let betaPos = 0;
    doc.descendants((n, pos) => {
      if (n.isText && n.text === "beta") betaPos = pos + 1;
      return true;
    });
    const unit = lineUnitAt(doc, betaPos);
    const node = doc.nodeAt(unit.from);
    expect(node?.type.name).toBe("listItem");
    expect(node?.textContent).toBe("beta");
  });

  it("a code block narrows to the current source line", () => {
    const doc = docOf("```\nline one\nline two\n```");
    let codePos = 0;
    doc.descendants((n, pos) => {
      if (n.isText && n.text?.includes("line one")) codePos = pos;
      return true;
    });
    const unit = lineUnitAt(doc, codePos + 12); // inside "line two"
    expect(unit.kind).toBe("codeline");
    expect(doc.textBetween(unit.from, unit.to)).toBe("line two");
  });

  it("a table row is the unit inside tables", () => {
    const doc = docOf("| a | b |\n| --- | --- |\n| one | two |");
    let cellPos = 0;
    doc.descendants((n, pos) => {
      if (n.isText && n.text === "one") cellPos = pos + 1;
      return true;
    });
    const unit = lineUnitAt(doc, cellPos);
    expect(doc.nodeAt(unit.from)?.type.name).toBe("tableRow");
  });
});

describe("lineUnitSpan", () => {
  it("spans count consecutive units", () => {
    const doc = docOf("one\n\ntwo\n\nthree");
    const span = lineUnitSpan(doc, 1, 2);
    expect(doc.slice(span.from, span.to).content.childCount).toBe(2);
  });
});

describe("wordTarget", () => {
  const doc = docOf("alpha beta gamma");
  it("w hops to the next word start", () => {
    expect(wordTarget(doc, 1, "w")).toBe(7); // "beta"
    expect(wordTarget(doc, 7, "w")).toBe(12); // "gamma"
  });
  it("b hops back to the previous word start", () => {
    expect(wordTarget(doc, 12, "b")).toBe(7);
    expect(wordTarget(doc, 7, "b")).toBe(1);
  });
  it("e lands on the word end", () => {
    expect(wordTarget(doc, 1, "e")).toBe(5); // 'a' of alph[a]
  });
  it("w hops across blocks at the end of a paragraph", () => {
    const two = docOf("one\n\ntwo");
    const target = wordTarget(two, 3, "w"); // end of "one"
    expect(two.resolve(target).parent.textContent).toBe("two");
  });
});

describe("seekTarget", () => {
  const doc = docOf("axbxc");
  it("f seeks forward onto the char, t stops before it", () => {
    expect(seekTarget(doc, 1, "f", "x", 1)).toBe(2);
    expect(seekTarget(doc, 1, "t", "x", 1)).toBe(1);
    expect(seekTarget(doc, 1, "f", "x", 2)).toBe(4); // count
  });
  it("F/T seek backward", () => {
    expect(seekTarget(doc, 5, "F", "x", 1)).toBe(4);
    expect(seekTarget(doc, 5, "T", "x", 1)).toBe(5);
  });
  it("returns null when the char is absent (vim no-op)", () => {
    expect(seekTarget(doc, 1, "f", "z", 1)).toBe(null);
  });
});

describe("motionTarget", () => {
  const doc = docOf("# Title\n\nalpha beta\n\nlast");
  it("docStart / docEnd / blockJump", () => {
    expect(motionTarget(doc, 5, { t: "docStart" }, 1)).toBe(0);
    expect(motionTarget(doc, 5, { t: "docEnd" }, 1)).toBe(doc.content.size);
    expect(motionTarget(doc, 0, { t: "blockJump", n: 2 }, 1)).toBe(blockStart(doc, 2));
    // clamps past the end
    expect(motionTarget(doc, 0, { t: "blockJump", n: 99 }, 1)).toBe(blockStart(doc, 3));
  });
  it("{ and } hop top-level blocks with counts", () => {
    const start = blockStart(doc, 2);
    expect(motionTarget(doc, start, { t: "para", dir: 1 }, 1)).toBe(blockStart(doc, 3));
    expect(motionTarget(doc, start, { t: "para", dir: -1 }, 1)).toBe(blockStart(doc, 1));
    expect(motionTarget(doc, blockStart(doc, 1), { t: "para", dir: 1 }, 2)).toBe(
      blockStart(doc, 3),
    );
  });
  it("line motions: 0 ^ $", () => {
    const inBeta = blockStart(doc, 2) + 7;
    expect(motionTarget(doc, inBeta, { t: "lineStart" }, 1)).toBe(blockStart(doc, 2));
    const end = motionTarget(doc, inBeta, { t: "lineEnd" }, 1) as number;
    expect(doc.resolve(end).parentOffset).toBe("alpha beta".length);
  });
});
