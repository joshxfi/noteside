// The executor over REAL ProseMirror state built from the app's own schema:
// keys go through the pure machine, intents through execIntent, transactions
// through EditorState.apply — the whole normal/visual editing loop minus the
// view (j/k fall back to the logical lineStep; o/O are reported, not run).
import { beforeEach, describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import type { Node as PMNode } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { markdownExtensions } from "../extensions";
import { execIntent, visualSelection, type VisualSel } from "./exec";
import { feedKey, initialVimState, type VimMode, type VimState } from "./machine";
import { clampNormalPos } from "./motions";
import { getRegister, setRegister } from "./registers";

const exts = markdownExtensions();
const schema = getSchema(exts);
const manager = new MarkdownManager({ extensions: exts });
const docOf = (md: string): PMNode => schema.nodeFromJSON(manager.parse(md));
const md = (doc: PMNode): string => manager.serialize(doc.toJSON()).trim();

/** Text position of the first occurrence of `needle` inside a textblock. */
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
  if (found === -1) throw new Error(`no "${needle}" in doc`);
  return found;
}

/** Drive keys through machine + exec the way the extension does, including
 *  the vim-side visual selection and the normal-mode clamp. */
function drive(source: string, at: string | number, keys: string[], tabWidth = 2) {
  return driveDoc(docOf(source), at, keys, tabWidth);
}

function driveDoc(doc: PMNode, at: string | number, keys: string[], tabWidth = 2) {
  const pos = typeof at === "number" ? at : posOf(doc, at);
  let state = EditorState.create({ doc, selection: TextSelection.create(doc, pos) });
  let vim: VimState = initialVimState;
  let vsel = null as VisualSel | null;
  let mode: VimMode = "normal";
  const notes: string[] = [];
  for (const k of keys) {
    const r = feedKey(vim, { key: k, ctrl: false, shift: false, allowCtrlScroll: true });
    vim = r.state;
    for (const intent of r.intents) {
      if (intent.kind === "mode") {
        if (intent.to === "visual") {
          const kind = intent.visual ?? "char";
          if (vsel) {
            vsel = { anchor: vsel.anchor, head: vsel.head, kind };
          } else {
            const h = clampNormalPos(state.doc, state.selection.head);
            vsel = { anchor: h, head: h, kind };
          }
          state = state.apply(state.tr.setSelection(visualSelection(state.doc, vsel)));
          mode = "visual";
        } else if (intent.to === "normal") {
          if (vsel) {
            const h = clampNormalPos(state.doc, vsel.head);
            vsel = null;
            state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, h)));
          }
          mode = "normal";
        } else {
          vsel = null;
          mode = "insert";
        }
        vim = { ...vim, mode, visual: vsel?.kind ?? vim.visual };
        continue;
      }
      const res = execIntent(state, intent, { vsel, tabWidth });
      if (!res) continue;
      if (res.vsel !== undefined) vsel = res.vsel;
      if (res.tr) state = state.apply(res.tr);
      if (res.notify) notes.push(res.notify);
      if (res.openLine) notes.push("openLine:" + res.openLine);
    }
    if (mode === "normal" && state.selection.empty) {
      const c = clampNormalPos(state.doc, state.selection.head);
      if (c !== state.selection.head) {
        state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, c)));
      }
    }
  }
  const head = state.selection.head;
  const $head = state.doc.resolve(head);
  return {
    state,
    doc: state.doc,
    text: state.doc.textContent,
    md: md(state.doc),
    head,
    /** Character under the cursor ("" at a line end / empty line). */
    under: $head.parent.isTextblock
      ? $head.parent.textBetween(
          $head.parentOffset,
          Math.min($head.parentOffset + 1, $head.parent.content.size),
        )
      : "",
    col: $head.parent.isTextblock ? $head.parentOffset : -1,
    mode,
    vsel,
    notes,
    register: getRegister(),
  };
}

const keys = (s: string): string[] => Array.from(s);

