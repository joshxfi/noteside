// use-editing-session.ts — the paper-thin React adapter over the framework-free
// editing session store. It creates the store ONCE (stable identity) and routes
// the live callbacks through a deps ref, so the store closures never go stale
// while React re-renders. The store itself holds no React — that's what keeps
// the editing loop node-testable (see editing-session.test.ts).
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  createEditingSession,
  type EditingSession,
  type EditingSessionDeps,
  type SessionSnapshot,
} from "./editing-session";

export function useEditingSession(deps: EditingSessionDeps): {
  session: EditingSession;
  snapshot: SessionSnapshot;
} {
  // `backend` and `autosaveMs` are read once (must be stable); the callbacks may
  // change every render, so we forward them through a ref the store reads live.
  // The ref is written from an effect (after commit), never during render: every
  // store callback fires asynchronously — after an IPC or a timer — so it always
  // sees the callbacks of the last COMMITTED render, not a discarded one.
  const depsRef = useRef(deps);
  useEffect(() => {
    depsRef.current = deps;
  });

  // The forwarding closures read the ref at CALL time (after an IPC/timer), not
  // in this initializer; the lint rule can't see past the render-time call.
  // oxlint-disable-next-line react/refs
  const [session] = useState(() =>
    createEditingSession({
      backend: deps.backend,
      autosaveMs: deps.autosaveMs,
      // Forward the kind too — dropping it silently downgraded every
      // session-side failure ("save failed", "rename failed") to an info toast.
      notify: (m, kind) => depsRef.current.notify(m, kind),
      onConfigApply: (t) => depsRef.current.onConfigApply(t),
      onNoteSaved: (m) => depsRef.current.onNoteSaved(m),
      onNoteRenamed: (id, m) => depsRef.current.onNoteRenamed(id, m),
      onNotesChanged: (l) => depsRef.current.onNotesChanged(l),
    }),
  );

  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  return { session, snapshot };
}
