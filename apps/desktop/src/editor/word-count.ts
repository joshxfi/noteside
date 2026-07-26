// word-count.ts — the status bar's word counter, maintained as a DELTA instead
// of a full-document rescan.
//
// The old path re-walked the whole doc on a 180ms debounce after every keystroke
// — O(doc) work on the typing path, which a long note pays for on every pause.
// A change only ever alters the words on the lines it touches, so counting just
// those lines (before and after) yields the same total for O(changed lines), and
// the count can be exact and live instead of debounced.
//
// Why line-expanded ranges are exact: a word is a run of non-whitespace and a
// line boundary IS whitespace, so no word can straddle one. Expanding each
// changed range out to its enclosing lines therefore captures every word the
// change could have split, joined, created, or destroyed — and the text outside
// those ranges is copied verbatim by the change, contributing identically to
// both totals.
//
// Deliberately CodeMirror-free (structural types only) so it stays node-testable
// in the pure-module test env. Real `Text`/`ChangeSet` values satisfy these
// shapes, and word-count.test.ts drives it with actual ones.

/** The slice of CodeMirror's `Text` this module needs. */
export interface DocLike {
  lineAt(pos: number): { from: number; to: number };
  sliceString(from: number, to: number): string;
}

/** The slice of CodeMirror's `ChangeSet` this module needs. */
export interface ChangesLike {
  iterChanges(f: (fromA: number, toA: number, fromB: number, toB: number) => void): void;
}

const WORD = /\S+/g;

/** Words (runs of non-whitespace) in a string. Line endings are whitespace, so
 *  this agrees with the editor's doc even when CodeMirror normalizes CRLF→LF. */
export function countWordsIn(text: string): number {
  WORD.lastIndex = 0;
  let n = 0;
  while (WORD.exec(text) !== null) n++;
  return n;
}

type Range = [from: number, to: number];

/** Append `[from, to]`, merging into the previous range when they overlap or abut.
 *  `iterChanges` yields ascending, non-overlapping ranges, so only the last entry
 *  can collide after line expansion (two edits landing on one line). */
function pushMerged(ranges: Range[], from: number, to: number): void {
  const last = ranges[ranges.length - 1];
  if (last && from <= last[1]) {
    if (to > last[1]) last[1] = to;
    return;
  }
  ranges.push([from, to]);
}

function countRanges(doc: DocLike, ranges: Range[]): number {
  let n = 0;
  for (const [from, to] of ranges) n += countWordsIn(doc.sliceString(from, to));
  return n;
}

/**
 * How much a change shifts the document's word count: the touched lines' word
 * count after, minus before. Add it to the running total.
 */
export function wordCountDelta(changes: ChangesLike, before: DocLike, after: DocLike): number {
  const old: Range[] = [];
  const fresh: Range[] = [];
  changes.iterChanges((fromA, toA, fromB, toB) => {
    pushMerged(old, before.lineAt(fromA).from, before.lineAt(toA).to);
    pushMerged(fresh, after.lineAt(fromB).from, after.lineAt(toB).to);
  });
  return countRanges(after, fresh) - countRanges(before, old);
}