/** A doc built straight from the schema (bypassing markdown escapes/marks). */
const para = (text: string): PMNode =>
  schema.node("doc", null, [schema.node("paragraph", null, [schema.text(text)])]);

beforeEach(() => {
  setRegister({ type: "text", text: "" });
});

describe("normal-mode cursor rule", () => {
  it("$ lands ON the last character; l cannot leave the line; h cannot either", () => {
    const r = drive("abc\n\ndef", "a", keys("$"));
    expect(r.under).toBe("c");
    expect(drive("abc\n\ndef", "c", keys("lll")).under).toBe("c");
    expect(drive("abc\n\ndef", "d", keys("hh")).under).toBe("d");
  });

  it("x on the last character steps the cursor back onto the new last one", () => {
    const r = drive("abc", "c", keys("x"));
    expect(r.text).toBe("ab");
    expect(r.under).toBe("b");
    expect(r.register).toEqual({ type: "text", text: "c" });
  });

  it("X deletes before the cursor; x with a count stops at the line end", () => {
    expect(drive("abc", "c", keys("X")).text).toBe("ac");
    expect(drive("abcdef", "c", ["9", "x"]).text).toBe("ab");
  });

  it("w still hops blocks as a cursor motion; A / a place the insert caret past the end", () => {
    const r = drive("one\n\ntwo", "e", keys("w"));
    expect(r.doc.resolve(r.head).parent.textContent).toBe("two");
    expect(drive("abc", "a", keys("A")).col).toBe(3);
    expect(drive("abc", "c", keys("a")).col).toBe(3);
    expect(drive("  abc", "c", keys("I")).col).toBe(2);
  });

  it("G / gg land on the first non-blank of the last / first line", () => {
    const r = drive("# T\n\nmid\n\nlast", "mid", keys("G"));
    expect(r.doc.resolve(r.head).parent.textContent).toBe("last");
    expect(r.col).toBe(0);
    expect(drive("# T\n\nmid", "mid", keys("gg")).under).toBe("T");
  });
});

describe("delete operator", () => {
  it("dw deletes to the next word; register holds the text", () => {
    const r = drive("alpha beta gamma", "beta", keys("dw"));
    expect(r.text).toBe("alpha gamma");
    expect(r.register).toEqual({ type: "text", text: "beta " });
    expect(r.under).toBe("g");
  });

  it("dw on the last word stops at the line end — it never joins the next block", () => {
    const r = drive("alpha beta\n\nnext", "beta", keys("dw"));
    expect(r.doc.childCount).toBe(2);
    expect(r.doc.child(0).textContent).toBe("alpha ");
  });

  it("de is inclusive, db exclusive, d$ / D to the end, d0 to the start", () => {
    expect(drive("alpha beta", "beta", keys("de")).text).toBe("alpha ");
    expect(drive("alpha beta", "beta", keys("db")).text).toBe("beta");
    expect(drive("alpha beta", "beta", keys("D")).text).toBe("alpha ");
    expect(drive("alpha beta", "e", keys("d$")).text).toBe("alpha b");
    expect(drive("alpha beta", "beta", keys("d0")).text).toBe("beta");
  });

  it("dfx is inclusive, dtx stops before x, dFx is exclusive", () => {
    expect(drive("a-b-c", "a", keys("df-")).text).toBe("b-c");
    expect(drive("a-b-c", "a", keys("dt-")).text).toBe("-b-c");
    expect(drive("a-b-c", "c", keys("dF-")).text).toBe("a-bc");
    expect(drive("a-b-c", "a", ["2", "d", "f", "-"]).text).toBe("c");
  });

  it("d + a failed seek is a no-op", () => {
    expect(drive("abc", "a", keys("dfz")).text).toBe("abc");
  });

  it("dl / x agree; dh deletes before", () => {
    expect(drive("abc", "b", keys("dl")).text).toBe("ac");
    expect(drive("abc", "b", keys("dh")).text).toBe("bc");
  });

  it("d% deletes a bracket pair inclusively", () => {
    expect(drive("f(a, b) end", "(", keys("d%")).text).toBe("f end");
  });
});

