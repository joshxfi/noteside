import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// Mirror the head-script guard in case Tauri internals weren't ready then.
if (location.search.includes("embed") || "__TAURI_INTERNALS__" in window) {
  document.documentElement.classList.add("embed");
}

// No <StrictMode>: the editor's reducer flushes pending actions through a ref
// inside its effects, and StrictMode's intentional double-invoke in dev would
// fire those actions (save/quit/open) twice.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
