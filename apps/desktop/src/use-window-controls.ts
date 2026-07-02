// Environment detection: native Tauri window vs the browser/landing-demo build.
// (The window itself is native-decorated — the OS owns close/minimize/zoom — so
// there are no custom window controls to drive anymore.)

export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