describe("text objects", () => {
  it("diw / daw / ciw", () => {
    expect(drive("alpha beta gamma", "e", keys("diw")).text).toBe("alpha  gamma");
    expect(drive("alpha beta gamma", "e", keys("daw")).text).toBe("alpha gamma");
    expect(drive("alpha beta", "e", keys("daw")).text).toBe("alpha"); // trailing → leading blank
    const c = drive("alpha beta gamma", "e", keys("ciw"));
    expect(c.text).toBe("alpha  gamma");
    expect(c.mode).toBe("insert");
    expect(c.col).toBe(6);
  });

  it('di" / da" / ci\' / di`', () => {
    expect(drive('say "hello there" now', "ell", keys('di"')).text).toBe('say "" now');
    expect(drive('say "hello there" now', "ell", keys('da"')).text).toBe("say now");
    expect(drive("say 'hi' now", "h", keys("ci'")).text).toBe("say '' now");
    // (backticks parse to an inline-code MARK, so i` needs literal backticks)
    expect(driveDoc(para("run `ls -la` now"), "-", keys("di`")).text).toBe("run `` now");
    // cursor before the first quote picks the first pair after it
    expect(drive('x "a" "b"', "x", keys('di"')).text).toBe('x "" "b"');
  });

  it("di( / da( / di[ / ci{ / di< — innermost pair, cursor on a bracket works", () => {
    expect(drive("f(a, (b)) end", "b", keys("di("))).toMatchObject({ text: "f(a, ()) end" });
    expect(drive("f(a, (b)) end", "a", keys("di("))).toMatchObject({ text: "f() end" });
    expect(drive("f(a, (b)) end", "a", keys("da("))).toMatchObject({ text: "f end" });
    expect(drive("f(a, (b)) end", "(", keys("di)"))).toMatchObject({ text: "f() end" });
    expect(drive("x[1][2]", "1", keys("di["))).toMatchObject({ text: "x[][2]" });
    expect(drive("if {x}", "x", keys("ci{"))).toMatchObject({ text: "if {}", mode: "insert" });
    expect(drive("<b>bold</b>", "old", keys("di<"))).toMatchObject({ text: "<b>bold</b>" });
    expect(drive("<b>bold</b>", "b>", keys("di<"))).toMatchObject({ text: "<>bold</b>" });
  });

  it("dip deletes the block; text objects on an empty line are a no-op", () => {
    expect(drive("one\n\ntwo\n\nthree", "two", keys("dip")).md).toBe("one\n\nthree");
    expect(drive("one\n\ntwo", "one", keys("di("))).toMatchObject({ text: "onetwo" });
  });
});

describe("change operator", () => {
  it("cw changes to the END of the word (no trailing blank) and enters insert", () => {
    const r = drive("alpha beta gamma", "alpha", keys("cw"));
    expect(r.text).toBe(" beta gamma");
    expect(r.mode).toBe("insert");
    expect(r.col).toBe(0);
    expect(r.register).toEqual({ type: "text", text: "alpha" });
  });

  it("c2w spans two words; cw on whitespace changes just the whitespace", () => {
    expect(drive("alpha beta gamma", "alpha", keys("c2w")).text).toBe(" gamma");
    expect(drive("alpha  beta", 6, keys("cw")).text).toBe("alphabeta");
  });

  it("cc / S keep the heading, clear its text; C changes to the end; s substitutes", () => {
    const h = drive("# Title\n\nbody", "itle", keys("cc"));
    expect(h.doc.child(0).type.name).toBe("heading");
    expect(h.doc.child(0).textContent).toBe("");
    expect(h.mode).toBe("insert");
    expect(drive("alpha beta", "beta", keys("C")).text).toBe("alpha ");
    expect(drive("abc", "b", keys("s")).text).toBe("ac");
    expect(drive("abc", "a", ["2", "s"])).toMatchObject({ text: "c", mode: "insert" });
  });

  it("cc on a list item keeps the item (and a task's checkbox)", () => {
    const r = drive("- [x] done\n- [ ] todo", "done", keys("cc"));
    const list = r.doc.child(0);
    expect(list.childCount).toBe(2);
    expect(list.child(0).type.name).toBe("taskItem");
    expect(list.child(0).attrs.checked).toBe(true);
    expect(list.child(0).textContent).toBe("");
    expect(list.child(1).textContent).toBe("todo");
    expect(r.mode).toBe("insert");
  });

  it("ce at the last char of a word changes just that word", () => {
    expect(drive("ab cd", "b", keys("cw")).text).toBe("a cd");
  });
});

