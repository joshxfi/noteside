// Window controls for the custom (decorationless) Tauri titlebar.
// In the browser/landing-demo build these are no-ops (returns false), so the
// same UI renders harmlessly outside Tauri.

export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function windowControl(
  action: "close" | "minimize" | "toggleMaximize",
): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const w = getCurrentWindow();
    if (action === "close") await w.close();
    else if (action === "minimize") await w.minimize();
    else await w.toggleMaximize();
    return true;
  } catch {
    return false;
  }
}
