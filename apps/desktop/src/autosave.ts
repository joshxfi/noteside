// Debounced autosave coordinator. Pure + framework-free so it's unit-testable.
//
// The key invariant (regression-guarded): each scheduled save carries its OWN
// note id and text, so flushing/firing always writes to the note that was being
// edited — never whatever note happens to be active when the timer fires.

export interface Autosave {
  /** Queue a save for `id` with `text`, resetting the debounce timer. */
  schedule(id: string, text: string | (() => string), version?: number): void;
  /** Immediately run any queued save (e.g. before switching notes). */
  flush(): void;
  /** Drop any queued save without running it. */
  cancel(): void;
}

export function createAutosave(
  save: (id: string, text: string, version?: number) => void,
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
    flush() {
      clearTimer();
      const p = pending;
      pending = null;
      if (p) save(p.id, typeof p.text === "function" ? p.text() : p.text, p.version);
    },
    cancel() {
      clearTimer();
      pending = null;
    },
  };
}
