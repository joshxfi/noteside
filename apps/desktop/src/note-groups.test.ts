import { describe, expect, it } from "vitest";
import type { NoteMeta } from "./backend/types";
import {
  allDirs,
  buildSidebarRows,
  folderDeleteSummary,
  insertMeta,
  metaOrder,
  noteDir,
  relTime,
  rewritePrefix,
  sameMetaList,
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

/** The backend sort (pinned desc, updated desc) the rows derivation assumes —
 *  the same comparator App feeds every local list patch. */
function sorted(notes: NoteMeta[]): NoteMeta[] {
  return [...notes].sort(metaOrder);
}

describe("metaOrder / insertMeta", () => {
  it("floats pinned above unpinned regardless of updated", () => {
    const stale = meta("pinned.md", { updated: 1, pinned: true });
    const fresh = meta("loose.md", { updated: 999 });
    expect(sorted([fresh, stale]).map((n) => n.id)).toEqual(["pinned.md", "loose.md"]);
  });

  it("orders newer updated first within the same pin state", () => {
    const old = meta("old.md", { updated: 10 });
    const now = meta("new.md", { updated: 20 });
    expect(sorted([old, now]).map((n) => n.id)).toEqual(["new.md", "old.md"]);
    const pOld = meta("p-old.md", { updated: 10, pinned: true });
    const pNew = meta("p-new.md", { updated: 20, pinned: true });
    expect(sorted([pOld, pNew]).map((n) => n.id)).toEqual(["p-new.md", "p-old.md"]);
  });

  it("insertMeta returns a new array, sorted, leaving the input untouched", () => {
    const list = [meta("a.md", { updated: 20 }), meta("b.md", { updated: 5 })];
    const out = insertMeta(list, meta("c.md", { updated: 10 }));
    expect(out).not.toBe(list);
    expect(list.map((n) => n.id)).toEqual(["a.md", "b.md"]); // input unmutated
    expect(out.map((n) => n.id)).toEqual(["a.md", "c.md", "b.md"]);
  });

  it("insertMeta re-slots a note whose updated bumped since the last sort", () => {
    // An autosave patches a meta in place without re-sorting, so the list handed
    // in can be out of order — the whole-list re-sort is what fixes that.
    const list = [meta("a.md", { updated: 20 }), meta("stale.md", { updated: 99 })];
    const out = insertMeta(list, meta("new.md", { updated: 30 }));
    expect(out.map((n) => n.id)).toEqual(["stale.md", "new.md", "a.md"]);
  });
});

describe("sameMetaList", () => {
  const base = () => [meta("a.md", { updated: 5 }), meta("b.md", { updated: 1 })];

  it("is true for equal lists and false for a different length", () => {
    expect(sameMetaList(base(), base())).toBe(true);
    expect(sameMetaList(base(), base().slice(0, 1))).toBe(false);
  });

  it("is false when a rendered field changed", () => {
    const changed = (mutate: (m: NoteMeta) => void) => {
      const b = base();
      mutate(b[0]);
      return sameMetaList(base(), b);
    };
    expect(changed((m) => (m.id = "z.md"))).toBe(false);
    expect(changed((m) => (m.title = "other"))).toBe(false);
    expect(changed((m) => (m.updated = 6))).toBe(false);
    expect(changed((m) => (m.pinned = true))).toBe(false);
    expect(changed((m) => (m.tags = ["x"]))).toBe(false);
  });

  it("ignores a change past tags[0] — the sidebar renders only the first tag", () => {
    const a = base();
    const b = base();
    a[0].tags = ["same", "one"];
    b[0].tags = ["same", "two"];
    expect(sameMetaList(a, b)).toBe(true);
  });
});

describe("relTime", () => {
  const now = 1_000_000_000_000;
  const ago = (ms: number) => relTime(now - ms, now);
  const SEC = 1000;
  const MIN = 60 * SEC;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it("reports each unit at its rounded boundary", () => {
    expect(ago(10 * SEC)).toBe("just now");
    expect(ago(44 * SEC)).toBe("just now");
    expect(ago(45 * SEC)).toBe("1m ago"); // rounds up to a minute
    expect(ago(90 * SEC)).toBe("2m ago");
    expect(ago(59.4 * MIN)).toBe("59m ago");
    expect(ago(2 * HOUR)).toBe("2h ago");
    expect(ago(3 * DAY)).toBe("3d ago");
    expect(ago(14 * DAY)).toBe("2w ago");
    expect(ago(60 * DAY)).toBe("2mo ago");
    expect(ago(400 * DAY)).toBe("1y ago");
  });
});

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

describe("folderDeleteSummary", () => {
  it("names only the non-zero parts", () => {
    expect(folderDeleteSummary({ notes: 3, otherFiles: 0, dirs: 0 })).toBe("3 notes");
    expect(folderDeleteSummary({ notes: 1, otherFiles: 12, dirs: 2 })).toBe(
      "1 note, 12 other files and 2 subfolders",
    );
  });

  it("is empty for an empty folder, so the dialog can say so", () => {
    expect(folderDeleteSummary({ notes: 0, otherFiles: 0, dirs: 0 })).toBe("");
  });
});
