// Open an external link (http/https/mailto) in the system browser. In Tauri this
// goes through the opener plugin (code-split so the web/landing-demo build never
// imports it); outside Tauri it falls back to window.open. Mirrors the dynamic-
// import pattern in use-window-controls.ts.
import { isTauri } from "./use-window-controls";

// Scheme allowlist — never hand file:/javascript:/etc. to the OS opener. This is
// the client-side half of the guard; capabilities/default.json scopes it again.
const OPENABLE = /^(?:https?|mailto):/i;

export async function openExternal(url: string): Promise<boolean> {
  if (!OPENABLE.test(url)) return false;
  if (!isTauri()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return true;
  }
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return true;
  } catch {
    return false;
  }
}
