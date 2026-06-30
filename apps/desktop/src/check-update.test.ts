import { describe, expect, it } from "vitest";
import { isNewer } from "./check-update";

describe("isNewer", () => {
  it("detects a newer version", () => {
    expect(isNewer("1.2.0", "1.1.0")).toBe(true);
    expect(isNewer("2.0.0", "1.9.9")).toBe(true);
    expect(isNewer("1.1.1", "1.1.0")).toBe(true);
  });

  it("returns false for an equal or older version", () => {
    expect(isNewer("1.1.0", "1.1.0")).toBe(false);
    expect(isNewer("1.0.0", "1.1.0")).toBe(false);
    expect(isNewer("1.9.9", "2.0.0")).toBe(false);
  });

  it("treats missing trailing parts as 0", () => {
    expect(isNewer("1.1", "1.1.0")).toBe(false);
    expect(isNewer("1.1.1", "1.1")).toBe(true);
    expect(isNewer("1.2", "1.1.9")).toBe(true);
  });

  it("treats non-numeric / empty parts as 0", () => {
    expect(isNewer("1.1.0", "1.1.x")).toBe(false); // 1.1.x → 1.1.0, equal
    expect(isNewer("", "1.0.0")).toBe(false);
  });
});
