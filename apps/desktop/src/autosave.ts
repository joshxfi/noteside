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
  let pending: { id: string; text: string | (() => string); version?: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    schedule(id, text, version) {
      pending = version === undefined ? { id, text } : { id, text, version };
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        const p = pending;
        pending = null;
        if (p) save(p.id, typeof p.text === "function" ? p.text() : p.text, p.version);
      }, delayMs);
    },
    async flush() {
      clearTimer();
      const p = pending;
      pending = null;
      if (p) await save(p.id, typeof p.text === "function" ? p.text() : p.text, p.version);
    },
    cancel() {
      clearTimer();
      pending = null;
    },
    repin(oldId, newId) {
      if (pending && pending.id === oldId) pending = { ...pending, id: newId };
    },
  };
}
