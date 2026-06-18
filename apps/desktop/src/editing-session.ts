// editing-session.ts — the editing session: the deep module that owns the whole
// per-buffer editing loop (working/saved/dirty, autosave, open/save/quit, the
// config buffer kind, external reconcile, and the editor remount key) behind a
// small verb-set. Framework-free on purpose — it never imports React, so the
// orchestration that used to be smeared (and untested) across app.tsx is unit-
// testable in the node env. See editing-session.test.ts.
import { type Autosave, createAutosave } from "./autosave";
import type { Backend, NoteDoc, NoteMeta } from "./backend/types";

/** The synthetic id of the `~/.notesiderc` config buffer — a buffer kind, not a note. */
export const CONFIG_ID = "config";
const DEFAULT_AUTOSAVE_MS = 800;

export type BufferKind = "note" | "config";

/** Immutable read-model the editor + chrome render from. Stable by identity between mutations. */
export interface SessionSnapshot {
  status: "empty" | "note" | "config";
  kind: BufferKind | null;
  /** Note path, CONFIG_ID, or null (no buffer). */
  activeId: string | null;
  /** Last real note (drives `:q`-from-config and "reopen the last one"). Never CONFIG_ID. */
  lastNoteId: string | null;
  /** Note title, or "~/.notesiderc". */
  title: string | null;
  /** The editor's mount seed (note body or config text). */
  initialText: string;
  /** On-disk / last-applied baseline for the active buffer (the dirty baseline). */
  savedText: string;
  /** Note buffer: working !== saved (drives the sidebar dot). */
  dirty: boolean;
  /** 1-based cursor target on the next mount (0 = none). Always 0 for config. */
  gotoLine: number;
  /** Content identity for the `<Editor key>` — no vim/preview (App composes those). */
  editorKey: string;
}

export interface EditingSessionDeps {
  /** Read once at creation; must be stable. */
  backend: Pick<Backend, "readNote" | "saveNote" | "listNotes">;
  /** Transient toast channel (App's flash): I/O failures + the "reloaded from disk" notice. */
  notify(message: string): void;
  /** A config buffer was saved (`:w`) — App parses, applies, and persists. */
  onConfigApply(text: string): void;
  /** A note was persisted — App updates that row in the sidebar list in place. */
  onNoteSaved(meta: NoteMeta): void;
  /** An external change refreshed the whole list — App replaces the sidebar list. */
  onNotesChanged(notes: NoteMeta[]): void;
  /** Read once at creation. Default 800ms. */
  autosaveMs?: number;
}

export interface EditingSession {
  /** Synchronous, stable-by-identity between mutations (safe for useSyncExternalStore). */
  getSnapshot(): SessionSnapshot;
  /** Fires after every state mutation; returns an unsubscribe fn. */
  subscribe(listener: () => void): () => void;

  // ---- the 95% path ----
  /** Flush the outgoing buffer's queued save, read `id` from disk, swap to it. */
  open(id: string, line?: number): Promise<void>;
  /** Editor typed: schedule an id-pinned autosave and recompute dirty (no-op for config). */
  change(text: string | (() => string), dirty?: boolean): void;
  /** `:w` / Mod-s: cancel the debounce and persist now (routes config to onConfigApply). */
  save(text: string): void;
  /** `:q`: flush, then restore the last note (from config) or go empty (from a note). */
  quit(): void;

  // ---- rarer verbs ----
  /** Enter the config buffer with serialized text — an overlay; the note buffer is preserved. */
  openConfig(text: string): void;
  /** Watcher fired: refresh the list and non-clobberingly reload the active note. */
  reconcile(): Promise<void>;
  /** Reopen the last real note (EmptyState). */
  reopenLast(): void;
  /** Drop the active buffer and go empty (after a delete, no flush). */
  close(): void;
  /** Force-land any queued autosave. */
  flush(): void;
  /** Drop any queued autosave without running it (before deleteNote, so it can't resurrect). */
  cancelAutosave(): void;
}

