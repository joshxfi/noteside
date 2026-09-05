import { describe, expect, it } from "vitest";
import type { NoteMeta } from "./backend/types";
import {
  allDirs,
  buildSidebarRows,
  noteDir,
  rewritePrefix,
  stepVisibleNote,
  visibleNoteIds,
} from "./note-groups";

function meta(path: string, opts: { updated?: number; pinned?: boolean } = {}): NoteMeta {
  return {
    id: path,
    path,
    title: path,
    tags: [],
    created: null,
    updated: opts.updated ?? 0,
    pinned: opts.pinned ?? false,
  };
}

/** The backend sort (pinned desc, updated desc) the rows derivation assumes. */
function sorted(notes: NoteMeta[]): NoteMeta[] {
  return [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated - a.updated);
}

describe("noteDir / allDirs", () => {
  it("derives dirs, including intermediates of nested note paths", () => {
    expect(noteDir("a.md")).toBe("");
    expect(noteDir("work/a.md")).toBe("work");
    expect(noteDir("work/sub/a.md")).toBe("work/sub");
    const dirs = allDirs([meta("work/sub/a.md")], ["archive"]);
    expect(dirs).toEqual(["archive", "work", "work/sub"]);
    // A folder entry's ancestors are completed too (a locally patched list may
    // insert just "a/b" — the backend registered "a", the union must as well).
    expect(allDirs([], ["a/b"])).toEqual(["a", "a/b"]);
  });

  it("sorts byte-wise like the Rust index ('/' before letters)", () => {
    const dirs = allDirs([meta("dir/nested.md"), meta("dir2/x.md")], []);
    expect(dirs).toEqual(["dir", "dir2"]);
  });
});

describe("buildSidebarRows", () => {
  const notes = sorted([
    meta("welcome.md", { updated: 50 }),
    meta("keymap.md", { updated: 40, pinned: true }),
    meta("journal/morning.md", { updated: 90 }),
    meta("journal/night.md", { updated: 95, pinned: true }),
    meta("work/projects/roadmap.md", { updated: 10 }),
  ]);

  it("puts the folder groups first, then a divider, then the root notes", () => {
    const rows = buildSidebarRows(notes, ["archive"], new Set());
    const shape = rows.map((r) =>
      r.kind === "note" ? r.note.path : r.kind === "folder" ? `[${r.dir}]` : "---",
    );
    expect(shape).toEqual([
      "[archive]", // an expanded empty group is just its header
      "[journal]",
      "journal/night.md", // pinned floats within its group, not to the root
      "journal/morning.md",
      "[work]", // an intermediate dir with no direct notes is an empty group
      "[work/projects]", // nested dir = ONE group with the full label
      "work/projects/roadmap.md",
      "---", // the hairline between the groups and the loose notes
      "keymap.md", // pinned floats within its section
      "welcome.md",
    ]);
  });

  it("omits the divider when there are no folders or no root notes", () => {
    const rootOnly = buildSidebarRows(
      notes.filter((n) => !n.path.includes("/")),
      [],
      new Set(),
    );
    expect(rootOnly.map((r) => r.kind)).toEqual(["note", "note"]);
    const foldersOnly = buildSidebarRows(
      notes.filter((n) => n.path.includes("/")),
      [],
      new Set(),
    );
    expect(foldersOnly.some((r) => r.kind === "divider")).toBe(false);
  });

  it("collapse hides members; an empty group is a header either way", () => {
    const rows = buildSidebarRows(notes, ["archive"], new Set(["journal", "archive"]));
    expect(rows.some((r) => r.kind === "note" && r.dir === "journal")).toBe(false);
    expect(rows.filter((r) => r.kind === "folder" && r.dir === "archive")).toHaveLength(1);
    expect(rows.find((r) => r.kind === "folder" && r.dir === "work")).toMatchObject({
      count: 0,
      collapsed: false,
    });
    const journal = rows.find((r) => r.kind === "folder" && r.dir === "journal");
    expect(journal).toMatchObject({ collapsed: true, count: 2 });
  });

  it("visibleNoteIds skips headers and collapsed members", () => {
    const rows = buildSidebarRows(notes, [], new Set(["journal"]));
    expect(visibleNoteIds(rows)).toEqual(["work/projects/roadmap.md", "keymap.md", "welcome.md"]);
  });
});

describe("stepVisibleNote", () => {
  const notes = sorted([
    meta("welcome.md", { updated: 50 }),
    meta("keymap.md", { updated: 40, pinned: true }),
    meta("journal/morning.md", { updated: 90 }),
    meta("journal/night.md", { updated: 95, pinned: true }),
    meta("work/projects/roadmap.md", { updated: 10 }),
  ]);
  // visual order: [journal] night, morning · [work] (work/projects) roadmap · --- · keymap, welcome

  it("steps through visible notes in visual order and clamps at the ends", () => {
    const rows = buildSidebarRows(notes, [], new Set());
    expect(stepVisibleNote(rows, "journal/morning.md", 1)).toBe("work/projects/roadmap.md");
    expect(stepVisibleNote(rows, "work/projects/roadmap.md", 1)).toBe("keymap.md"); // across the divider
    expect(stepVisibleNote(rows, "keymap.md", -1)).toBe("work/projects/roadmap.md");
    expect(stepVisibleNote(rows, "journal/night.md", -1)).toBeNull(); // top: nowhere to go
    expect(stepVisibleNote(rows, "welcome.md", 1)).toBeNull(); // bottom
  });

  it("skips the members of collapsed groups", () => {
    const rows = buildSidebarRows(notes, [], new Set(["work/projects"]));
    expect(stepVisibleNote(rows, "journal/morning.md", 1)).toBe("keymap.md");
    expect(stepVisibleNote(rows, "keymap.md", -1)).toBe("journal/morning.md");
  });

  it("resumes from the hidden note's group when its own group was collapsed", () => {
    const rows = buildSidebarRows(notes, [], new Set(["work/projects"]));
    // roadmap is hidden under [work/projects]: down → first note after the
    // header, up → last note before it (not a jump to the top of the list).
    expect(stepVisibleNote(rows, "work/projects/roadmap.md", 1)).toBe("keymap.md");
    expect(stepVisibleNote(rows, "work/projects/roadmap.md", -1)).toBe("journal/morning.md");
  });

  it("starts at the top with no note open, and is null on an empty list", () => {
    const rows = buildSidebarRows(notes, [], new Set());
    expect(stepVisibleNote(rows, null, 1)).toBe("journal/night.md");
    expect(stepVisibleNote(rows, "config", -1)).toBe("journal/night.md");
    expect(stepVisibleNote(buildSidebarRows([], ["archive"], new Set()), null, 1)).toBeNull();
  });
});

describe("rewritePrefix", () => {
  it("rewrites the dir itself and its descendants only", () => {
    expect(rewritePrefix("work", "work", "archive")).toBe("archive");
    expect(rewritePrefix("work/a.md", "work", "archive")).toBe("archive/a.md");
    expect(rewritePrefix("work/sub/a.md", "work", "archive")).toBe("archive/sub/a.md");
    expect(rewritePrefix("worked/a.md", "work", "archive")).toBe("worked/a.md"); // prefix trap
    expect(rewritePrefix("other.md", "work", "archive")).toBe("other.md");
  });
});
