// tokenizer-bounds.ts — linear-time wrappers around the stock Tiptap markdown
// tokenizers that made opening a long note QUADRATIC.
//
// marked runs every custom block tokenizer at every block boundary, handing it
// the ENTIRE rest of the document, and runs every block `start()` once per
// paragraph. Four stock hooks `split("\n")` that whole remainder before looking
// at its first line, so a note of N blocks paid N full-document splits: a
// 2,000-block note took ~1.4s to open and a 5,000-block note ~10s (measured,
// chromium, M-series). Each wrapper below answers the cheap question first
// (does the first line even qualify?) and otherwise hands the stock function
// the shortest PREFIX it can provably read, so the result is identical by
// construction — `tokenizer-bounds.test.ts` pins `bounded === stock` with a
// differential fuzz over whole-document parses.
//
// The prefix rules ("the scanner never reads past line j") are argued per
// tokenizer below against the stock source (@tiptap/extension-list
// collectOrderedListItems, @tiptap/core parseIndentedBlocks, and
// @tiptap/extension-table's tokenizer). A Tiptap upgrade that changes those
// scanners trips the fuzz rather than silently diverging.
import type { MarkdownTokenizer } from "@tiptap/core";
import { ORDERED_LIST_MARKER_PATTERN } from "@tiptap/extension-list";
import { Tokenizer, type MarkedExtension, type Tokens } from "marked";

// Mirrors of the stock item patterns (extension-list's ORDERED_LIST_ITEM_REGEX
// is built from the exported marker pattern; the task pattern is inline there).
const ORDERED_ITEM = new RegExp(`^(\\s*)(${ORDERED_LIST_MARKER_PATTERN})([.)])\\s+(.*)$`);
const TASK_ITEM = /^(\s*)([-+*])\s+\[([ xX])\]\s+(.*)$/;
const INDENTED = /^\s/;

/** Index of the "\n" ending the line that starts at `from` (or src.length). */
function lineEnd(src: string, from: number): number {
  const i = src.indexOf("\n", from);
  return i < 0 ? src.length : i;
}

const isBlank = (line: string) => line.trim() === "";

/** The prefix of `src` through the first line `stop` accepts (inclusive), or
 *  all of `src` when no line does. `stop` sees each line after the first with
 *  whether the line before it was blank. */
function prefixThrough(
  src: string,
  firstEnd: number,
  stop: (line: string, prevBlank: boolean) => boolean,
): string {
  let prevBlank = isBlank(src.slice(0, firstEnd));
  let s = firstEnd + 1;
  while (s <= src.length && firstEnd < src.length) {
    const e = lineEnd(src, s);
    const line = src.slice(s, e);
    if (stop(line, prevBlank)) return src.slice(0, e);
    if (e >= src.length) break;
    prevBlank = isBlank(line);
    s = e + 1;
  }
  return src;
}

/** orderedList: collectOrderedListItems breaks on a first line that isn't an
 *  item (→ no token). Once inside, it can only stop reading at line j when the
 *  line before j was blank (sawBlankLine is set in the same item — a blank line
 *  never starts one) and j is non-blank, unindented, and not an item: the
 *  inner loop breaks there and the outer loop rejects it. Nothing past j is
 *  ever read. */
export function boundOrderedList(stock: MarkdownTokenizer): MarkdownTokenizer {
  return {
    ...stock,
    tokenize(src, tokens, lexer) {
      const e0 = lineEnd(src, 0);
      if (!ORDERED_ITEM.test(src.slice(0, e0))) return undefined;
      const cut = prefixThrough(
        src,
        e0,
        (line, prevBlank) =>
          prevBlank && !isBlank(line) && !INDENTED.test(line) && !ORDERED_ITEM.test(line),
      );
      return stock.tokenize(cut, tokens, lexer);
    },
  };
}

/** taskList → parseIndentedBlocks: leading blank lines are skipped, then a
 *  first non-blank line that isn't an item means no token. After an item, a
 *  non-blank line with ZERO indentation that isn't an item ends every item
 *  (its indent can't exceed any indentLevel ≥ 0) and then the list; the
 *  blank-line lookahead only ever looks as far as the next non-blank line. */
export function boundTaskList(stock: MarkdownTokenizer): MarkdownTokenizer {
  return {
    ...stock,
    tokenize(src, tokens, lexer) {
      let s = 0;
      let e = lineEnd(src, 0);
      while (isBlank(src.slice(s, e))) {
        if (e >= src.length) return undefined; // all blank: no items
        s = e + 1;
        e = lineEnd(src, s);
      }
      if (!TASK_ITEM.test(src.slice(s, e))) return undefined;
      const cut = prefixThrough(
        src,
        e,
        (line) => !isBlank(line) && !INDENTED.test(line) && !TASK_ITEM.test(line),
      );
      return stock.tokenize(cut, tokens, lexer);
    },
  };
}

/** table: `start` reads only lines 0 and 1. `tokenize` reads up to the first
 *  "\n\n" for its candidate, then slices the token's line count from the FULL
 *  remainder; that count never exceeds the candidate's, so the candidate plus
 *  the blank line plus one more line is everything it can touch. */
export function boundTable(stock: MarkdownTokenizer): MarkdownTokenizer {
  const start = stock.start;
  return {
    ...stock,
    start:
      typeof start === "function"
        ? (src) => {
            const e0 = src.indexOf("\n");
            return start(e0 < 0 ? src : src.slice(0, lineEnd(src, e0 + 1)));
          }
        : start,
    tokenize(src, tokens, lexer) {
      const b = src.indexOf("\n\n");
      const cut = b < 0 ? src : src.slice(0, lineEnd(src, b + 2));
      return stock.tokenize(cut, tokens, lexer);
    },
  };
}

/** marked's blockquote tokenizer re-parses a trailing list itself when more
 *  `>` lines follow a lazy continuation — `this.list(raw + rest)!.raw` — with
 *  marked's NATIVE list rule, which knows only numeric markers. Tiptap's
 *  ordered list also claims letter and roman markers (`a.`, `iv.`), so a note
 *  like `> [!NOTE]\na. item\n> more\na. item` made that call return undefined
 *  and the whole parse threw (the note could not open). This override hands
 *  such a list to the Tiptap tokenizer that produced it. Anywhere else the
 *  native rule wins or Tiptap's extension already made the same call at the
 *  same position, so other output is unchanged (`tokenizer-bounds.test.ts`). */
export function orderedListFallback(ordered: MarkdownTokenizer): MarkedExtension {
  return {
    tokenizer: {
      list(src) {
        if (!ORDERED_ITEM.test(src.slice(0, lineEnd(src, 0)))) return false;
        const native = Tokenizer.prototype.list.call(this, src);
        if (native) return native;
        const lexer = this.lexer;
        const token = ordered.tokenize(src, [], {
          inlineTokens: (s) => lexer.inlineTokens(s),
          blockTokens: (s) => lexer.blockTokens(s),
        });
        return (token as Tokens.List | undefined) ?? false;
      },
    },
  };
}
