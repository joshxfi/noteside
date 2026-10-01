// code-highlight.test.ts — the incremental code highlighter must always equal
// a from-scratch highlight of the current doc, under random edits: typing in
// and around code blocks, deletions across block edges, splits and joins,
// language changes (the grammar-load nudge's setNodeMarkup), and paragraphs
// turned into code blocks.
import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
import { canJoin } from "@tiptap/pm/transform";
import type { DecorationSet } from "@tiptap/pm/view";
import { createLowlight } from "lowlight";
import javascript from "highlight.js/lib/languages/javascript";
import python from "highlight.js/lib/languages/python";
import { codeHighlightKey, codeHighlightPlugin, fullHighlight } from "./code-highlight";

const schema = getSchema([StarterKit]);
const lowlight = createLowlight();
lowlight.register("javascript", javascript);
lowlight.register("python", python);
const TYPE = "codeBlock";

const p = (t: string) => schema.node("paragraph", null, t ? [schema.text(t)] : []);
const code = (t: string, language: string | null) =>
  schema.node(TYPE, { language }, t ? [schema.text(t)] : []);

function flat(set: DecorationSet | undefined) {
  return (set?.find() ?? [])
    .map(
      (d) =>
        `${d.from}-${d.to}:${(d as unknown as { type: { attrs: { class: string } } }).type.attrs.class}`,
    )
    .sort();
}

function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

const SNIPPETS = [
  "const x = 1;",
  "def f(): return 2",
  "'str'",
  " // note",
  "\n",
  "if (a) {",
  "}",
  "word ",
];
const LANGS = ["javascript", "python", null, "unknown"];

function randomEdit(state: EditorState, rand: () => number): Transaction | null {
  const size = state.doc.content.size;
  const pos = 1 + Math.floor(rand() * Math.max(1, size - 1));
  const tr = state.tr;
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  try {
    switch (Math.floor(rand() * 7)) {
      case 0:
      case 1: {
        const $p = state.doc.resolve(pos);
        if (!$p.parent.isTextblock) return null;
        return tr.insertText(pick(SNIPPETS), pos);
      }
      case 2: {
        const to = Math.min(size, pos + 1 + Math.floor(rand() * 12));
        return tr.delete(pos, to);
      }
      case 3: {
        const blocks: number[] = [];
        state.doc.forEach((n, off) => n.type.name === TYPE && blocks.push(off));
        if (!blocks.length) return null;
        const at = pick(blocks);
        return tr.setNodeMarkup(at, undefined, { language: pick(LANGS) });
      }
      case 4: {
        const $p = state.doc.resolve(pos);
        if (!$p.parent.isTextblock) return null;
        return tr.setBlockType($p.before(), $p.after(), schema.nodes[TYPE], {
          language: pick(LANGS),
        });
      }
      case 5: {
        const $p = state.doc.resolve(pos);
        if (!$p.parent.isTextblock) return null;
        return tr.split(pos);
      }
      default: {
        const $p = state.doc.resolve(pos);
        const at = $p.depth > 0 ? $p.before(1) : pos;
        if (!canJoin(state.doc, at)) return null;
        return tr.join(at);
      }
    }
  } catch {
    return null;
  }
}

describe("incremental code highlighting", () => {
  it("equals a full rebuild after every random edit", () => {
    const rand = rng(424242);
    for (let run = 0; run < 150; run++) {
      const doc = schema.node("doc", null, [
        p("intro"),
        code("const a = 'x';\nfunction f() { return 1; }", "javascript"),
        p("between"),
        code("def g():\n    return 'y'", "python"),
        code("let auto = true;", null),
        p("outro"),
      ]);
      let state = EditorState.create({
        schema,
        doc,
        plugins: [codeHighlightPlugin({ typeName: TYPE, lowlight })],
      });
      for (let step = 0; step < 60; step++) {
        const tr = randomEdit(state, rand);
        if (!tr) {
          // Selection-only transactions must be free and correct too.
          const sel = TextSelection.atStart(state.doc);
          state = state.apply(state.tr.setSelection(sel));
          continue;
        }
        state = state.apply(tr);
        expect(flat(codeHighlightKey.getState(state))).toEqual(
          flat(fullHighlight(state.doc, TYPE, lowlight)),
        );
      }
    }
  });

  it("rebuilds on the grammar-landed refresh meta, with no doc change", () => {
    const late = createLowlight();
    const doc = schema.node("doc", null, [code("def g():\n    return 'y'", "python")]);
    const state = EditorState.create({
      schema,
      doc,
      plugins: [codeHighlightPlugin({ typeName: TYPE, lowlight: late })],
    });
    const before = flat(codeHighlightKey.getState(state));
    late.register("python", python); // the lazy grammar chunk lands
    const next = state.apply(state.tr.setMeta(codeHighlightKey, "refresh"));
    expect(next.doc).toBe(state.doc);
    const after = flat(codeHighlightKey.getState(next));
    expect(after).not.toEqual(before);
    expect(after).toEqual(flat(fullHighlight(next.doc, TYPE, late)));
  });

  it("returns the previous set untouched on a selection-only transaction", () => {
    const doc = schema.node("doc", null, [p("a"), code("const x = 1;", "javascript")]);
    const state = EditorState.create({
      schema,
      doc,
      plugins: [codeHighlightPlugin({ typeName: TYPE, lowlight })],
    });
    const next = state.apply(state.tr.setSelection(TextSelection.atEnd(state.doc)));
    expect(codeHighlightKey.getState(next)).toBe(codeHighlightKey.getState(state));
  });
});
