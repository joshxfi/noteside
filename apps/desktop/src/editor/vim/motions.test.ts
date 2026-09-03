// Position math over REAL ProseMirror docs built from the app's own schema —
// the doc-pure half of the vim layer (the view-coordinate j/k is e2e-only).
import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import type { Node as PMNode } from "@tiptap/pm/model";
import { markdownExtensions } from "../extensions";
import { motionTarget } from "./exec";
import {
  blockStart,
  clampNormalPos,
  lineStep,
  lineUnitAt,
  lineUnits,
  lineUnitSpan,
  matchPairTarget,
  seekTarget,
  textObjectRange,
  wordTarget,
} from "./motions";

const exts = markdownExtensions();
const schema = getSchema(exts);
const manager = new MarkdownManager({ extensions: exts });
const docOf = (md: string): PMNode => schema.nodeFromJSON(manager.parse(md));

function posOf(doc: PMNode, needle: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found !== -1) return false;
    if (node.isTextblock) {
      const i = node.textContent.indexOf(needle);
      if (i !== -1) found = pos + 1 + i;
      return false;
    }
    return true;
  });
  if (found === -1) throw new Error(`no "${needle}"`);
  return found;
}

describe("lineUnitAt", () => {
  it("a top-level paragraph is its own unit", () => {
    const doc = docOf("first para\n\nsecond para");
    const unit = lineUnitAt(doc, 3); // inside "first para"
    expect(unit).toMatchObject({ from: 0, to: doc.child(0).nodeSize, kind: "node" });
  });

  it("a list item is the unit, not the whole list", () => {
    const doc = docOf("- alpha\n- beta");
    const unit = lineUnitAt(doc, posOf(doc, "beta"));
    const node = doc.nodeAt(unit.from);
    expect(node?.type.name).toBe("listItem");
    expect(node?.textContent).toBe("beta");
  });

  it("a boundary between two items attaches to the item AFTER it (not the list)", () => {
    const doc = docOf("- alpha\n- beta");
    const alpha = lineUnitAt(doc, posOf(doc, "alpha"));
    const next = lineUnitAt(doc, alpha.to);
    expect(doc.nodeAt(next.from)?.textContent).toBe("beta");
  });

  it("a code block narrows to the current source line", () => {
    const doc = docOf("```\nline one\nline two\n```");
    const unit = lineUnitAt(doc, posOf(doc, "line two"));
    expect(unit.kind).toBe("codeline");
    expect(doc.textBetween(unit.from, unit.to)).toBe("line two");
  });

  it("a table row is the unit inside tables", () => {
    const doc = docOf("| a | b |\n| --- | --- |\n| one | two |");
    const unit = lineUnitAt(doc, posOf(doc, "one"));
    expect(doc.nodeAt(unit.from)?.type.name).toBe("tableRow");
  });

  it("a paragraph inside a blockquote is its own line", () => {
    const doc = docOf("> a\n>\n> b");
    const unit = lineUnitAt(doc, posOf(doc, "b"));
    expect(doc.nodeAt(unit.from)?.type.name).toBe("paragraph");
    expect(doc.nodeAt(unit.from)?.textContent).toBe("b");
  });

  it("a horizontal rule is a leaf unit", () => {
    const doc = docOf("a\n\n---\n\nb");
    const hrPos = doc.child(0).nodeSize;
    expect(doc.nodeAt(hrPos)?.type.name).toBe("horizontalRule");
    expect(lineUnitAt(doc, hrPos)).toMatchObject({ from: hrPos, to: hrPos + 1 });
  });
});

