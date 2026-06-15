// Debounced autosave coordinator. Pure + framework-free so it's unit-testable.
//
// The key invariant (regression-guarded): each scheduled save carries its OWN
// note id and text, so flushing/firing always writes to the note that was being
// edited — never whatever note happens to be active when the timer fires.

export interface Autosave {
  /** Queue a save for `id` with `text`, resetting the debounce timer. */
  schedule(id: string, text: string): void;
  /** Immediately run any queued save (e.g. before switching notes). */
  flush(): void;
  /** Drop any queued save without running it. */
  cancel(): void;
}

export function createAutosave(
  save: (id: string, text: string) => void,
  delayMs: number,
): Autosave {
  let pending: { id: string; text: string } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    schedule(id, text) {
      pending = { id, text };
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        const p = pending;
        pending = null;
        if (p) save(p.id, p.text);
      }, delayMs);
    },
    flush() {
      clearTimer();
      const p = pending;
      pending = null;
      if (p) save(p.id, p.text);
    },
    cancel() {
      clearTimer();
      pending = null;
    },
  };
}
