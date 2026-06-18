import { describe, expect, it } from "vitest";
import { mockBackend } from "./mock";

// The mock backs browser dev + the landing demo; the live Rust search is tested
// separately (cargo test). These cover the mock's behavioral parity.
describe("mock backend", () => {
  it("lists the seeded notes", async () => {
    const notes = await mockBackend.listNotes();
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.some((n) => n.path === "welcome.md")).toBe(true);
  });

  it("fuzzy file search matches by path with positions", async () => {
    const hits = await mockBackend.searchFiles("welcome");
    expect(hits[0]?.path).toBe("welcome.md");
    expect(hits[0]?.positions.length).toBeGreaterThan(0);
    expect(hits[0]?.titlePositions.length).toBeGreaterThan(0);
  });

  it("fuzzy file search matches by title when the path does not match", async () => {
    const hits = await mockBackend.searchFiles("design");
    expect(hits[0]?.title).toBe("Sync — design review");
    expect(hits[0]?.path).toBe("work/meeting-notes.md");
    expect(hits[0]?.positions).toEqual([]);
    expect(hits[0]?.titlePositions.length).toBeGreaterThan(0);
  });

  it("plain content search finds a known seeded line", async () => {
    const hits = await mockBackend.searchContent("kettle", "plain");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].line.toLowerCase()).toContain("kettle");
    expect(hits[0].ranges.length).toBeGreaterThan(0);
  });

  it("createNote slugifies and de-duplicates the filename", async () => {
    const a = await mockBackend.createNote("My New Note");
    expect(a.path).toBe("my-new-note.md");
    const b = await mockBackend.createNote("My New Note");
    expect(b.path).toBe("my-new-note-2.md");
  });

  it("saveNote derives the title from the first heading", async () => {
    const meta = await mockBackend.saveNote("scratch.md", "# Derived Title\n\nbody");
    expect(meta.title).toBe("Derived Title");
    expect((await mockBackend.readNote("scratch.md")).body).toContain("# Derived Title");
  });
});
