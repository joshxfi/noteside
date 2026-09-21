import { describe, expect, it } from "vitest";
import { setPinnedBody } from "./backend/mock";
import { slugifyTitle } from "./links";
import { frontmatterEndLine } from "./markdown";
import vectors from "./test-vectors/parity.json";

/** The documented offset rule on top of `frontmatterEndLine`: split on "\n",
 *  compare lines with a trailing `\r` stripped, then sum `line.length + 1`
 *  (the "\n") through the CLOSING line. This is the same derivation the mock's
 *  private `bodyStart` performs — reimplemented here on purpose, so what the
 *  vectors pin is the RULE reproducing Rust's byte offsets, not one caller. */
function bodyStartFromRule(text: string): number {
  const raw = text.split("\n");
  const end = frontmatterEndLine(raw.length, (i) => raw[i].replace(/\r$/, ""));
  if (end < 0) return 0;
  let offset = 0;
  for (let i = 0; i <= end; i++) offset += raw[i].length + 1;
  return Math.min(offset, text.length);
}

// Shared golden vectors that MUST produce identical output in the Rust backend
// (see the #[cfg(test)] parity tests in notebook.rs). The JS side is the
// canonical behavior; if a vector changes here, update both suites.
describe("JS↔Rust parity vectors", () => {
  it("slugifyTitle matches the shared slug vectors", () => {
    for (const { in: input, out } of vectors.slug) {
      expect(slugifyTitle(input)).toBe(out);
    }
  });

  it("setPinnedBody matches the shared pin vectors", () => {
    for (const c of vectors.pin) {
      expect(setPinnedBody(c.in, c.pinned)).toBe(c.out);
    }
  });

  // Pinning must never be destructive: pin then unpin restores the bytes.
  it("pin→unpin round-trips every shared shape", () => {
    for (const s of vectors.pinRoundTrip) {
      expect(setPinnedBody(setPinnedBody(s, true), false)).toBe(s);
    }
  });

  it("frontmatter boundary matches the shared vectors", () => {
    for (const c of vectors.frontmatter) {
      expect(bodyStartFromRule(c.in)).toBe(c.bodyStart);
    }
  });
});
