import { describe, expect, it } from "vitest";
import { urlAt } from "./links";

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
