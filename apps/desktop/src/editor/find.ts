// find.ts — in-note find, one engine for every surface: Mod-f's bar now, vim's
// `/`, `n/N`, `*`/`#`, and `:noh` when the vim layer lands. prosemirror-search
// (MIT, ProseMirror org) does the matching + decorations; the UI is ours
// (find-bar.tsx). Query state PERSISTS after the bar closes — hlsearch parity:
// F3 keeps cycling until the highlights are cleared.
import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import {
  findNext as pmFindNext,
  findPrev as pmFindPrev,
  getMatchHighlights,
  getSearchState,
  search,
  SearchQuery,
  setSearchState,
} from "prosemirror-search";

export const Find = Extension.create({
  name: "nsFind",
  addProseMirrorPlugins() {
    return [search()];
  },
});

export function setFindQuery(editor: Editor, text: string, caseSensitive = false): void {
  const query = new SearchQuery({ search: text, caseSensitive, literal: true });
  editor.view.dispatch(setSearchState(editor.state.tr, query));
}

export function clearFind(editor: Editor): void {
  setFindQuery(editor, "");
}

export function currentFindQuery(editor: Editor): string {
  return getSearchState(editor.state)?.query.search ?? "";
}

export function findNext(editor: Editor): boolean {
  return pmFindNext(editor.state, editor.view.dispatch);
}

export function findPrev(editor: Editor): boolean {
  return pmFindPrev(editor.state, editor.view.dispatch);
}

/** [current 1-based match index (0 = none active), total matches]. */
export function findCounts(editor: Editor): [number, number] {
  const set = getMatchHighlights(editor.state);
  const decos = set.find();
  const { from } = editor.state.selection;
  let current = 0;
  decos.forEach((d, i) => {
    if (current === 0 && d.from <= from && from <= d.to) current = i + 1;
  });
  return [current, decos.length];
}