describe("linewise: dd yy p cc with the line-unit rule", () => {
  it("dd on the sole item removes the list, not just the item", () => {
    expect(drive("- only\n\npara", "only", keys("dd")).md).toBe("para");
  });

  it("2dd on two items of three leaves one", () => {
    expect(drive("- a\n- b\n- c", "a", ["2", "d", "d"]).md).toBe("- c");
  });

  it("2dd walks out of a list into the paragraph below", () => {
    expect(drive("- a\n- b\n\npara\n\nlast", "b", ["2", "d", "d"]).md).toBe("- a\n\nlast");
  });

  it("dd the last block; dd everything leaves one empty paragraph", () => {
    expect(drive("# T\n\npara", "para", keys("dd")).md).toBe("# T");
    const r = drive("only", "only", keys("dd"));
    expect(r.doc.childCount).toBe(1);
    expect(r.doc.textContent).toBe("");
  });

  it("dd in a code block deletes the source line; in a quote, the paragraph", () => {
    expect(drive("```\none\ntwo\n```", "one", keys("dd")).md).toBe("```\ntwo\n```");
    expect(drive("```\none\ntwo\n```", "two", keys("dd")).md).toBe("```\none\n```");
    expect(drive("> a\n>\n> b", "a", keys("dd")).md).toBe("> b");
    expect(drive("> a", "a", keys("dd")).md).toBe("");
  });

  it("dd in a table deletes the row; the last row takes the table", () => {
    const t = "| h |\n| --- |\n| one |\n| two |";
    const r = drive(t, "one", keys("dd"));
    expect(r.md).toContain("two");
    expect(r.md).not.toContain("one");
    expect(drive("| h |\n| --- |", "h", keys("dd")).md).toBe("");
  });

  it("yy + p pastes a sibling item; dd + p pastes below; P above", () => {
    expect(drive("- a\n- b", "a", keys("yyp")).md).toBe("- a\n- a\n- b");
    expect(drive("one\n\ntwo", "one", keys("ddp")).md).toBe("two\n\none");
    expect(drive("one\n\ntwo", "two", keys("ddP")).md).toBe("two\n\none");
  });

  it("paragraphs pasted inside a list become items; items pasted outside get a list", () => {
    const intoList = drive("para\n\n- a", "para", keys("dd"));
    expect(intoList.md).toBe("- a");
    const r = drive("para\n\n- a", "para", keys("ddp"));
    expect(r.md).toContain("para");
    const out = drive("- a\n\npara", "a", keys("ddjp"));
    expect(out.md).toBe("para\n\n- a");
  });

  it("dj / dk / dG / dgg are linewise", () => {
    expect(drive("a\n\nb\n\nc", "a", keys("dj")).md).toBe("c");
    expect(drive("a\n\nb\n\nc", "c", keys("dk")).md).toBe("a");
    expect(drive("a\n\nb\n\nc", "b", keys("dG")).md).toBe("a");
    expect(drive("a\n\nb\n\nc", "b", keys("dgg")).md).toBe("c");
    expect(drive("a\n\nb\n\nc\n\nd", "a", ["d", "2", "j"]).md).toBe("d");
  });

  it("yj yanks two lines and leaves the cursor; yk moves it up", () => {
    const r = drive("a\n\nb\n\nc", "a", keys("yj"));
    expect(r.register?.type).toBe("nodes");
    expect(r.under).toBe("a");
    expect(drive("a\n\nb", "b", keys("yk")).under).toBe("a");
  });

  it("after dd the cursor sits on the first non-blank of the line that moved up", () => {
    const r = drive("a\n\n  b", "a", keys("dd"));
    expect(r.under).toBe("b");
  });
});

