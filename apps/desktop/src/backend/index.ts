import { isTauri } from "../useWindowControls";
import { mockBackend } from "./mock";
import { tauriBackend } from "./tauri";
import type { Backend } from "./types";

export * from "./types";

/** The active backend: real Rust vault inside Tauri, in-memory mock in a browser. */
export const backend: Backend = isTauri() ? tauriBackend : mockBackend;
