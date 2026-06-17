import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutosave } from "./autosave";

describe("createAutosave", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("saves the scheduled note after the delay", () => {
    const saved: Array<[string, string]> = [];
    const a = createAutosave((id, text) => saved.push([id, text]), 800);
    a.schedule("a.md", "hello");
    vi.advanceTimersByTime(799);
    expect(saved).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(saved).toEqual([["a.md", "hello"]]);
  });

  it("debounces rapid edits into one save with the latest text", () => {
    const saved: Array<[string, string]> = [];
    const a = createAutosave((id, text) => saved.push([id, text]), 800);
    a.schedule("a.md", "h");
    vi.advanceTimersByTime(400);
    a.schedule("a.md", "he");
    vi.advanceTimersByTime(400);
    a.schedule("a.md", "hel");
    vi.advanceTimersByTime(800);
    expect(saved).toEqual([["a.md", "hel"]]);
  });

  it("materializes lazy text only when the queued save lands", () => {
    const saved: Array<[string, string]> = [];
    let reads = 0;
    let latest = "h";
    const a = createAutosave((id, text) => saved.push([id, text]), 800);
    a.schedule("a.md", () => {
      reads++;
      return latest;
    });
    latest = "he";
    a.schedule("a.md", () => {
      reads++;
      return latest;
    });
    expect(reads).toBe(0);
    vi.advanceTimersByTime(800);
    expect(saved).toEqual([["a.md", "he"]]);
    expect(reads).toBe(1);
  });

  // The bug the v1 review caught: a queued save fired against the *active* note
  // instead of the note it was scheduled for, corrupting the new note.
  it("REGRESSION: a queued save always targets its own note", () => {
    const saved: Array<[string, string]> = [];
    const a = createAutosave((id, text) => saved.push([id, text]), 800);
    a.schedule("a.md", "content A"); // editing A
    a.flush(); // switching away from A → persist A now
    a.schedule("b.md", "content B"); // now editing B
    vi.advanceTimersByTime(800);
    expect(saved).toEqual([
      ["a.md", "content A"],
      ["b.md", "content B"],
    ]);
    // B must never receive A's content
    expect(saved.some(([id, t]) => id === "b.md" && t === "content A")).toBe(false);
  });

  it("flush() runs the queued save immediately and clears the timer", () => {
    const saved: Array<[string, string]> = [];
    const a = createAutosave((id, text) => saved.push([id, text]), 800);
    a.schedule("a.md", "x");
    a.flush();
    expect(saved).toEqual([["a.md", "x"]]);
    vi.advanceTimersByTime(800); // timer was cleared — no duplicate save
    expect(saved).toEqual([["a.md", "x"]]);
  });

  it("cancel() drops the queued save", () => {
    const saved: Array<[string, string]> = [];
    const a = createAutosave((id, text) => saved.push([id, text]), 800);
    a.schedule("a.md", "x");
    a.cancel();
    vi.advanceTimersByTime(800);
    expect(saved).toEqual([]);
  });

  it("flush() with nothing queued is a no-op", () => {
    const saved: Array<[string, string]> = [];
    const a = createAutosave((id, text) => saved.push([id, text]), 800);
    a.flush();
    expect(saved).toEqual([]);
  });
});
