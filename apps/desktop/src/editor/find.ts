// find.ts — in-note find, one engine for every surface: Mod-f's bar, vim's
// `/`, `n/N`, `*`/`#`, and `:noh`. prosemirror-search (MIT, ProseMirror org)
// supplies the MATCHER (SearchQuery); the plugin that holds the query and
// paints the highlights is ours, because the stock one rebuilds every match
// decoration from a full-document scan on EVERY doc change — and the query
// PERSISTS after the bar closes (hlsearch parity: F3 keeps cycling until the
// highlights are cleared), so a common query in a long note taxed each
// keystroke by O(matches): ~31ms at 10k lines / 4.5k matches, measured.
//
// This plugin maps the existing decorations through the transaction and
// rescans only the textblocks a step touched. Exact, because a match never
// spans a textblock (the matcher scans per textblock), so text outside the
// touched blocks keeps exactly the matches it had — the same argument the
// word counter (word-count.ts) makes for words. find.test.ts pins
// `incremental === full rebuild` over real transactions, fuzz included.
import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { type EditorState, Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { SearchQuery } from "prosemirror-search";

/** Set on every transaction findNext/findPrev dispatch. The vim layer needs
 *  to tell a find's ranged selection (the match) from a mouse drag: in normal
 *  mode a drag IS visual mode, but `/foo<CR>` and `n` must park the cursor on
 *  the match start and stay normal — the CM-era behavior, and vim's. */
export const FIND_META = "nsFind";

// prosemirror-search's class names, so styles.css's rules keep applying.
const MATCH_CLASS = "ProseMirror-search-match";
const ACTIVE_CLASS = "ProseMirror-active-search-match";

export interface SearchPluginState {
  query: SearchQuery;
  /** Every match, plain-classed. The source of truth findCounts reads. */
  matches: DecorationSet;
  /** What the view paints: `matches` with the selected match re-classed
   *  active (a find selects the whole match, and that one is lit stronger). */
  deco: DecorationSet;
}

export const searchKey = new PluginKey<SearchPluginState>("nsSearch");

const emptyQuery = () => new SearchQuery({ search: "", literal: true });

/** Every match inside [from, to] as plain decorations. Callers pass
 *  textblock-aligned bounds, so no match is cut in half by the range. */
function scanMatches(state: EditorState, query: SearchQuery, from: number, to: number) {
  const out: Decoration[] = [];
  if (!query.valid) return out;
  for (let pos = from; ;) {
    const next = query.findNext(state, pos, to);
    if (!next) break;
    out.push(Decoration.inline(next.from, next.to, { class: MATCH_CLASS }));
    pos = Math.max(next.to, pos + 1); // never loop on a zero-length match
  }
  return out;
}

function buildAll(state: EditorState, query: SearchQuery): DecorationSet {
  return DecorationSet.create(state.doc, scanMatches(state, query, 0, state.doc.content.size));
}

/** Widen a changed range to the textblocks it touches (a position that is not
 *  inside a textblock — between blocks, inside table structure — stays put:
 *  the boundary itself carries no text, and every textblock strictly inside
 *  the range is covered whole). */
function widenToTextblocks(doc: PMNode, from: number, to: number): [number, number] {
  const size = doc.content.size;
  const $from = doc.resolve(Math.max(0, Math.min(from, size)));
  const $to = doc.resolve(Math.max(0, Math.min(to, size)));
  return [
    $from.parent.isTextblock ? $from.start() : $from.pos,
    $to.parent.isTextblock ? $to.end() : $to.pos,
  ];
}

/** The doc-changed path: map, then rescan only what each step touched. */
function updateMatches(
  prev: DecorationSet,
  tr: {
    steps: readonly { getMap(): { forEach: StepMapForEach } }[];
    mapping: MappingLike;
    doc: PMNode;
  },
  state: EditorState,
  query: SearchQuery,
): DecorationSet {
  const doc = tr.doc;
  // Each step's changed ranges, brought to final-doc coordinates (step i's
  // own coordinates live in tr.docs[i+1]) and widened to whole textblocks.
  const touched: [number, number][] = [];
  for (let i = 0; i < tr.steps.length; i++) {
    const rest = tr.mapping.slice(i + 1);
    tr.steps[i].getMap().forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      touched.push(widenToTextblocks(doc, rest.map(newStart, -1), rest.map(newEnd, 1)));
    });
  }
  if (touched.length === 0) return prev; // a mark-only step: no text moved
  let set = prev.map(tr.mapping as never, doc);
  if (!query.valid) return set;
  for (const [from, to] of touched) {
    const stale = set.find(from, to);
    if (stale.length) set = set.remove(stale);
    const fresh = scanMatches(state, query, from, to);
    if (fresh.length) set = set.add(doc, fresh);
  }
  return set;
}

