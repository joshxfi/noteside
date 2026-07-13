// Debounced autosave coordinator. Pure + framework-free so it's unit-testable.
//
// The key invariant (regression-guarded): each scheduled save carries its OWN
// note id and text, so flushing/firing always writes to the note that was being
// edited — never whatever note happens to be active when the timer fires.

export interface Autosave {
  /** Queue a save for `id` with `text`, resetting the debounce timer. */
  schedule(id: string, text: string | (() => string), version?: number): void;
  /** Immediately run any queued save (e.g. before switching notes). Resolves when
   *  the save's own promise settles, so callers can order a read AFTER the write
   *  (a flush-then-read that doesn't await can read pre-flush bytes). */
  flush(): Promise<void>;
  /** Drop any queued save without running it. */
  cancel(): void;
  /** Re-target a queued save from `oldId` to `newId` (rename-on-save migrates the
   *  buffer's id mid-flight; a save left pinned to the old path would recreate the
   *  renamed-away file). No-op when nothing is pending or the pin doesn't match. */
  repin(oldId: string, newId: string): void;
}

export function createAutosave(
  save: (id: string, text: string, version?: number) => unknown,
  delayMs: number,
): Autosave {
  type PendingSave = { id: string; text: string | (() => string); version?: number };
  let pending: PendingSave | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Every launched save stays represented here until it settles. Besides making
  // flush() a real durability barrier, serializing saves prevents two writes to
  // the same note from racing through the backend's atomic-write temp file.
  let tail: Promise<void> = Promise.resolve();
  const queued = new Set<PendingSave>();
  let hasWork = false;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const enqueue = (p: PendingSave): Promise<void> => {
    queued.add(p);
    const run = async () => {
      await save(p.id, typeof p.text === "function" ? p.text() : p.text, p.version);
    };
    // Preserve the coordinator's historical synchronous start: when idle, calling
    // flush() or firing the timer invokes `save` in that same turn. Later work is
    // chained so writes still cannot overlap.
    const current = hasWork ? tail.catch(() => {}).then(run) : run();
    hasWork = true;
    tail = current
      .finally(() => {
        queued.delete(p);
      })
      .finally(() => {
        if (queued.size === 0) hasWork = false;
      });
    return tail;
  };

  return {
    schedule(id, text, version) {
      pending = version === undefined ? { id, text } : { id, text, version };
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        const p = pending;
        pending = null;
        // The timer has no caller to observe a rejection, but `tail` deliberately
        // remains rejected so a later flush can still observe it.
        if (p) void enqueue(p).catch(() => {});
      }, delayMs);
    },
    async flush() {
      // A new edit can be scheduled while an already-launched save is awaiting
      // IPC. Keep draining until both the launched tail and pending slot are empty.
      for (;;) {
        clearTimer();
        const p = pending;
        pending = null;
        if (p) enqueue(p);
        const observedTail = tail;
        await observedTail;
        // A timer may have fired while `observedTail` was pending. In that case it
        // consumed `pending` itself and extended `tail`, so checking only the
        // pending slot would return too early.
        if (pending === null && tail === observedTail) return;
      }
    },
    cancel() {
      clearTimer();
      pending = null;
    },
    repin(oldId, newId) {
      if (pending && pending.id === oldId) pending = { ...pending, id: newId };
      // A save may already be queued behind another operation without having
      // started yet. Mutate its pin before the callback reads it.
      for (const p of queued) if (p.id === oldId) p.id = newId;
    },
  };
}