describe("charwise yank + paste", () => {
  it("yw + p pastes AFTER the cursor char; P before; cursor on the last pasted char", () => {
    const r = drive("ab cd", "a", keys("ywp"));
    expect(r.text).toBe("aab b cd");
    expect(r.under).toBe(" ");
    expect(drive("ab cd", "c", keys("ywP")).text).toBe("ab cdcd"); // yw at the last word: no trailing blank
    expect(drive("ab cd", "a", keys("ywP")).text).toBe("ab ab cd");
  });

  it("yiw / p with a count", () => {
    expect(drive("xy", "x", ["y", "i", "w", "$", "p"]).text).toBe("xyxy");
    expect(drive("ab", "a", ["y", "l", "2", "p"]).text).toBe("aaab");
  });

  it("p on an empty line inserts there", () => {
    const r = drive("ab\n\n", "a", ["y", "l", "j", "p"]);
    expect(r.doc.child(1).textContent).toBe("a");
  });

  it("yw moves nothing; yb / y0 move the cursor to the start of the yank", () => {
    expect(drive("ab cd", "c", keys("yw")).under).toBe("c");
    expect(drive("ab cd", "c", keys("yb")).under).toBe("a");
  });
});

describe("small edits", () => {
  it("r replaces count chars and parks on the last one; too few chars → no-op", () => {
    const r = drive("abc", "b", keys("rx"));
    expect(r.text).toBe("axc");
    expect(r.under).toBe("x");
    expect(drive("abcd", "b", ["2", "r", "-"]).text).toBe("a--d");
    expect(drive("abc", "b", ["5", "r", "-"]).text).toBe("abc");
  });

  it("~ toggles case and steps right; 3~", () => {
    const r = drive("abc", "a", keys("~"));
    expect(r.text).toBe("Abc");
    expect(r.under).toBe("b");
    expect(drive("abC", "a", ["3", "~"]).text).toBe("ABc");
  });

  it("J joins with one space, dropping the next line's leading blanks", () => {
    expect(drive("one\n\n   two", "one", keys("J")).text).toBe("one two");
    const r = drive("one \n\ntwo", "one", keys("J"));
    expect(r.text).toBe("one two");
    expect(drive("a\n\nb\n\nc", "a", ["3", "J"]).text).toBe("a b c");
  });

  it("J on the last line, or across structures, is a no-op; in code and lists it joins", () => {
    expect(drive("one\n\n- item", "one", keys("J")).md).toBe("one\n\n- item");
    expect(drive("only", "only", keys("J")).text).toBe("only");
    expect(drive("```\na\n  b\n```", "a", keys("J")).md).toBe("```\na b\n```");
    expect(drive("- a\n- b", "a", keys("J")).md).toBe("- a b");
  });

  it(">> nests a list item, << unnests; in code, indents by tabWidth", () => {
    expect(drive("- a\n- b", "b", keys(">>")).md).toBe("- a\n  - b");
    expect(drive("- a\n  - b", "b", keys("<<")).md).toBe("- a\n- b");
    expect(drive("```\nx\n```", "x", keys(">>"), 4).md).toBe("```\n    x\n```");
    expect(drive("```\n    x\n```", "x", keys("<<"), 4).md).toBe("```\nx\n```");
    // a paragraph has nothing to indent in markdown — quiet no-op
    expect(drive("para", "para", keys(">>")).md).toBe("para");
  });

  it("o / O are reported for the glue (the view runs the split)", () => {
    expect(drive("a", "a", keys("o")).notes).toEqual(["openLine:below"]);
    expect(drive("a", "a", keys("O")).notes).toEqual(["openLine:above"]);
  });
});