type StepMapForEach = (
  f: (oldStart: number, oldEnd: number, newStart: number, newEnd: number) => void,
) => void;
interface MappingLike {
  slice(from: number): { map(pos: number, assoc?: number): number };
}

/** `matches` with the exactly-selected match re-classed active. */
function withActive(matches: DecorationSet, state: EditorState): DecorationSet {
  const sel = state.selection;
  if (sel.empty) return matches;
  const hit = matches.find(sel.from, sel.to).find((d) => d.from === sel.from && d.to === sel.to);
  if (!hit) return matches;
  return matches
    .remove([hit])
    .add(state.doc, [Decoration.inline(hit.from, hit.to, { class: ACTIVE_CLASS })]);
}

export function searchPlugin(): Plugin<SearchPluginState> {
  return new Plugin<SearchPluginState>({
    key: searchKey,
    state: {
      init: () => ({
        query: emptyQuery(),
        matches: DecorationSet.empty,
        deco: DecorationSet.empty,
      }),
      apply(tr, prev, _old, state) {
        const set = tr.getMeta(searchKey) as SearchQuery | undefined;
        if (set) {
          const matches = buildAll(state, set);
          return { query: set, matches, deco: withActive(matches, state) };
        }
        if (!tr.docChanged && !tr.selectionSet) return prev;
        const matches = tr.docChanged
          ? updateMatches(prev.matches, tr, state, prev.query)
          : prev.matches;
        return { query: prev.query, matches, deco: withActive(matches, state) };
      },
    },
    props: {
      decorations: (state) => searchKey.getState(state)?.deco,
    },
  });
}

export const Find = Extension.create({
  name: "nsFind",
  addProseMirrorPlugins() {
    return [searchPlugin()];
  },
});

export function setFindQuery(editor: Editor, text: string, caseSensitive = false): void {
  const query = new SearchQuery({ search: text, caseSensitive, literal: true });
  editor.view.dispatch(editor.state.tr.setMeta(searchKey, query));
}

export function clearFind(editor: Editor): void {
  setFindQuery(editor, "");
}

export function currentFindQuery(editor: Editor): string {
  return searchKey.getState(editor.state)?.query.search ?? "";
}

/** prosemirror-search's findNext/findPrev (wrapping), re-homed so the
 *  transaction carries FIND_META and so vim can search from PAST the cursor:
 *  the vim cursor sits collapsed ON a match start after every find, and the
 *  stock command searches from `selection.to`, which would re-find that same
 *  match forever (`n` stuck). `skipCurrent` starts one past a collapsed
 *  caret — vim's own rule (`/pat` from ON a match goes to the NEXT one); a
 *  ranged selection (the non-vim highlighted match) is unaffected. */
function findCommand(editor: Editor, dir: 1 | -1, skipCurrent: boolean): boolean {
  const { state, view } = editor;
  const q = searchKey.getState(state)?.query;
  if (!q?.valid) return false;
  const { from, to, empty } = state.selection;
  const end = state.doc.content.size;
  let next;
  if (dir > 0) {
    const start = skipCurrent && empty ? from + 1 : to;
    next =
      q.findNext(state, start, end) ??
      q.findNext(state, 0, from) ??
      // a lone match under the cursor: stay on it (vim re-finds it after the wrap)
      (skipCurrent ? q.findNext(state, from, end) : null);
  } else {
    next = q.findPrev(state, from, 0) ?? q.findPrev(state, end, to);
  }
  if (!next) return false;
  view.dispatch(
    state.tr
      .setSelection(TextSelection.create(state.doc, next.from, next.to))
      .scrollIntoView()
      .setMeta(FIND_META, true),
  );
  return true;
}

export function findNext(editor: Editor, skipCurrent = false): boolean {
  return findCommand(editor, 1, skipCurrent);
}

export function findPrev(editor: Editor): boolean {
  return findCommand(editor, -1, false);
}

/** [current 1-based match index (0 = none active), total matches]. */
export function findCounts(editor: Editor): [number, number] {
  const set = searchKey.getState(editor.state)?.matches ?? DecorationSet.empty;
  const decos = set.find();
  const { from } = editor.state.selection;
  let current = 0;
  decos.forEach((d, i) => {
    if (current === 0 && d.from <= from && from <= d.to) current = i + 1;
  });
  return [current, decos.length];
}
