import { describe, expect, it } from "vitest";
import { CHECK_INTERVAL_MS, dueForCheck, isNewer } from "./check-update";

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

describe("dueForCheck", () => {
  const NOW = 1_000_000_000_000;
  it("is due when never checked (0 / non-finite)", () => {
    expect(dueForCheck(NOW, 0)).toBe(true);
    expect(dueForCheck(NOW, NaN)).toBe(true);
  });
  it("is not due within the interval", () => {
    expect(dueForCheck(NOW, NOW - 1)).toBe(false);
    expect(dueForCheck(NOW, NOW - (CHECK_INTERVAL_MS - 1))).toBe(false);
  });
  it("is due once the interval has elapsed", () => {
    expect(dueForCheck(NOW, NOW - CHECK_INTERVAL_MS)).toBe(true);
    expect(dueForCheck(NOW, NOW - 2 * CHECK_INTERVAL_MS)).toBe(true);
  });
  it("is due when the stored time is in the future (clock skew)", () => {
    expect(dueForCheck(NOW, NOW + CHECK_INTERVAL_MS)).toBe(true);
  });
});
