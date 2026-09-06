// The incremental search-highlight plugin: after ANY transaction, the mapped-
// and-rescanned decoration set must equal a full rescan of the new document.
// Real docs from the app's own schema, real ProseMirror transactions.
import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import type { Node as PMNode } from "@tiptap/pm/model";
import { EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
import { SearchQuery } from "prosemirror-search";
import { markdownExtensions } from "./extensions";
import { searchKey, searchPlugin } from "./find";

const exts = markdownExtensions();
const schema = getSchema(exts);
const manager = new MarkdownManager({ extensions: exts });
const docOf = (md: string): PMNode => schema.nodeFromJSON(manager.parse(md));

const query = (text: string) => new SearchQuery({ search: text, literal: true });

function stateOf(md: string, q?: string): EditorState {
  let state = EditorState.create({ doc: docOf(md), plugins: [searchPlugin()] });
  if (q !== undefined) state = state.apply(state.tr.setMeta(searchKey, query(q)));
  return state;
}

type R = [number, number];
const ranges = (state: EditorState): R[] =>
  searchKey
    .getState(state)!
    .matches.find()
    .map((d) => [d.from, d.to] as R);

/** The oracle: a full scan of the current doc with the current query. */
function fullRanges(state: EditorState): R[] {
  const q = searchKey.getState(state)!.query;
  const out: R[] = [];
  if (!q.valid) return out;
  for (let pos = 0; ;) {
    const next = q.findNext(state, pos, state.doc.content.size);
    if (!next) break;
    out.push([next.from, next.to]);
    pos = Math.max(next.to, pos + 1);
  }
  return out;
}

const classesAt = (state: EditorState): string[] =>
  searchKey
    .getState(state)!
    .deco.find()
    .map(
      (d) =>
        (d.spec as { class?: string }).class ??
        (d as unknown as { type: { attrs: { class: string } } }).type.attrs.class,
    );

/** Text position of the first `needle` inside a textblock. */
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

const apply = (state: EditorState, f: (tr: Transaction) => Transaction) => state.apply(f(state.tr));

describe("search highlights", () => {
  it("setting a query paints every match; an empty query clears", () => {
    let s = stateOf("zebra one zebra\n\n- zebra item\n\n```\nzebra code\n```", "zebra");
    expect(ranges(s)).toHaveLength(4);
    expect(ranges(s)).toEqual(fullRanges(s));
    s = s.apply(s.tr.setMeta(searchKey, query("")));
    expect(ranges(s)).toEqual([]);
  });

  it("typing a new match, breaking one, and deleting one stay exact", () => {
    let s = stateOf("zebra one zebra", "zebra");
    // a new match typed at the end
    s = apply(s, (tr) => tr.insertText(" zebra", posOf(s.doc, "one") + 9));
    expect(ranges(s)).toEqual(fullRanges(s));
    expect(ranges(s)).toHaveLength(3);
    // breaking the middle of the first match
    s = apply(s, (tr) => tr.insertText("X", posOf(s.doc, "zebra") + 2));
    expect(ranges(s)).toEqual(fullRanges(s));
    expect(ranges(s)).toHaveLength(2);
    // deleting a whole match
    const p = posOf(s.doc, "zebra");
    s = apply(s, (tr) => tr.delete(p, p + 5));
    expect(ranges(s)).toEqual(fullRanges(s));
    expect(ranges(s)).toHaveLength(1);
  });

  it("matches in untouched blocks survive edits elsewhere untouched", () => {
    let s = stateOf("zebra\n\nmiddle\n\nzebra tail", "zebra");
    const before = ranges(s);
    s = apply(s, (tr) => tr.insertText("!!", posOf(s.doc, "middle") + 6));
    // the first match is unmoved; the last shifted by 2
    expect(ranges(s)).toEqual([before[0], [before[1][0] + 2, before[1][1] + 2]]);
    expect(ranges(s)).toEqual(fullRanges(s));
  });

  it("splitting a block through a match and joining blocks into one stay exact", () => {
    let s = stateOf("abzebracd\n\nxyz", "zebra");
    expect(ranges(s)).toHaveLength(1);
    s = apply(s, (tr) => tr.split(posOf(s.doc, "zebra") + 2));
    expect(ranges(s)).toEqual(fullRanges(s));
    expect(ranges(s)).toEqual([]);
    // join "ze" + "bracd" back: delete the block boundary
    const p = posOf(s.doc, "bracd");
    s = apply(s, (tr) => tr.delete(p - 2, p));
    expect(ranges(s)).toEqual(fullRanges(s));
    expect(ranges(s)).toHaveLength(1);
  });

  it("a mark-only step keeps the set identical", () => {
    let s = stateOf("zebra one zebra", "zebra");
    const before = searchKey.getState(s)!.matches;
    const p = posOf(s.doc, "one");
    s = apply(s, (tr) => tr.addMark(p, p + 3, schema.marks.bold.create()));
    expect(searchKey.getState(s)!.matches).toBe(before);
  });

  it("a selection-only transaction keeps the match set and re-classes the selected match active", () => {
    let s = stateOf("zebra one zebra", "zebra");
    const matches = searchKey.getState(s)!.matches;
    const [from, to] = ranges(s)[1];
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, from, to)));
    expect(searchKey.getState(s)!.matches).toBe(matches);
    expect(classesAt(s)).toEqual(["ProseMirror-search-match", "ProseMirror-active-search-match"]);
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, from)));
    expect(classesAt(s)).toEqual(["ProseMirror-search-match", "ProseMirror-search-match"]);
  });

  it("stays exact across a long randomized edit sequence (incremental === full rescan)", () => {
    let seed = 0x5eed1234;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const alphabet = ["a", "ab", "abab", " ", "b", "aba", "x"];
    let s = stateOf("abab ab\n\n- abab\n- ba\n\n> ab abab\n\n```\nab\nabab\n```\n\nplain", "abab");
    for (let i = 0; i < 400; i++) {
      const size = s.doc.content.size;
      const pos = rnd(size + 1);
      const $pos = s.doc.resolve(pos);
      const kind = rnd(10);
      let tr = s.tr;
      if (kind < 5) {
        if (!$pos.parent.isTextblock) continue;
        tr = tr.insertText(alphabet[rnd(alphabet.length)], pos);
      } else if (kind < 8) {
        const to = Math.min(size, pos + 1 + rnd(6));
        if (to <= pos) continue;
        try {
          tr = tr.delete(pos, to);
        } catch {
          continue;
        }
      } else if (kind < 9) {
        if (!$pos.parent.isTextblock || $pos.parent.type.spec.code) continue;
        try {
          tr = tr.split(pos);
        } catch {
          continue;
        }
      } else {
        // toggle the query itself now and then
        tr = tr.setMeta(searchKey, query(rnd(2) ? "abab" : "ab"));
      }
      if (!tr.docChanged && !tr.getMeta(searchKey)) continue;
      s = s.apply(tr);
      expect(ranges(s)).toEqual(fullRanges(s));
    }
    expect(ranges(s).length + fullRanges(s).length).toBeGreaterThan(0);
  });
});