describe("visual mode", () => {
  it("v selects the char under the cursor; l extends inclusively; d deletes", () => {
    const r = drive("abcdef", "a", keys("vlld"));
    expect(r.text).toBe("def");
    expect(r.mode).toBe("normal");
    expect(r.vsel).toBe(null);
  });

  it("v$d deletes through the last char; vhd extends backwards inclusively", () => {
    expect(drive("abc def", "d", keys("v$d")).text).toBe("abc ");
    expect(drive("abcdef", "d", keys("vhhd")).text).toBe("aef");
  });

  it("viw d / vaw c / vi( y", () => {
    expect(drive("alpha beta", "e", keys("viwd")).text).toBe("alpha ");
    expect(drive("alpha beta gamma", "e", keys("vawc"))).toMatchObject({
      text: "alpha gamma",
      mode: "insert",
    });
    const y = drive("f(a, b)", "a", keys("vi(y"));
    expect(y.register).toEqual({ type: "text", text: "a, b" });
    expect(y.text).toBe("f(a, b)");
  });

  it("V j d deletes two lines; V> shifts an item; vip goes linewise", () => {
    expect(drive("a\n\nb\n\nc", "a", keys("Vjd")).md).toBe("c");
    expect(drive("- a\n- b", "b", keys("V>")).md).toBe("- a\n  - b");
    expect(drive("a\n\nb", "a", keys("vip")).vsel?.kind).toBe("line");
  });

  it("o swaps the ends; v ⇄ V keeps the selection", () => {
    const r = drive("abcdef", "c", keys("vllo"));
    expect(r.vsel).toMatchObject({ anchor: 5, head: 3 });
    const sw = drive("a\n\nb", "a", keys("vjV"));
    expect(sw.vsel?.kind).toBe("line");
    expect(sw.state.selection.$from.parent.textContent).toBe("a");
    expect(sw.state.selection.$to.parent.textContent).toBe("b");
  });

  it("v ~ / u / U change case over the selection; J joins the selected lines", () => {
    expect(drive("abc", "a", keys("vl~")).text).toBe("ABc");
    expect(drive("ABC", "A", keys("vlu")).text).toBe("abC");
    expect(drive("abc", "a", keys("VU")).text).toBe("ABC");
    expect(drive("a\n\nb\n\nc", "a", keys("VjjJ")).text).toBe("a b c");
  });

  it("visual p replaces the selection with the register", () => {
    expect(drive("alpha beta", "alpha", keys("yiwwviwp")).text).toBe("alpha alpha");
    expect(drive("one\n\ntwo\n\nthree", "one", keys("yyjVp")).md).toBe("one\n\none\n\nthree");
  });

  it("Esc collapses to the cursor", () => {
    const r = drive("abcdef", "a", keys("vll"));
    expect(r.vsel).toMatchObject({ anchor: 1, head: 3 });
    const esc = drive("abcdef", "a", [..."vll", "Escape"]);
    expect(esc.mode).toBe("normal");
    expect(esc.under).toBe("c");
  });
});

describe("logical j/k (no view): lineStep keeps the column", () => {
  it("j into a shorter line clamps; k comes back", () => {
    const r = drive("alpha beta\n\nxy", "beta", keys("j"));
    expect(r.doc.resolve(r.head).parent.textContent).toBe("xy");
    expect(r.under).toBe("y");
    expect(drive("ab\n\ncd", "c", keys("k")).under).toBe("a");
  });

  it("j/k step source lines inside a code block and out of it", () => {
    const r = drive("```\none\ntwo\n```\n\npara", "one", keys("jj"));
    expect(r.doc.resolve(r.head).parent.textContent).toBe("para");
    expect(drive("```\none\ntwo\n```", "one", keys("j")).under).toBe("t");
  });
});
