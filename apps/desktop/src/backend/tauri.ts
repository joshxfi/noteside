import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { load, type Store } from "@tauri-apps/plugin-store";
import type { Config } from "../settings";
import type { Backend, ContentHit, FileHit, NoteDoc, NoteMeta } from "./types";

let storeP: Promise<Store> | null = null;
const store = () => (storeP ??= load("noteside.json", { autoSave: true, defaults: {} }));

/** Real backend: talks to the Rust vault over Tauri IPC; settings via the store plugin. */
export const tauriBackend: Backend = {
  live: true,
  async pickVault() {
    const res = await openDialog({ directory: true, multiple: false, title: "Open vault folder" });
    return typeof res === "string" ? res : null;
  },
  openVault: (path) => invoke<NoteMeta[]>("open_vault", { path }),
  currentVault: () => invoke<string | null>("current_vault"),
  listNotes: () => invoke<NoteMeta[]>("list_notes"),
  readNote: (path) => invoke<NoteDoc>("read_note", { path }),
  saveNote: (path, body) => invoke<NoteMeta>("save_note", { path, body }),
  createNote: (title) => invoke<NoteMeta>("create_note", { title: title ?? null }),
  deleteNote: (path) => invoke<void>("delete_note", { path }),
  searchFiles: (query) => invoke<FileHit[]>("search_files", { query }),
  searchContent: (query, mode) => invoke<ContentHit[]>("search_content", { query, mode }),
  async getConfig() {
    return (await (await store()).get<Config>("config")) ?? null;
  },
  async setConfig(cfg) {
    await (await store()).set("config", cfg);
  },
  async getLastVault() {
    return (await (await store()).get<string>("lastVault")) ?? null;
  },
  async setLastVault(path) {
    await (await store()).set("lastVault", path);
  },
};