export function createEditingSession(deps: EditingSessionDeps): EditingSession {
  const { backend, notify, onConfigApply, onNoteSaved, onNotesChanged } = deps;

  // ---- internal state (was App's scattered useState + activeIdRef/doSaveRef) ----
  let activeId: string | null = null; // note path | CONFIG_ID | null — the discriminant + note id
  let lastNoteId: string | null = null;
  let noteTitle: string | null = null;
  let noteInitial = ""; // mount seed: body read at open/reload time
  let noteSaved = ""; // dirty baseline
  let noteDirty = false;
  let gotoLine = 0;
  let reloadNonce = 0;
  let navSeq = 0;
  let configText = "";
  let configSaved = "";
  let configKey = 0;
  let editSeq = 0;
  // Monotonic navigation guard. Every user navigation (open/openConfig/quit/close)
  // bumps this; an in-flight open()/reconcile() captures it and bails if it changed,
  // so a slow readNote can't resolve late and clobber a buffer the user has since
  // switched away from. (The mock backend resolves in order; the real IPC backend
  // can resolve out of order.)
  let loadToken = 0;

  const listeners = new Set<() => void>();

  function build(): SessionSnapshot {
    const isConfig = activeId === CONFIG_ID;
    const status = activeId === null ? "empty" : isConfig ? "config" : "note";
    return {
      status,
      kind: status === "empty" ? null : isConfig ? "config" : "note",
      activeId,
      lastNoteId,
      title: isConfig ? "~/.notesiderc" : noteTitle,
      initialText: isConfig ? configText : noteInitial,
      savedText: isConfig ? configSaved : noteSaved,
      dirty: noteDirty,
      gotoLine: isConfig ? 0 : gotoLine,
      editorKey: isConfig
        ? `config-${configKey}`
        : `${activeId}:${gotoLine}:${reloadNonce}:${navSeq}`,
    };
  }
  let snapshot: SessionSnapshot = build();
  // All snapshot fields are primitive, so a shallow compare is exact. Skipping the
  // swap+notify when nothing observable changed keeps getSnapshot() referentially
  // stable (the useSyncExternalStore contract) and restores the per-keystroke
  // re-render bail-out that App's setActiveDirty(true) used to get for free.
  function same(a: SessionSnapshot, b: SessionSnapshot): boolean {
    return (
      a.status === b.status &&
      a.kind === b.kind &&
      a.activeId === b.activeId &&
      a.lastNoteId === b.lastNoteId &&
      a.title === b.title &&
      a.initialText === b.initialText &&
      a.savedText === b.savedText &&
      a.dirty === b.dirty &&
      a.gotoLine === b.gotoLine &&
      a.editorKey === b.editorKey
    );
  }
  function commit() {
    const next = build();
    if (same(next, snapshot)) return;
    snapshot = next;
    for (const l of listeners) l();
  }

  function clearNoteBuffer() {
    activeId = null;
    noteTitle = null;
    noteInitial = "";
    noteSaved = "";
    noteDirty = false;
  }

  // The id-pinned note save (autosave timer + explicit :w). Mirrors App's doSaveNote:
  // bound to an explicit id, so a queued save can never write one note's text into
  // another after a switch; only touches the on-screen buffer if `id` is still active.
  async function persistNote(id: string, text: string, seq = editSeq): Promise<void> {
    if (!id || id === CONFIG_ID) return;
    try {
      const meta = await backend.saveNote(id, text);
      onNoteSaved(meta);
      if (activeId === id) {
        noteSaved = text;
        noteDirty = seq !== editSeq;
        commit();
      }
    } catch (e) {
      notify(`save failed: ${e}`);
    }
  }

  const autosaver: Autosave = createAutosave(
    (id, text, seq) => void persistNote(id, text, seq),
    deps.autosaveMs ?? DEFAULT_AUTOSAVE_MS,
  );

  async function open(id: string, line = 0): Promise<void> {
    autosaver.flush(); // land the outgoing buffer's queued save BEFORE reading the next
    const token = ++loadToken;
    let doc: NoteDoc;
    try {
      doc = await backend.readNote(id);
    } catch (e) {
      if (token === loadToken) notify(`couldn't open note: ${e}`); // deleted under us — prior buffer intact
      return;
    }
    if (token !== loadToken) return; // a newer navigation superseded this open
    noteInitial = doc.body;
    noteSaved = doc.body;
    noteDirty = false;
    noteTitle = doc.title;
    activeId = id;
    lastNoteId = id;
    gotoLine = line;
    // bump every open so re-opening the SAME note at the SAME line still remounts
    // the editor (the goto-line jump only runs on mount) — e.g. self [[links]].
    navSeq += 1;
    commit();
  }

  function change(text: string | (() => string), dirty?: boolean): void {
    if (activeId === null || activeId === CONFIG_ID) return; // config never autosaves
    const seq = ++editSeq;
    const nextDirty = dirty ?? (typeof text === "function" ? text() : text) !== noteSaved;
    if (nextDirty) {
      autosaver.schedule(activeId, text, seq); // pinned to the buffer being edited
    } else {
      autosaver.cancel(); // undo-to-saved should not land a redundant autosave
    }
    noteDirty = nextDirty;
    commit();
  }

  function save(text: string): void {
    autosaver.cancel(); // kill any pending debounce racing this explicit save
    if (activeId === CONFIG_ID) {
      configSaved = text;
      onConfigApply(text);
      commit();
    } else if (activeId) {
      void persistNote(activeId, text, editSeq);
    }
  }

  function quit(): void {
    autosaver.flush(); // land queued edits of the buffer being abandoned
    loadToken += 1; // a pending open resolving after :q must not re-open
    if (activeId === CONFIG_ID) {
      activeId = lastNoteId && lastNoteId !== CONFIG_ID ? lastNoteId : null;
      commit();
    } else {
      clearNoteBuffer();
      commit();
    }
  }

  function openConfig(text: string): void {
    loadToken += 1; // supersede any in-flight open
    configText = text;
    configSaved = text;
    configKey += 1;
    activeId = CONFIG_ID; // overlay — the note buffer underneath is preserved for :q
    commit();
  }

  async function reconcile(): Promise<void> {
    const token = loadToken; // reactive: bail if the user navigates mid-scan
    let list: NoteMeta[];
    try {
      list = await backend.listNotes();
    } catch {
      return;
    }
    onNotesChanged(list); // sidebar refresh is independent of the active buffer
    if (token !== loadToken) return; // user navigated during the scan
    if (activeId === null || activeId === CONFIG_ID) return;
    const id = activeId; // pin the note we're reconciling across the read
    if (!list.some((n) => n.id === id)) {
      clearNoteBuffer(); // the active note vanished out from under us
      commit();
      return;
    }
    if (noteDirty) return; // never clobber unsaved edits
    try {
      const doc = await backend.readNote(id);
      // Bail if the user navigated (token) OR the active buffer changed (id) during
      // the read — otherwise a late resolve would seed the wrong buffer with this
      // note's body, and the next keystroke would autosave it into the wrong file.
      if (token !== loadToken || activeId !== id) return;
      if (doc.body !== noteSaved) {
        noteInitial = doc.body;
        noteSaved = doc.body;
        noteTitle = doc.title;
        reloadNonce += 1; // remount so the editor reseeds from disk
        commit();
        notify("reloaded from disk");
      }
    } catch {
      // transient external read glitch — the next watcher event retries.
    }
  }

  function reopenLast(): void {
    if (lastNoteId) void open(lastNoteId);
  }

  function close(): void {
    loadToken += 1; // supersede any in-flight open
    clearNoteBuffer();
    commit();
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    open,
    change,
    save,
    quit,
    openConfig,
    reconcile,
    reopenLast,
    close,
    flush: () => autosaver.flush(),
    cancelAutosave: () => autosaver.cancel(),
  };
}
