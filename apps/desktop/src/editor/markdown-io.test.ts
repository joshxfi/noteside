// markdown-io.ts is the byte-fidelity seam: frontmatter must survive every
// save verbatim (Rust reads title:/tags:/pinned: out of it), and a file's own
// line-ending + trailing-newline shape must be preserved so Rust's surgical
// rewrites and the watcher's echo suppression stay coherent.
import { describe, expect, it } from "vitest";
import { joinNote, splitNote } from "./markdown-io";

/** The identity round-trip: split, hand the body back unchanged, join. */
function roundTrip(text: string): string {
  const io = splitNote(text);
  return joinNote(io, io.body);
}

describe("splitNote", () => {
  it("passes a plain note through with no frontmatter", () => {
    // The body never carries the final newline — joinNote restores it.
    const io = splitNote("# Title\n\nbody text\n");
    expect(io.frontmatter).toBe("");
    expect(io.frontmatterLines).toBe(0);
    expect(io.body).toBe("# Title\n\nbody text");
    expect(io.crlf).toBe(false);
    expect(io.trailingNewline).toBe(true);
  });

  it("splits a pinned note's frontmatter verbatim", () => {
    const io = splitNote("---\npinned: true\n---\n# Title\n\nbody\n");
    expect(io.frontmatter).toBe("---\npinned: true\n---\n");
    expect(io.frontmatterLines).toBe(3);
    expect(io.body).toBe("# Title\n\nbody");
  });

  it("mirrors scanFrontmatter: an unclosed block is NOT frontmatter", () => {
    const io = splitNote("---\ntitle: x\nno closing fence\n");
    expect(io.frontmatter).toBe("");
    expect(io.body).toBe("---\ntitle: x\nno closing fence");
  });

  it("mirrors scanFrontmatter: the opening --- must be line 0 and bare", () => {
    expect(splitNote("\n---\nx\n---\n").frontmatter).toBe("");
    expect(splitNote("--- \nx\n---\n").frontmatter).toBe("");
  });

  it("closing fence may carry trailing whitespace (Rust parity)", () => {
    const io = splitNote("---\ntitle: x\n---  \nbody\n");
    expect(io.frontmatter).toBe("---\ntitle: x\n---  \n");
    expect(io.body).toBe("body");
  });

  it("detects CRLF and normalizes the editor body to LF", () => {
    const io = splitNote("---\r\npinned: true\r\n---\r\nbody one\r\nbody two\r\n");
    expect(io.crlf).toBe(true);
    expect(io.frontmatter).toBe("---\npinned: true\n---\n");
    expect(io.body).toBe("body one\nbody two");
  });

  it("handles the empty file and the frontmatter-only file", () => {
    const empty = splitNote("");
    expect(empty.body).toBe("");
    expect(empty.trailingNewline).toBe(false);

    const fmOnly = splitNote("---\npinned: true\n---\n");
    expect(fmOnly.frontmatter).toBe("---\npinned: true\n---\n");
    expect(fmOnly.body).toBe("");
  });
});

describe("joinNote", () => {
  const IDENTITY_CASES: [string, string][] = [
    ["plain LF note", "# T\n\nbody\n"],
    ["no trailing newline", "# T\n\nbody"],
    ["frontmatter + body", "---\npinned: true\ntags: [a, b]\n---\n# T\n\nbody\n"],
    ["frontmatter, no trailing newline", "---\ntitle: x\n---\nbody"],
    ["frontmatter only", "---\npinned: true\n---\n"],
    ["frontmatter only, unterminated", "---\npinned: true\n---"],
    ["CRLF throughout", "---\r\npinned: true\r\n---\r\n# T\r\n\r\nbody\r\n"],
    ["CRLF, no trailing newline", "# T\r\n\r\nbody"],
    ["empty file", ""],
    ["--- later in the body is not frontmatter", "intro\n\n---\n\noutro\n"],
    ["trailing blank lines", "body\n\n\n"],
  ];

  for (const [name, text] of IDENTITY_CASES) {
    it(`is byte-identical for: ${name}`, () => {
      expect(roundTrip(text)).toBe(text);
    });
  }

  it("re-applies CRLF to a rewritten body", () => {
    const io = splitNote("# Old\r\nbody\r\n");
    expect(joinNote(io, "# New\nbody line")).toBe("# New\r\nbody line\r\n");
  });

  it("restores the missing trailing newline a serializer added", () => {
    const io = splitNote("# T\nbody"); // no trailing newline on disk
    expect(joinNote(io, "# T\nbody\n")).toBe("# T\nbody");
  });

  it("adds the trailing newline a serializer dropped", () => {
    const io = splitNote("# T\nbody\n");
    expect(joinNote(io, "# T\nbody")).toBe("# T\nbody\n");
  });

  it("keeps frontmatter verbatim when the body is re-serialized", () => {
    const fm = '---\npinned: true\ncreated: "2026-01-01"\n---\n';
    const io = splitNote(fm + "# Title\n\n- a\n- b\n");
    const out = joinNote(io, "# Title\n\n- a\n- b\n- c");
    expect(out.startsWith(fm)).toBe(true);
    expect(out.endsWith("- c\n")).toBe(true);
  });
});
