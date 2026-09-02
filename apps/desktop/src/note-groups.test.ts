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

  it("puts root notes first, then one flat group per dir", () => {
    const rows = buildSidebarRows(notes, ["archive"], new Set());
    const shape = rows.map((r) =>
      r.kind === "note" ? r.note.path : r.kind === "folder" ? `[${r.dir}]` : `(${r.dir})`,
    );
    expect(shape).toEqual([
      "keymap.md", // pinned floats within its section
      "welcome.md",
      "[archive]",
      "(archive)", // expanded empty group renders its blank drop row
      "[journal]",
      "journal/night.md", // pinned floats within its group, not to the root
      "journal/morning.md",
      "[work]", // an intermediate dir with no direct notes is an empty group
      "(work)",
      "[work/projects]", // nested dir = ONE group with the full label
      "work/projects/roadmap.md",
    ]);
  });

  it("collapse hides members (and an empty group's blank row)", () => {
    const rows = buildSidebarRows(notes, ["archive"], new Set(["journal", "archive"]));
    expect(rows.some((r) => r.kind === "note" && r.dir === "journal")).toBe(false);
    expect(rows.some((r) => r.kind === "blank")).toBe(true); // work's blank survives
    expect(rows.some((r) => r.kind === "blank" && r.dir === "archive")).toBe(false);
    const journal = rows.find((r) => r.kind === "folder" && r.dir === "journal");
    expect(journal).toMatchObject({ collapsed: true, count: 2 });
  });

  it("visibleNoteIds skips headers and collapsed members", () => {
    const rows = buildSidebarRows(notes, [], new Set(["journal"]));
    expect(visibleNoteIds(rows)).toEqual(["keymap.md", "welcome.md", "work/projects/roadmap.md"]);
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
  // visual order: keymap, welcome, [journal] night, morning, [work] (work/projects) roadmap

  it("steps through visible notes in visual order and clamps at the ends", () => {
    const rows = buildSidebarRows(notes, [], new Set());
    expect(stepVisibleNote(rows, "welcome.md", 1)).toBe("journal/night.md");
    expect(stepVisibleNote(rows, "journal/night.md", -1)).toBe("welcome.md");
    expect(stepVisibleNote(rows, "keymap.md", -1)).toBeNull(); // top: nowhere to go
    expect(stepVisibleNote(rows, "work/projects/roadmap.md", 1)).toBeNull();
  });

  it("skips the members of collapsed groups", () => {
    const rows = buildSidebarRows(notes, [], new Set(["journal"]));
    expect(stepVisibleNote(rows, "welcome.md", 1)).toBe("work/projects/roadmap.md");
    expect(stepVisibleNote(rows, "work/projects/roadmap.md", -1)).toBe("welcome.md");
  });

  it("resumes from the hidden note's group when its own group was collapsed", () => {
    const rows = buildSidebarRows(notes, [], new Set(["journal"]));
    // morning is hidden under [journal]: down → first note after the header,
    // up → last note before it (not a jump to the top of the list).
    expect(stepVisibleNote(rows, "journal/morning.md", 1)).toBe("work/projects/roadmap.md");
    expect(stepVisibleNote(rows, "journal/morning.md", -1)).toBe("welcome.md");
  });

  it("starts at the top with no note open, and is null on an empty list", () => {
    const rows = buildSidebarRows(notes, [], new Set());
    expect(stepVisibleNote(rows, null, 1)).toBe("keymap.md");
    expect(stepVisibleNote(rows, "config", -1)).toBe("keymap.md");
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
