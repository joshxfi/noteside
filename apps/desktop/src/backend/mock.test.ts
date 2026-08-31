import { describe, expect, it } from "vitest";
import { mockBackend, setPinnedBody } from "./mock";

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

  it("setPinned floats a stale note above a newer one, and unpinning restores it", async () => {
    const notes = await mockBackend.listNotes();
    const stale = notes[notes.length - 1]; // oldest `updated` → normally sorts last
    expect(stale.pinned).toBe(false);
    const fresh = await mockBackend.createNote("Newest Note"); // sorts first on recency

    const meta = await mockBackend.setPinned(stale.path, true);
    expect(meta.pinned).toBe(true);
    expect(meta.title).toBe(stale.title); // pinning never retitles a note
    // pinned beats recency — that is the whole point of the flag
    expect((await mockBackend.listNotes())[0]?.path).toBe(stale.path);
    expect((await mockBackend.readNote(stale.path)).body).toContain("pinned: true");

    const un = await mockBackend.setPinned(stale.path, false);
    expect(un.pinned).toBe(false);
    // the note drops back below the pinned tier; the frontmatter is gone entirely
    expect((await mockBackend.readNote(stale.path)).body).not.toContain("pinned:");
    await mockBackend.deleteNote(fresh.path);
  });

  it("setPinned to the state a note is already in does not bump `updated`", async () => {
    // `updated` is the sidebar's sort key, so a redundant unpin must not jump
    // the note to the top of "recently updated" (Rust skips the write too).
    const note = (await mockBackend.listNotes())[1];
    expect(note.pinned).toBe(false);
    const meta = await mockBackend.setPinned(note.path, false);
    expect(meta.updated).toBe(note.updated);

    await mockBackend.setPinned(note.path, true);
    const pinned = (await mockBackend.listNotes()).find((n) => n.path === note.path)!;
    const again = await mockBackend.setPinned(note.path, true);
    expect(again.updated).toBe(pinned.updated);
    await mockBackend.setPinned(note.path, false); // restore
  });

  // REGRESSION (stability pass): setTitle used to scan from byte 0, so retitling
  // a PINNED note prepended the new heading ABOVE the frontmatter block —
  // corrupting the note (the raw `---` rendered as text and unpin broke forever).
  it("retitling a pinned note edits past its frontmatter, never above it", async () => {
    const a = await mockBackend.createNote("Pinned Then Renamed");
    await mockBackend.setPinned(a.path, true);
    const meta = await mockBackend.retitleNote(a.path, "Still Pinned");
    const body = (await mockBackend.readNote(meta.path)).body;
    expect(body.startsWith("---\npinned: true\n---\n")).toBe(true); // block intact at byte 0
    expect(body).toContain("# Still Pinned");
    expect(meta.pinned).toBe(true);
    // unpin still round-trips the block away
    await mockBackend.setPinned(meta.path, false);
    expect((await mockBackend.readNote(meta.path)).body).not.toContain("pinned:");
    await mockBackend.deleteNote(meta.path);
  });

  it("duplicating a pinned note yields a pinned copy (parity with Rust)", async () => {
    const a = await mockBackend.createNote("Pinned Original");
    await mockBackend.setPinned(a.path, true);
    const copy = await mockBackend.duplicateNote(a.path);
    expect(copy.pinned).toBe(true);
    const body = (await mockBackend.readNote(copy.path)).body;
    expect(body.startsWith("---\npinned: true\n---\n")).toBe(true);
    expect(body).toContain("# Pinned Original copy");
    await mockBackend.deleteNote(a.path);
    await mockBackend.deleteNote(copy.path);
  });

  it("a frontmatter title: is authoritative and setTitle replaces it in place", async () => {
    const meta = await mockBackend.saveNote(
      "fm-titled.md",
      "---\ntitle: Official Name\n---\n# Some Heading\nbody",
    );
    expect(meta.title).toBe("Official Name"); // parse_meta precedence: frontmatter first
    const renamed = await mockBackend.retitleNote("fm-titled.md", "New Official");
    const body = (await mockBackend.readNote(renamed.path)).body;
    expect(body).toContain("title: New Official");
    expect(body).toContain("# Some Heading"); // the body heading is left alone
    await mockBackend.deleteNote(renamed.path);
  });

  it("saveNote falls back to the filename stem, never the full path", async () => {
    // A first non-blank prose line still titles the note (Rust heading_title)…
    const meta = await mockBackend.saveNote("journal/no-heading.md", "just prose, no heading");
    expect(meta.title).toBe("just prose, no heading");
    // …the stem fallback only applies when the body yields nothing.
    const empty = await mockBackend.saveNote("journal/blank-note.md", "");
    expect(empty.title).toBe("blank note"); // '-' opened to space, not "journal/blank-note.md"
    await mockBackend.deleteNote("journal/no-heading.md");
    await mockBackend.deleteNote("journal/blank-note.md");
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

describe("mock backend — folders", () => {
  it("lists seeded folders including the empty archive", async () => {
    const dirs = await mockBackend.listFolders();
    for (const d of ["archive", "ideas", "journal", "recipes", "work"]) {
      expect(dirs).toContain(d);
    }
    expect(dirs).toEqual([...dirs].sort());
  });

  it("moveNote preserves the stem, keeps updated, and migrates frecency", async () => {
    const a = await mockBackend.createNote("Movable");
    await mockBackend.recordOpen(a.path);
    const moved = await mockBackend.moveNote(a.path, "archive");
    expect(moved.path).toBe("archive/movable.md");
    expect(moved.updated).toBe(a.updated); // a move is not an edit — sort key untouched
    expect((await mockBackend.listNotes()).some((n) => n.id === a.path)).toBe(false);
    // Frecency followed the id: the empty-query recents still rank it.
    const recents = await mockBackend.searchFiles("");
    expect(recents[0]?.path).toBe("archive/movable.md");
    await mockBackend.deleteNote(moved.path);
  });

  it("moveNote to the same folder is a no-op returning the current meta", async () => {
    const a = await mockBackend.createNote("Stay Put", "archive");
    const same = await mockBackend.moveNote(a.path, "archive");
    expect(same.path).toBe(a.path);
    expect(same.updated).toBe(a.updated);
    await mockBackend.deleteNote(a.path);
  });

  it("moveNote resolves destination collisions with -N", async () => {
    const a = await mockBackend.createNote("Clash");
    const b = await mockBackend.createNote("Clash", "archive");
    const moved = await mockBackend.moveNote(a.path, "archive");
    expect(b.path).toBe("archive/clash.md");
    expect(moved.path).toBe("archive/clash-2.md");
    await mockBackend.deleteNote(b.path);
    await mockBackend.deleteNote(moved.path);
  });

  it("createFolder sanitizes segments and registers ancestors", async () => {
    const rel = await mockBackend.createFolder("pro/jects ");
    expect(rel).toBe("pro/jects");
    const dirs = await mockBackend.listFolders();
    expect(dirs).toContain("pro");
    expect(dirs).toContain("pro/jects");
    await mockBackend.deleteFolder("pro");
  });

  it("renameFolder rewrites the subtree's ids, folders, and frecency", async () => {
    await mockBackend.createFolder("box/inner");
    const a = await mockBackend.createNote("Boxed", "box/inner");
    await mockBackend.recordOpen(a.path);
    const newDir = await mockBackend.renameFolder("box", "crate");
    expect(newDir).toBe("crate");
    const dirs = await mockBackend.listFolders();
    expect(dirs).toContain("crate");
    expect(dirs).toContain("crate/inner");
    expect(dirs).not.toContain("box");
    const notes = await mockBackend.listNotes();
    expect(notes.some((n) => n.id === "crate/inner/boxed.md")).toBe(true);
    expect(notes.some((n) => n.id === a.path)).toBe(false);
    const recents = await mockBackend.searchFiles("");
    expect(recents[0]?.path).toBe("crate/inner/boxed.md");
    // An occupied target errors — no silent -N for directories.
    await mockBackend.createFolder("other");
    await expect(mockBackend.renameFolder("other", "crate")).rejects.toThrow();
    await mockBackend.deleteFolder("crate");
    await mockBackend.deleteFolder("other");
  });

  it("deleteFolder drops the subtree recursively", async () => {
    await mockBackend.createFolder("junk/sub");
    const a = await mockBackend.createNote("Junked", "junk/sub");
    await mockBackend.recordOpen(a.path);
    await mockBackend.deleteFolder("junk");
    expect((await mockBackend.listFolders()).some((d) => d.startsWith("junk"))).toBe(false);
    expect((await mockBackend.listNotes()).some((n) => n.id.startsWith("junk/"))).toBe(false);
    expect((await mockBackend.searchFiles("")).some((h) => h.path.startsWith("junk/"))).toBe(false);
  });

  it("createNote in a folder lands there and registers the dir", async () => {
    const a = await mockBackend.createNote("Filed", "cabinet");
    expect(a.path).toBe("cabinet/filed.md");
    expect(await mockBackend.listFolders()).toContain("cabinet");
    await mockBackend.deleteFolder("cabinet");
  });
});

// setPinnedBody mirrors Rust notebook::set_pinned — same cases as
// notebook.rs's set_pinned_* tests, so the two adapters can't drift.
describe("setPinnedBody (mirror of Rust set_pinned)", () => {
  const roundTrip = (original: string) =>
    expect(setPinnedBody(setPinnedBody(original, true), false)).toBe(original);

  it("opens a frontmatter block for a plain note", () => {
    expect(setPinnedBody("# Note\n\nbody\n", true)).toBe(
      "---\npinned: true\n---\n# Note\n\nbody\n",
    );
    expect(setPinnedBody("# Note\n\nbody\n", false)).toBe("# Note\n\nbody\n");
  });

  it("inserts into existing frontmatter without touching other keys", () => {
    expect(setPinnedBody("---\ntitle: T\ntags: [a]\n---\nbody", true)).toBe(
      "---\npinned: true\ntitle: T\ntags: [a]\n---\nbody",
    );
  });

  it("rewrites an existing key in place, preserving indentation", () => {
    expect(setPinnedBody("---\ntitle: T\npinned: false\n---\nbody", true)).toBe(
      "---\ntitle: T\npinned: true\n---\nbody",
    );
    expect(setPinnedBody("---\n  pinned: false\n---\nbody", true)).toBe(
      "---\n  pinned: true\n---\nbody",
    );
  });

  it("unpinning drops the key but keeps the rest of the frontmatter", () => {
    expect(setPinnedBody("---\ntitle: T\npinned: true\ntags: [a]\n---\nbody", false)).toBe(
      "---\ntitle: T\ntags: [a]\n---\nbody",
    );
  });

  it("unpinning the only key removes the whole block", () => {
    expect(setPinnedBody("---\npinned: true\n---\nbody", false)).toBe("body");
  });

  it("round-trips every frontmatter shape back to the original bytes", () => {
    roundTrip("# Note\n\nbody\n");
    roundTrip("plain text, no heading");
    roundTrip("");
    roundTrip("---\ntitle: T\n---\n# Note\nbody\n");
    roundTrip("---\ntitle: T\ntags: [a, b]\ncreated: 2026-01-01\n---\nbody");
    roundTrip("# CRLF\r\nbody\r\n");
    roundTrip("---\r\ntitle: T\r\n---\r\nbody\r\n");
  });

  it("preserves CRLF line endings", () => {
    expect(setPinnedBody("# Note\r\nbody\r\n", true)).toBe(
      "---\r\npinned: true\r\n---\r\n# Note\r\nbody\r\n",
    );
    expect(setPinnedBody("---\r\ntitle: T\r\n---\r\nbody\r\n", true)).toBe(
      "---\r\npinned: true\r\ntitle: T\r\n---\r\nbody\r\n",
    );
  });
});

// The mock now backs the notebook switcher too — it seeds a second notebook so
// switching is exercisable in the demo/e2e. These run after the block above (which
// only touches /demo-notebook) and each restores current to /demo-notebook.
describe("mock backend — notebooks", () => {
  it("lists the seeded notebooks with folder-basename names", async () => {
    const nbs = await mockBackend.listNotebooks();
    expect(nbs.some((n) => n.path === "/demo-notebook")).toBe(true);
    const journal = nbs.find((n) => n.path === "/demo-journal");
    expect(journal?.name).toBe("demo-journal");
  });

  it("openNotebook swaps the note set and current path", async () => {
    expect((await mockBackend.listNotes()).some((n) => n.path === "welcome.md")).toBe(true);

    const journal = await mockBackend.openNotebook("/demo-journal");
    expect(journal.some((n) => n.path === "monday.md")).toBe(true);
    expect(journal.some((n) => n.path === "welcome.md")).toBe(false);
    expect(await mockBackend.currentNotebook()).toBe("/demo-journal");

    const back = await mockBackend.openNotebook("/demo-notebook");
    expect(back.some((n) => n.path === "welcome.md")).toBe(true);
    expect(await mockBackend.currentNotebook()).toBe("/demo-notebook");
  });

  it("frecency is isolated per notebook", async () => {
    await mockBackend.openNotebook("/demo-journal");
    await mockBackend.recordOpen("ideas.md");
    expect((await mockBackend.searchFiles(""))[0]?.path).toBe("ideas.md"); // opened → top

    await mockBackend.openNotebook("/demo-notebook");
    // the journal's note (and its frecency) must not leak into this notebook
    expect((await mockBackend.searchFiles("")).some((h) => h.path === "ideas.md")).toBe(false);
  });

  it("opening an unknown folder creates an empty notebook", async () => {
    expect(await mockBackend.openNotebook("/brand-new")).toEqual([]);
    expect((await mockBackend.listNotebooks()).some((n) => n.path === "/brand-new")).toBe(true);
    await mockBackend.openNotebook("/demo-notebook"); // restore
  });

  it("rememberNotebook moves a notebook to the front of the recents", async () => {
    await mockBackend.rememberNotebook("/demo-journal");
    expect((await mockBackend.listNotebooks())[0]?.path).toBe("/demo-journal");
    await mockBackend.rememberNotebook("/demo-notebook"); // restore MRU order
  });

  it("createNotebook builds a sanitized path under the parent; opening it is empty", async () => {
    expect(await mockBackend.createNotebook("/", "My Fresh Notebook")).toBe("/My Fresh Notebook");
    expect(await mockBackend.createNotebook("/vault", "work:2?")).toBe("/vault/work2");

    expect(await mockBackend.openNotebook("/My Fresh Notebook")).toEqual([]);
    expect((await mockBackend.listNotebooks())[0]?.path).toBe("/My Fresh Notebook");
    await mockBackend.openNotebook("/demo-notebook"); // restore current
  });

  it("removeRecentNotebook drops a recent but never the current one", async () => {
    await mockBackend.openNotebook("/demo-scratch"); // add a throwaway recent
    await mockBackend.openNotebook("/demo-notebook"); // back to current
    expect((await mockBackend.listNotebooks()).some((n) => n.path === "/demo-scratch")).toBe(true);

    await mockBackend.removeRecentNotebook("/demo-scratch");
    expect((await mockBackend.listNotebooks()).some((n) => n.path === "/demo-scratch")).toBe(false);

    // the currently-open notebook is guarded (a failed switch prunes the target,
    // never the one you're still in)
    await mockBackend.removeRecentNotebook("/demo-notebook");
    expect((await mockBackend.listNotebooks()).some((n) => n.path === "/demo-notebook")).toBe(true);
  });
});
