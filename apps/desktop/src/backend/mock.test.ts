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

  // Parity with rename_note (REGRESSION, review): the stem comparison must strip
  // the directory, and a rename must stay WITHIN the note's own directory.
  it("renameNote no-ops on a nested note whose filename already matches its title", async () => {
    await mockBackend.saveNote("journal/keep-me.md", "# Keep Me\n\nbody");
    const meta = await mockBackend.renameNote("journal/keep-me.md");
    expect(meta.path).toBe("journal/keep-me.md"); // dir-stripped stem matched → no move
  });

  it("recordOpen ranks a note above newer-but-unopened notes in the empty-query recents", async () => {
    const before = await mockBackend.searchFiles("");
    const last = before[before.length - 1]; // the stalest, lowest-ranked note
    await mockBackend.recordOpen(last.path);
    const after = await mockBackend.searchFiles("");
    expect(after[0]?.path).toBe(last.path); // MRU: opened → top of recents
    // never-opened notes keep their relative (updated desc) order behind it
    const rest = after.slice(1).map((h) => h.path);
    expect(rest).toEqual(before.map((h) => h.path).filter((p) => p !== last.path));
  });

  it("renameNote renames within the note's directory (never hoists to the root)", async () => {
    await mockBackend.saveNote("journal/old-name.md", "# Fresh Title\n\nbody");
    const meta = await mockBackend.renameNote("journal/old-name.md");
    expect(meta.path).toBe("journal/fresh-title.md"); // moved, but still in journal/
    expect(meta.title).toBe("Fresh Title");
    await expect(mockBackend.readNote("journal/old-name.md")).rejects.toThrow();
    expect((await mockBackend.readNote("journal/fresh-title.md")).body).toContain("Fresh Title");
  });

  it("deleteNote removes the note from listing and search", async () => {
    const a = await mockBackend.createNote("Alpha To Delete");
    await mockBackend.recordOpen(a.path); // give it frecency so it'd rank in recents
    expect((await mockBackend.searchFiles("")).some((h) => h.path === a.path)).toBe(true);

    await mockBackend.deleteNote(a.path);

    expect((await mockBackend.listNotes()).some((n) => n.path === a.path)).toBe(false);
    expect((await mockBackend.searchFiles("")).some((h) => h.path === a.path)).toBe(false);
    expect((await mockBackend.searchFiles("Alpha")).some((h) => h.path === a.path)).toBe(false);
  });
});
