/// <reference types="vite/client" />

interface Window {
  // Present only when running inside a Tauri webview.
  __TAURI_INTERNALS__?: unknown;
}
