// use-editing-session.ts — the paper-thin React adapter over the framework-free
// editing session store. It creates the store ONCE (stable identity) and routes
// the live callbacks through a deps ref, so the store closures never go stale
// while React re-renders. The store itself holds no React — that's what keeps
// the editing loop node-testable (see editing-session.test.ts).
import { useRef, useState, useSyncExternalStore } from "react";
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
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const [session] = useState(() =>
    createEditingSession({
      backend: deps.backend,
      autosaveMs: deps.autosaveMs,
      notify: (m) => depsRef.current.notify(m),
      onConfigApply: (t) => depsRef.current.onConfigApply(t),
      onNoteSaved: (m) => depsRef.current.onNoteSaved(m),
      onNotesChanged: (l) => depsRef.current.onNotesChanged(l),
    }),
  );

  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  return { session, snapshot };
}