describe("lineUnits", () => {
  it("spans count consecutive units", () => {
    const doc = docOf("one\n\ntwo\n\nthree");
    const span = lineUnitSpan(doc, 1, 2);
    expect(doc.slice(span.from, span.to).content.childCount).toBe(2);
  });

  it("walks list items one by one, then out of the list", () => {
    const doc = docOf("- a\n- b\n\npara");
    const units = lineUnits(doc, posOf(doc, "a"), 3);
    expect(units.map((u) => doc.nodeAt(u.from)?.textContent)).toEqual(["a", "b", "para"]);
  });

  it("walks upward for dk", () => {
    const doc = docOf("a\n\nb\n\nc");
    const units = lineUnits(doc, posOf(doc, "c"), 2, -1);
    expect(units.map((u) => doc.nodeAt(u.from)?.textContent)).toEqual(["b", "c"]);
  });

  it("stops at the end of the document", () => {
    const doc = docOf("a\n\nb");
    expect(lineUnits(doc, posOf(doc, "b"), 5)).toHaveLength(1);
  });
});

describe("clampNormalPos", () => {
  it("never sits past the last character of a non-empty line", () => {
    const doc = docOf("abc");
    expect(clampNormalPos(doc, 4)).toBe(3);
    expect(clampNormalPos(doc, 3)).toBe(3);
    expect(clampNormalPos(doc, 1)).toBe(1);
  });

  it("an empty line keeps its only position", () => {
    const doc = docOf("a\n\n\n\nb"); // middle paragraph empty? parse keeps two blocks — use explicit empty
    const empty = schema.node("doc", null, [schema.node("paragraph")]);
    expect(clampNormalPos(empty, 1)).toBe(1);
    expect(doc.childCount).toBeGreaterThan(1);
  });

  it("inside a code block the line is the source line", () => {
    const doc = docOf("```\nab\ncd\n```");
    const ab = posOf(doc, "ab");
    expect(clampNormalPos(doc, ab + 2)).toBe(ab + 1); // on the \n → onto 'b'
    expect(clampNormalPos(doc, ab + 3)).toBe(ab + 3); // start of "cd"
    expect(clampNormalPos(doc, ab + 5)).toBe(ab + 4); // block end → onto 'd'
    const blank = docOf("```\nab\n\ncd\n```");
    const empty = posOf(blank, "ab") + 3;
    expect(clampNormalPos(blank, empty)).toBe(empty); // an empty source line
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
  it("punctuation is its own word class", () => {
    const p = docOf("foo.bar");
    expect(wordTarget(p, 1, "w")).toBe(4); // "."
    expect(wordTarget(p, 4, "w")).toBe(5); // "bar"
  });
});

describe("lineStep", () => {
  it("keeps the column, clamping to a shorter line", () => {
    const doc = docOf("alpha\n\nxy\n\nlonger line");
    const fromAlpha = lineStep(doc, posOf(doc, "alpha") + 4, 1, 1) as number;
    expect(doc.resolve(fromAlpha).parent.textContent).toBe("xy");
    expect(doc.resolve(fromAlpha).parentOffset).toBe(2);
    const down2 = lineStep(doc, posOf(doc, "alpha") + 4, 1, 2) as number;
    expect(doc.resolve(down2).parentOffset).toBe(4);
  });
  it("returns null when it cannot move", () => {
    const doc = docOf("only");
    expect(lineStep(doc, 1, 1, 1)).toBe(null);
    expect(lineStep(doc, 1, -1, 1)).toBe(null);
  });
  it("steps source lines inside code, then out", () => {
    const doc = docOf("para\n\n```\none\ntwo\n```");
    const one = posOf(doc, "one");
    expect(doc.resolve(lineStep(doc, one, 1, 1) as number).parentOffset).toBe(4);
    expect(doc.resolve(lineStep(doc, one, -1, 1) as number).parent.textContent).toBe("para");
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

describe("matchPairTarget", () => {
  const doc = docOf("f(a, [b]) x");
  it("jumps between a pair from either end, nesting-aware", () => {
    const open = posOf(doc, "(");
    const close = posOf(doc, ")");
    expect(matchPairTarget(doc, open)).toBe(close);
    expect(matchPairTarget(doc, close)).toBe(open);
    expect(matchPairTarget(doc, posOf(doc, "["))).toBe(posOf(doc, "]"));
  });
  it("from a non-bracket, uses the first bracket after the cursor; none → null", () => {
    expect(matchPairTarget(doc, posOf(doc, "f"))).toBe(posOf(doc, ")"));
    expect(matchPairTarget(doc, posOf(doc, "x"))).toBe(null);
  });
});

describe("textObjectRange", () => {
  const text = (doc: PMNode, r: { from: number; to: number } | null) =>
    r ? doc.textBetween(r.from, r.to) : null;

  it("iw / aw", () => {
    const doc = docOf("alpha beta gamma");
    const e = posOf(doc, "e");
    expect(text(doc, textObjectRange(doc, e, "w", false))).toBe("beta");
    expect(text(doc, textObjectRange(doc, e, "w", true))).toBe("beta ");
    // on whitespace: iw is the blank run, aw adds the following word
    expect(text(doc, textObjectRange(doc, 6, "w", false))).toBe(" ");
    expect(text(doc, textObjectRange(doc, 6, "w", true))).toBe(" beta");
    // last word: aw takes the LEADING blank
    const last = docOf("alpha beta");
    expect(text(last, textObjectRange(last, posOf(last, "e"), "w", true))).toBe(" beta");
  });

  it("quotes: inside / around (+ trailing blank), escaped quotes skipped", () => {
    // built from the schema: markdown would consume the backslash escape
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text('say "he\\"llo" now')]),
    ]);
    const h = posOf(doc, "h");
    expect(text(doc, textObjectRange(doc, h, '"', false))).toBe('he\\"llo');
    expect(text(doc, textObjectRange(doc, h, '"', true))).toBe('"he\\"llo" ');
    const none = docOf("no quotes");
    expect(textObjectRange(none, 1, '"', false)).toBe(null);
  });

  it("brackets: innermost pair, cursor on a bracket, unmatched → null", () => {
    const doc = docOf("f(a, (b)) end");
    expect(text(doc, textObjectRange(doc, posOf(doc, "b"), "(", false))).toBe("b");
    expect(text(doc, textObjectRange(doc, posOf(doc, "a"), "(", false))).toBe("a, (b)");
    expect(text(doc, textObjectRange(doc, posOf(doc, "a"), "(", true))).toBe("(a, (b))");
    expect(text(doc, textObjectRange(doc, posOf(doc, "("), "(", false))).toBe("a, (b)");
    expect(textObjectRange(doc, posOf(doc, "end"), "(", false)).toBe(null);
    const open = docOf("f(a");
    expect(textObjectRange(open, posOf(open, "a"), "(", false)).toBe(null);
  });
});

describe("motionTarget", () => {
  const doc = docOf("# Title\n\nalpha beta\n\nlast");
  it("docStart / docEnd / blockJump land on first non-blanks", () => {
    expect(motionTarget(doc, 5, { t: "docStart" }, 1)).toBe(1);
    expect(motionTarget(doc, 5, { t: "docEnd" }, 1)).toBe(blockStart(doc, 3));
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
  it("h/l are confined to the line; w confined only for operators", () => {
    const two = docOf("ab\n\ncd");
    expect(motionTarget(two, 2, { t: "char", dir: 1 }, 5)).toBe(3);
    expect(motionTarget(two, 1, { t: "char", dir: -1 }, 5)).toBe(1);
    expect(
      two.resolve(motionTarget(two, 2, { t: "word", which: "w" }, 1) as number).parent.textContent,
    ).toBe("cd");
    expect(motionTarget(two, 2, { t: "word", which: "w" }, 1, undefined, true)).toBe(3);
  });
  it("blockStart skips a leading rule onto the first textblock", () => {
    const rule = docOf("---\n\ntext");
    expect(rule.resolve(blockStart(rule, 1)).parent.textContent).toBe("text");
  });
});
