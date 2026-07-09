import { describe, expect, it } from "vitest";
import { parseWikilinks, slugifyTitle } from "./links";
import vectors from "./test-vectors/parity.json";

// Shared golden vectors that MUST produce identical output in the Rust backend
// (see the #[cfg(test)] parity tests in notebook.rs and links.rs). The JS side
// is the canonical behavior; if a vector changes here, update both suites.
describe("JS↔Rust parity vectors", () => {
  it("slugifyTitle matches the shared slug vectors", () => {
    for (const { in: input, out } of vectors.slug) {
      expect(slugifyTitle(input)).toBe(out);
    }
  });

  it("parseWikilinks targets match the shared wikilink vectors", () => {
    for (const { line, out } of vectors.wikilinkTargets) {
      const targets = parseWikilinks(line)
        .map((w) => w.target)
        .filter(Boolean);
      expect(targets).toEqual(out);
    }
  });
});
