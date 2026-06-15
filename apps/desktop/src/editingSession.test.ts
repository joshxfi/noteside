import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIG_ID, createEditingSession, type EditingSessionDeps } from "./editingSession";
import type { Backend, NoteDoc, NoteMeta } from "./backend/types";

// A Map-backed fake of the consumed backend slice. Records the exact call order
// (so flush-before-switch is assertable) and lets a test mutate bodies to
// simulate an external "disk" edit.
function fakeBackend(seed: Record<string, string> = {}) {
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
  const backend: Pick<Backend, "readNote" | "saveNote" | "listNotes"> = {
    async readNote(id: string): Promise<NoteDoc> {
      calls.push(`read:${id}`);
      if (!bodies.has(id)) throw new Error(`not found: ${id}`);
      return { ...metaOf(id), body: bodies.get(id) as string };
    },
    async saveNote(id: string, body: string): Promise<NoteMeta> {
      calls.push(`save:${id}`);
      bodies.set(id, body);
      return metaOf(id);
    },
    async listNotes(): Promise<NoteMeta[]> {
      calls.push("list");
      return [...bodies.keys()].map(metaOf);
    },
  };
  return { backend, bodies, calls, metaOf };
}

function makeSession(seed: Record<string, string> = {}, over: Partial<EditingSessionDeps> = {}) {
  const fb = fakeBackend(seed);
  const notices: string[] = [];
  const configApplied: string[] = [];
  const savedMetas: NoteMeta[] = [];
  const notesChanged: NoteMeta[][] = [];
  const session = createEditingSession({
    backend: fb.backend,
    autosaveMs: 800,
    notify: (m) => notices.push(m),
    onConfigApply: (t) => configApplied.push(t),
    onNoteSaved: (m) => savedMetas.push(m),
    onNotesChanged: (l) => notesChanged.push(l),
    ...over,
  });
  return { session, notices, configApplied, savedMetas, notesChanged, ...fb };
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
});
