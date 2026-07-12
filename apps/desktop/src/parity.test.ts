import { describe, expect, it } from "vitest";
import { slugifyTitle } from "./links";
import vectors from "./test-vectors/parity.json";

// Shared golden vectors that MUST produce identical output in the Rust backend
// (see the #[cfg(test)] parity tests in notebook.rs). The JS side is the
// canonical behavior; if a vector changes here, update both suites.
describe("JS↔Rust parity vectors", () => {
  it("slugifyTitle matches the shared slug vectors", () => {
    for (const { in: input, out } of vectors.slug) {
      expect(slugifyTitle(input)).toBe(out);
    }
  });
});
