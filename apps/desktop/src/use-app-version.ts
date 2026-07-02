// The running app version. `__APP_VERSION__` (build-time, from package.json) is
// correct everywhere and renders instantly; inside Tauri we override it with the
// binary's authoritative getVersion(). Code-split + graceful fallback, mirroring
// use-window-controls.ts — so the version always shows even if the call fails.
import { useEffect, useState } from "react";
import { isTauri } from "./use-window-controls";

export function useAppVersion(): string {
  // typeof-guarded: Vite's `define` inlines the literal (the guard folds away),
  // while other bundlers (tests, the design-sync converter) get the fallback
  // instead of a ReferenceError.
  const [version, setVersion] = useState(
    typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev",
  );
  useEffect(() => {
    if (!isTauri()) return;
    void import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then(setVersion)
      .catch(() => {
        /* keep the build-time version */
      });
  }, []);
  return version;
}
