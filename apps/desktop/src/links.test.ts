import { describe, expect, it } from "vitest";
import type { NoteDoc, NoteMeta } from "./backend";
import { computeBacklinks, parseWikilinks, resolveLink, urlAt, wikilinkAt } from "./links";

const meta = (path: string, title: string): NoteMeta => ({
  id: path,
  path,
  title,
  tags: [],
  created: null,
  updated: 0,
  pinned: false,
});
const NOTES: NoteMeta[] = [
  meta("ideas/garden.md", "Digital Garden"),
  meta("meeting-notes.md", "Meeting Notes"),
  meta("untitled.md", "Untitled"),
];
const doc = (m: NoteMeta, body: string): NoteDoc => ({ ...m, body });

describe("parseWikilinks", () => {
  it("parses plain and piped links with positions", () => {
    const links = parseWikilinks("see [[Digital Garden]] and [[meeting-notes|the meeting]] here");
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({ target: "Digital Garden", display: null });
    expect(links[1]).toMatchObject({ target: "meeting-notes", display: "the meeting" });
    expect("see [[Digital Garden]]".slice(links[0].from, links[0].to)).toBe("[[Digital Garden]]");
  });

  it("ignores empty or unterminated brackets", () => {
    expect(parseWikilinks("[[]] and [[oops with no close")).toHaveLength(0);
  });
});

describe("resolveLink", () => {
  it("matches by title, case-insensitively", () => {
    expect(resolveLink("digital garden", NOTES)?.id).toBe("ideas/garden.md");
  });
  it("matches by filename / slug, with or without .md", () => {
    expect(resolveLink("meeting-notes", NOTES)?.id).toBe("meeting-notes.md");
    expect(resolveLink("meeting-notes.md", NOTES)?.id).toBe("meeting-notes.md");
    expect(resolveLink("Meeting Notes", NOTES)?.id).toBe("meeting-notes.md");
  });
  it("returns null for an unknown target", () => {
    expect(resolveLink("does not exist", NOTES)).toBeNull();
  });
  it("never resolves empty / punctuation-only targets to a blank-title note", () => {
    expect(resolveLink("!!!", [meta("blank.md", "")])).toBeNull();
    expect(resolveLink("   ", NOTES)).toBeNull();
  });
  it("prefers an exact filename over a colliding title-slug, deterministically", () => {
    const notes = [meta("a.md", "Hello World"), meta("hello-world.md", "Other")];
    expect(resolveLink("hello-world", notes)?.id).toBe("hello-world.md");
    expect(resolveLink("hello-world", [...notes].reverse())?.id).toBe("hello-world.md");
  });
});

describe("wikilinkAt", () => {
  const line = "go to [[Digital Garden]] now";
  it("returns the target when the column is inside the link", () => {
    expect(wikilinkAt(line, 12)).toBe("Digital Garden");
    expect(wikilinkAt(line, line.indexOf("[["))).toBe("Digital Garden");
  });
  it("returns null when the column is outside", () => {
    expect(wikilinkAt(line, 2)).toBeNull();
    expect(wikilinkAt(line, line.length - 1)).toBeNull();
  });
  it("treats the column just past ]] as outside (half-open end)", () => {
    expect(wikilinkAt("[[A]] x", 4)).toBe("A"); // on the last ]
    expect(wikilinkAt("[[A]] x", 5)).toBeNull(); // the space after ]]
  });
});

describe("urlAt", () => {
  it("returns a bare http(s) URL when the column is inside it", () => {
    const line = "see https://example.com/path here";
    const at = line.indexOf("https");
    expect(urlAt(line, at)).toBe("https://example.com/path");
    expect(urlAt(line, at + 5)).toBe("https://example.com/path");
    expect(urlAt(line, 0)).toBeNull(); // on "see"
  });

  it("trims trailing sentence punctuation", () => {
    const line = "read https://example.com.";
    expect(urlAt(line, line.indexOf("https"))).toBe("https://example.com");
    expect(urlAt(line, line.length - 1)).toBeNull(); // the trailing period is outside
  });

  it("opens a markdown [text](url) target from anywhere in the link", () => {
    const line = "the [docs](https://noteside.app/docs) rock";
    expect(urlAt(line, line.indexOf("docs"))).toBe("https://noteside.app/docs"); // on the text
    expect(urlAt(line, line.indexOf("noteside"))).toBe("https://noteside.app/docs"); // on the url
    expect(urlAt(line, 0)).toBeNull();
  });

  it("ignores a relative (non-external) markdown target", () => {
    const line = "see [notes](./other.md) here";
    expect(urlAt(line, line.indexOf("notes"))).toBeNull();
  });

  it("handles mailto, bare and in a markdown link", () => {
    expect(urlAt("ping mailto:a@b.com now", 7)).toBe("mailto:a@b.com");
    const md = "ping [me](mailto:a@b.com) now";
    expect(urlAt(md, md.indexOf("me"))).toBe("mailto:a@b.com");
  });

  it("returns null when there is no link under the cursor", () => {
    expect(urlAt("just some prose, no links", 5)).toBeNull();
  });

  it("treats the column just past the URL as outside (half-open end)", () => {
    const line = "x https://a.co y";
    const end = line.indexOf("https") + "https://a.co".length;
    expect(urlAt(line, end - 1)).toBe("https://a.co"); // last char of the url
    expect(urlAt(line, end)).toBeNull(); // the space after
  });
});

describe("computeBacklinks", () => {
  it("finds notes that link to the active note and excludes itself", () => {
    const docs = [
      doc(NOTES[0], "# Digital Garden\nlinks to [[Meeting Notes]]"),
      doc(NOTES[1], "# Meeting Notes\nno links here\nbut [[Digital Garden]] referenced"),
      doc(NOTES[2], "standalone, links [[meeting-notes|m]] once"),
    ];
    const back = computeBacklinks("meeting-notes.md", docs, NOTES);
    expect(back.map((b) => b.id).sort()).toEqual(["ideas/garden.md", "untitled.md"]);
    const fromGarden = back.find((b) => b.id === "ideas/garden.md")!;
    expect(fromGarden.lineNumber).toBe(2);
    expect(fromGarden.line).toContain("[[Meeting Notes]]");
  });

  it("returns nothing when no note links to the target", () => {
    const docs = [doc(NOTES[0], "no links"), doc(NOTES[1], "still none")];
    expect(computeBacklinks("untitled.md", docs, NOTES)).toEqual([]);
  });
});
