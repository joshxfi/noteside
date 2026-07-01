import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIG_ID, createEditingSession, type EditingSessionDeps } from "./editing-session";
import type { Backend, NoteDoc, NoteMeta } from "./backend/types";

// A Map-backed fake of the consumed backend slice. Records the exact call order
// (so flush-before-switch is assertable) and lets a test mutate bodies to
// simulate an external "disk" edit.
function fakeBackend(seed: Record<string, string> = {}, delays: Record<string, number> = {}) {
  const bodies = new Map<string, string>(Object.entries(seed));
  const calls: string[] = [];
  const metaOf = (id: string): NoteMeta => ({
    id,
    path: id,
    title: id.replace(/\.md$/, ""),
    tags: [],
    created: null,
    updated: 0,
    pinned: false,
  });
  const titleOf = (body: string): string | null =>
    body
      .split("\n")
      .map((l) =>
        l
          .trim()
          .replace(/^#+\s*/, "")
          .trim(),
      )
      .find(Boolean) ?? null;
  const backend: Pick<Backend, "readNote" | "saveNote" | "renameNote" | "listNotes"> = {
    async readNote(id: string): Promise<NoteDoc> {
      calls.push(`read:${id}`); // recorded at call time, before any delay (call-order stays stable)
      const d = delays[id] ?? 0;
      if (d > 0) await new Promise<void>((r) => setTimeout(r, d));
      if (!bodies.has(id)) throw new Error(`not found: ${id}`);
      return { ...metaOf(id), body: bodies.get(id) as string };
    },
    async saveNote(id: string, body: string): Promise<NoteMeta> {
      calls.push(`save:${id}`);
      const d = delays[id] ?? 0;
      if (d > 0) await new Promise<void>((r) => setTimeout(r, d));
      bodies.set(id, body);
      return metaOf(id);
    },
    // Mimics the real command: slug the body's title; rename the file if the
    // filename doesn't already represent it. Returns the (possibly new) meta.
    async renameNote(id: string): Promise<NoteMeta> {
      calls.push(`rename:${id}`);
      const title = titleOf(bodies.get(id) ?? "");
      if (!title) return metaOf(id);
      const slug =
        title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || "untitled";
      const stem = id.replace(/\.md$/, "");
      const numbered = stem.startsWith(`${slug}-`) && /^\d+$/.test(stem.slice(slug.length + 1));
      if (stem === slug || numbered) return metaOf(id);
      let newId = `${slug}.md`;
      let n = 2;
      while (bodies.has(newId)) newId = `${slug}-${n++}.md`;
      bodies.set(newId, bodies.get(id) as string);
      bodies.delete(id);
      return { ...metaOf(newId), title };
    },
    async listNotes(): Promise<NoteMeta[]> {
      calls.push("list");
      return [...bodies.keys()].map(metaOf);
    },
  };
  return { backend, bodies, calls, metaOf };
}

function makeSession(
  seed: Record<string, string> = {},
  over: Partial<EditingSessionDeps> = {},
  delays: Record<string, number> = {},
) {
  const fb = fakeBackend(seed, delays);
  const notices: string[] = [];
  const configApplied: string[] = [];
  const savedMetas: NoteMeta[] = [];
  const renamed: { oldId: string; meta: NoteMeta }[] = [];
  const notesChanged: NoteMeta[][] = [];
  const session = createEditingSession({
    backend: fb.backend,
    autosaveMs: 800,
    notify: (m) => notices.push(m),
    onConfigApply: (t) => configApplied.push(t),
    onNoteSaved: (m) => savedMetas.push(m),
    onNoteRenamed: (oldId, m) => renamed.push({ oldId, meta: m }),
    onNotesChanged: (l) => notesChanged.push(l),
    ...over,
  });
  return { session, notices, configApplied, savedMetas, renamed, notesChanged, ...fb };
}

describe("editingSession", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts empty", () => {
    const { session } = makeSession();
    const s = session.getSnapshot();
    expect(s.status).toBe("empty");
    expect(s.activeId).toBe(null);
  });

  it("open() reads the note, becomes clean, and notifies subscribers", async () => {
    const { session } = makeSession({ "a.md": "# A\nbody" });
    let ticks = 0;
    session.subscribe(() => ticks++);
    await session.open("a.md");
    const s = session.getSnapshot();
    expect(s.status).toBe("note");
    expect(s.activeId).toBe("a.md");
    expect(s.initialText).toBe("# A\nbody");
    expect(s.savedText).toBe("# A\nbody");
    expect(s.dirty).toBe(false);
    expect(ticks).toBe(1);
  });

  it("change() marks dirty, then debounced autosave persists and clears dirty", async () => {
    const { session, bodies, savedMetas } = makeSession({ "a.md": "old" });
    await session.open("a.md");
    session.change("new text");
    expect(session.getSnapshot().dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(799);
    expect(bodies.get("a.md")).toBe("old"); // not yet
    await vi.advanceTimersByTimeAsync(1);
    expect(bodies.get("a.md")).toBe("new text");
    expect(session.getSnapshot().dirty).toBe(false);
    expect(savedMetas.map((m) => m.id)).toEqual(["a.md"]);
  });

  it("change() can queue lazy text and uses the supplied dirty flag", async () => {
    const { session, bodies } = makeSession({ "a.md": "old" });
    let reads = 0;
    await session.open("a.md");
    session.change(() => {
      reads++;
      return "new text";
    }, true);
    expect(reads).toBe(0);
    expect(session.getSnapshot().dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(800);
    expect(reads).toBe(1);
    expect(bodies.get("a.md")).toBe("new text");
  });

  it("change() with a clean dirty flag cancels a pending autosave", async () => {
    const { session, bodies, calls } = makeSession({ "a.md": "old" });
    await session.open("a.md");
    session.change(() => "edited", true);
    expect(session.getSnapshot().dirty).toBe(true);
    session.change(() => "old", false);
    expect(session.getSnapshot().dirty).toBe(false);
    await vi.advanceTimersByTimeAsync(800);
    expect(bodies.get("a.md")).toBe("old");
    expect(calls.filter((c) => c === "save:a.md")).toEqual([]);
  });

  it("commit bail-out: a keystroke that leaves the snapshot field-identical does not notify", async () => {
    const { session } = makeSession({ "a.md": "base" });
    await session.open("a.md");
    let ticks = 0;
    session.subscribe(() => ticks++);
    const first = session.getSnapshot();
    session.change("base+"); // dirty false -> true: notifies
    expect(ticks).toBe(1);
    session.change("base++"); // still dirty, nothing else changed: no notify
    expect(ticks).toBe(1);
    expect(session.getSnapshot()).not.toBe(first); // identity advanced once, stable since
    const stable = session.getSnapshot();
    session.change("base+++");
    expect(session.getSnapshot()).toBe(stable); // referentially stable (useSyncExternalStore contract)
    session.change("base"); // dirty true -> false: notifies
    expect(ticks).toBe(2);
  });

  it("C3: open() lands the outgoing note's save BEFORE reading the incoming note", async () => {
    const { session, calls } = makeSession({ "a.md": "A", "b.md": "B" });
    await session.open("a.md");
    session.change("edited A");
    await session.open("b.md");
    expect(calls.indexOf("save:a.md")).toBeGreaterThan(-1);
    expect(calls.indexOf("read:b.md")).toBeGreaterThan(-1);
    expect(calls.indexOf("save:a.md")).toBeLessThan(calls.indexOf("read:b.md"));
  });

  it("C4: a queued save never writes one note's text into another after a switch", async () => {
    const { session, bodies } = makeSession({ "a.md": "A", "b.md": "B" });
    await session.open("a.md");
    session.change("content A");
    await session.open("b.md"); // flush lands A
    session.change("content B");
    await vi.advanceTimersByTimeAsync(800);
    expect(bodies.get("a.md")).toBe("content A");
    expect(bodies.get("b.md")).toBe("content B");
  });

  it("a stale in-flight save does not clear dirty after a newer edit", async () => {
    const { session, bodies } = makeSession({ "a.md": "A" }, {}, { "a.md": 50 });
    const open = session.open("a.md");
    await vi.advanceTimersByTimeAsync(50);
    await open;
    session.change("A1");
    await vi.advanceTimersByTimeAsync(800); // starts save of A1, still in flight
    session.change("A2");
    await vi.advanceTimersByTimeAsync(50); // A1 save resolves
    expect(bodies.get("a.md")).toBe("A1");
    expect(session.getSnapshot().dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(800); // A2 save resolves
    expect(bodies.get("a.md")).toBe("A2");
    expect(session.getSnapshot().dirty).toBe(false);
  });

  it("out-of-order open(): a slow earlier open does not clobber the latest", async () => {
    // a.md reads slower than b.md, so a.md resolves AFTER b.md despite being opened first.
    const { session } = makeSession({ "a.md": "A", "b.md": "B" }, {}, { "a.md": 50, "b.md": 10 });
    const pa = session.open("a.md"); // token 1, resolves at ~50ms
    const pb = session.open("b.md"); // token 2, resolves at ~10ms
    await vi.advanceTimersByTimeAsync(60);
    await Promise.all([pa, pb]);
    // The later navigation wins; the stale a.md resolution is dropped.
    expect(session.getSnapshot().activeId).toBe("b.md");
    expect(session.getSnapshot().initialText).toBe("B");
  });

  it("quit() during an in-flight open() drops the stale open (no resurrection)", async () => {
    const { session } = makeSession({ "a.md": "A" }, {}, { "a.md": 30 });
    const p = session.open("a.md"); // in flight
    session.quit(); // user bails before it resolves
    await vi.advanceTimersByTimeAsync(40);
    await p;
    expect(session.getSnapshot().status).toBe("empty"); // the late open did not re-open
  });

  // The audit's confirmed regression: reconcile() had already issued readNote(A)
  // when the user opened B; its late resolve must NOT seed buffer B with A's body
  // (which the next keystroke would then autosave into file B).
  it("reconcile() that already issued its read does not clobber a buffer switched mid-read", async () => {
    const delays: Record<string, number> = { "a.md": 50 }; // a.md reads slowly; b.md is instant
    const { session, bodies } = makeSession({ "a.md": "A v1", "b.md": "B" }, {}, delays);
    const openA = session.open("a.md");
    await vi.advanceTimersByTimeAsync(50);
    await openA; // on A, clean

    bodies.set("a.md", "A v2"); // A changed on disk → reconcile WOULD reload it
    const rp = session.reconcile(); // listNotes resolves, then it parks on readNote("a.md") (50ms)
    await vi.advanceTimersByTimeAsync(0); // let reconcile pass its guards and issue readNote("a.md")
    const op = session.open("b.md"); // user switches to B while A's read is in flight
    await vi.advanceTimersByTimeAsync(60); // both reads resolve
    await Promise.all([rp, op]);

    const s = session.getSnapshot();
    expect(s.activeId).toBe("b.md");
    expect(s.initialText).toBe("B"); // NOT "A v2" — the stale reconcile read was dropped
    expect(s.savedText).toBe("B");
  });

  it("C2: editorKey changes when re-opening the SAME note at the SAME line", async () => {
    const { session } = makeSession({ "a.md": "A" });
    await session.open("a.md", 0);
    const k1 = session.getSnapshot().editorKey;
    await session.open("a.md", 0);
    const k2 = session.getSnapshot().editorKey;
    expect(k2).not.toBe(k1);
    expect(session.getSnapshot().editorKey).not.toContain("config-");
  });

  it("C5: reconcile() does NOT clobber unsaved edits", async () => {
    const { session, bodies, notices } = makeSession({ "a.md": "disk v1" });
    await session.open("a.md");
    session.change("local edit"); // dirty
    bodies.set("a.md", "disk v2"); // external change
    await session.reconcile();
    expect(session.getSnapshot().initialText).toBe("disk v1"); // mount seed unchanged
    expect(notices).not.toContain("reloaded from disk");
  });

  it("C5: reconcile() reloads a clean buffer when disk differs and bumps the key", async () => {
    const { session, bodies, notices } = makeSession({ "a.md": "disk v1" });
    await session.open("a.md");
    const k1 = session.getSnapshot().editorKey;
    bodies.set("a.md", "disk v2");
    await session.reconcile();
    const s = session.getSnapshot();
    expect(s.initialText).toBe("disk v2");
    expect(s.savedText).toBe("disk v2");
    expect(s.editorKey).not.toBe(k1);
    expect(notices).toContain("reloaded from disk");
  });

  it("reconcile() goes empty when the active note vanished", async () => {
    const { session, bodies, notesChanged } = makeSession({ "a.md": "A" });
    await session.open("a.md");
    bodies.delete("a.md");
    await session.reconcile();
    expect(session.getSnapshot().status).toBe("empty");
    expect(notesChanged.at(-1)).toEqual([]); // sidebar list refreshed too
  });

  it("C6: open() failure leaves the prior buffer intact and notifies", async () => {
    const { session, notices } = makeSession({ "a.md": "A" });
    await session.open("a.md");
    const before = session.getSnapshot();
    await session.open("missing.md");
    const after = session.getSnapshot();
    expect(after.activeId).toBe("a.md");
    expect(after.initialText).toBe(before.initialText);
    expect(notices.some((m) => m.startsWith("couldn't open note"))).toBe(true);
  });

  it("C8: config is a buffer kind — save routes to onConfigApply, never saveNote", async () => {
    const { session, configApplied, calls } = makeSession();
    session.openConfig("theme dark");
    let s = session.getSnapshot();
    expect(s.status).toBe("config");
    expect(s.activeId).toBe(CONFIG_ID);
    expect(s.initialText).toBe("theme dark");
    session.save("theme light");
    s = session.getSnapshot();
    expect(configApplied).toEqual(["theme light"]);
    expect(s.savedText).toBe("theme light");
    expect(calls.some((c) => c.startsWith("save:"))).toBe(false);
  });

  it("C8: change() is a no-op for the config buffer (config never autosaves)", async () => {
    const { session, calls } = makeSession();
    session.openConfig("x");
    session.change("y");
    await vi.advanceTimersByTimeAsync(800);
    expect(calls.some((c) => c.startsWith("save:"))).toBe(false);
  });

  it("quit() from config restores the underlying note buffer (overlay preserved)", async () => {
    const { session } = makeSession({ "a.md": "A body" });
    await session.open("a.md");
    session.openConfig("config text");
    expect(session.getSnapshot().status).toBe("config");
    session.quit();
    const s = session.getSnapshot();
    expect(s.status).toBe("note");
    expect(s.activeId).toBe("a.md");
    expect(s.initialText).toBe("A body"); // the note buffer underneath was preserved
  });

  it("quit() from a note goes empty; reopenLast() reopens it", async () => {
    const { session } = makeSession({ "a.md": "A" });
    await session.open("a.md");
    session.quit();
    expect(session.getSnapshot().status).toBe("empty");
    expect(session.getSnapshot().lastNoteId).toBe("a.md");
    session.reopenLast();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().activeId).toBe("a.md");
  });

  it("cancelAutosave() drops a queued save so a later delete can't be resurrected", async () => {
    const { session, bodies } = makeSession({ "a.md": "A" });
    await session.open("a.md");
    session.change("edited");
    session.cancelAutosave();
    await vi.advanceTimersByTimeAsync(800);
    expect(bodies.get("a.md")).toBe("A"); // the queued save never fired
  });

  it("explicit save renames the file to match the title, migrating the id without a remount", async () => {
    const { session, calls, renamed, bodies } = makeSession({ "untitled.md": "# Untitled\n\n" });
    await session.open("untitled.md");
    const keyBefore = session.getSnapshot().editorKey;
    session.change("# Hello World\n\nbody"); // type a real title
    session.save("# Hello World\n\nbody"); // :w
    await vi.advanceTimersByTimeAsync(0); // flush persist + rename microtasks
    const s = session.getSnapshot();
    expect(s.activeId).toBe("hello-world.md"); // id migrated to the slugged filename
    expect(s.editorKey).toBe(keyBefore); // key unchanged → editor repoints, no remount
    expect(bodies.has("hello-world.md")).toBe(true);
    expect(bodies.has("untitled.md")).toBe(false);
    expect(calls).toContain("rename:untitled.md");
    expect(renamed).toEqual([
      {
        oldId: "untitled.md",
        meta: expect.objectContaining({ id: "hello-world.md", title: "Hello World" }),
      },
    ]);
  });

  it("explicit save does not rename when the filename already matches the title", async () => {
    const { session, calls, renamed } = makeSession({ "hello.md": "# Hello\n" });
    await session.open("hello.md");
    session.save("# Hello\n");
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().activeId).toBe("hello.md");
    expect(calls).toContain("rename:hello.md"); // it asked the backend…
    expect(renamed).toEqual([]); // …but nothing migrated
  });

  it("autosave never triggers a rename (only explicit save does)", async () => {
    const { session, calls, renamed } = makeSession({ "untitled.md": "# Untitled\n" });
    await session.open("untitled.md");
    session.change("# Hello World\n\nbody");
    await vi.advanceTimersByTimeAsync(800); // autosave fires
    expect(calls).toContain("save:untitled.md");
    expect(calls).not.toContain("rename:untitled.md"); // autosave did NOT rename
    expect(renamed).toEqual([]);
    expect(session.getSnapshot().activeId).toBe("untitled.md");
  });
});
