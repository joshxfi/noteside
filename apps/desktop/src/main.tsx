import ReactDOM from "react-dom/client";
import { App } from "./app";
import "./fonts";
import "./styles.css";

// Mirror the head-script guard in case Tauri internals weren't ready then.
if (location.search.includes("embed") || "__TAURI_INTERNALS__" in window) {
  document.documentElement.classList.add("embed");
}
// Native window only (not the landing iframe) — drives the native-chrome styles.
if ("__TAURI_INTERNALS__" in window) document.documentElement.classList.add("tauri");
// macOS uses an Overlay title bar (tauri.conf), so the native traffic lights float
// over the toolbar's left edge — inset it there (see styles.css html.tauri.macos).
if (/Mac/i.test(navigator.platform) || /Mac/i.test(navigator.userAgent))
  document.documentElement.classList.add("macos");

// No <StrictMode>: the editor's reducer flushes pending actions through a ref
// inside its effects, and StrictMode's intentional double-invoke in dev would
// fire those actions (save/quit/open) twice.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
