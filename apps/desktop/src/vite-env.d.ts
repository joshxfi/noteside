/// <reference types="vite/client" />

// Injected at build time by vite.config.ts (`define`) from package.json.
declare const __APP_VERSION__: string;

interface Window {
  // Present only when running inside a Tauri webview.
  __TAURI_INTERNALS__?: unknown;
}
