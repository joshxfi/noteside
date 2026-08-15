// round-trip.test.ts — THE fidelity centerpiece. Markdown files are the source
// of truth, so the editor's parse→serialize loop is held to two invariants:
//
//   1. FIXED POINT (every vector): serialize(parse(x)) = y implies
//      serialize(parse(y)) === y — after at most one normalization pass, a
//      note's on-disk shape never churns again (no watcher echo storms, no
//      git noise beyond the first edit).
//   2. IDENTITY (*.stable.md vectors): y === x byte-for-byte — the common
//      shapes Noteside itself writes must survive untouched.
//
// The manager is built from markdownExtensions() — the SAME configuration the
// editor mounts, so these tests cannot drift from the app.
import { describe, expect, it } from "vitest";
import { MarkdownManager } from "@tiptap/markdown";
import { markdownExtensions } from "./extensions";
import { joinNote, splitNote } from "./markdown-io";

const manager = new MarkdownManager({ extensions: markdownExtensions() });
const roundTrip = (md: string): string => manager.serialize(manager.parse(md));

/** Full disk-text loop the app actually runs: split frontmatter, parse the
 *  body, serialize, re-join. */
const diskRoundTrip = (text: string): string => {
  const io = splitNote(text);
  return joinNote(io, roundTrip(io.body));
};

const vectors = import.meta.glob("../test-vectors/round-trip/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("round-trip vectors", () => {
  for (const [path, raw] of Object.entries(vectors)) {
    const name = path.split("/").pop() as string;
    // Vector files end with a trailing newline (POSIX); the body loop works on
    // the split body, so exercise the full disk loop.
    it(`${name}: serialize∘parse is a fixed point`, () => {
      const once = diskRoundTrip(raw);
      expect(diskRoundTrip(once)).toBe(once);
    });
    if (name.endsWith(".stable.md")) {
      it(`${name}: round-trips byte-identically`, () => {
        expect(diskRoundTrip(raw)).toBe(raw);
      });
    }
  }
});

describe("targeted preservation", () => {
  it("frontmatter + body loop keeps the YAML verbatim", () => {
    const note = '---\npinned: true\ncreated: "2026-01-01"\n---\n# Pinned note\n\nbody text\n';
    expect(diskRoundTrip(note)).toBe(note);
  });

  it("CRLF notes stay CRLF through the full loop", () => {
    const note = "---\r\npinned: true\r\n---\r\n# Title\r\n\r\n- a\r\n- b\r\n";
    expect(diskRoundTrip(note)).toBe(note);
  });

  it("task states round-trip", () => {
    const md = "- [ ] open task\n- [x] done task";
    expect(roundTrip(md)).toBe(md);
  });

  it("literal pipes inside table cells stay escaped (cell-corruption regression)", () => {
    // The stock serializer drops the \| escape, so the cell splits on reparse;
    // table.ts wraps cell rendering with the GFM escape rule.
    const md = "| a | b |\n| --- | --- |\n| pi\\|pe | x |";
    const once = roundTrip(md);
    expect(once).toContain("pi\\|pe");
    expect(roundTrip(once)).toBe(once);
  });

  it("table alignment colons survive", () => {
    const once = roundTrip("| L | C | R |\n| :--- | :---: | ---: |\n| a | b | c |");
    expect(once).toMatch(/\| :-+ \| :-+: \| -+: \|/);
    expect(roundTrip(once)).toBe(once);
  });

  it("math survives byte-identically, inline and block", () => {
    expect(roundTrip("Euler: $e^{i\\pi} + 1 = 0$ inline.")).toBe(
      "Euler: $e^{i\\pi} + 1 = 0$ inline.",
    );
    expect(roundTrip("$$\n\\int_0^1 x^2 dx\n$$")).toBe("$$\n\\int_0^1 x^2 dx\n$$");
  });

  it("images keep their written src verbatim (relative paths included)", () => {
    expect(roundTrip("![alt](./assets/pic.png)")).toBe("![alt](./assets/pic.png)");
    expect(roundTrip('![c](https://x.dev/c.png "t")')).toBe('![c](https://x.dev/c.png "t")');
  });

  it("callouts round-trip as GFM alerts; plain quotes stay plain", () => {
    const callout = "> [!WARNING]\n> Careful now.";
    expect(roundTrip(callout)).toBe(callout);
    const quote = "> just a quote\n> across lines";
    expect(roundTrip(quote)).toBe(quote);
  });

  it("the [!KIND] marker with an inline lead splits onto its own line", () => {
    expect(roundTrip("> [!TIP] lead text")).toBe("> [!TIP]\n> lead text");
  });

  it("raw html blocks are byte-preserved, not entity-escaped", () => {
    const md = '<div class="x">\n  <b>raw</b>\n</div>';
    expect(roundTrip(md)).toBe(md);
    expect(roundTrip(md)).not.toContain("&lt;");
  });

  it("nested list indentation is the serializer's own 2-space unit", () => {
    const md = "- a\n  - a1\n    - a2";
    expect(roundTrip(md)).toBe(md);
  });

  it("escapes that matter keep escaping", () => {
    const md = "not \\*emphasis\\* here";
    expect(roundTrip(md)).toBe(md);
  });
});

describe("documented normalizations (deliberate, pinned so they never surprise)", () => {
  it("setext headings become ATX", () => {
    expect(roundTrip("Title\n=====\n\nbody")).toBe("# Title\n\nbody");
  });

  it("reference links are inlined", () => {
    expect(roundTrip("[ref][1]\n\n[1]: https://x.dev")).toBe("[ref](https://x.dev)");
  });

  it("bare autolinked URLs gain explicit link syntax", () => {
    expect(roundTrip("visit https://x.dev today")).toBe(
      "visit [https://x.dev](https://x.dev) today",
    );
  });

  it("unrecognized INLINE html degrades to escaped text (block html does not)", () => {
    // The markdown manager hard-codes inline html handling ahead of extension
    // handlers — this pins the (accepted) v1 behavior so a change is noticed.
    expect(roundTrip("before <kbd>K</kbd> after")).toContain("&lt;kbd&gt;");
  });
});
