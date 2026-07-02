import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { load, type Store } from "@tauri-apps/plugin-store";
import type { Config } from "../settings";
import type { Backend, Backlink, ContentHit, FileHit, NoteDoc, NoteMeta } from "./types";

let storeP: Promise<Store> | null = null;
const store = () => (storeP ??= load("noteside.json", { autoSave: true, defaults: {} }));

/** Real backend: talks to the Rust notebook over Tauri IPC; settings via the store plugin. */
export const tauriBackend: Backend = {
  live: true,
  async pickNotebook() {
    const res = await openDialog({ directory: true, multiple: false, title: "Open a notebook" });
    return typeof res === "string" ? res : null;
  },
  openNotebook: (path) => invoke<NoteMeta[]>("open_notebook", { path }),
  currentNotebook: () => invoke<string | null>("current_notebook"),
  listNotes: () => invoke<NoteMeta[]>("list_notes"),
  readNote: (path) => invoke<NoteDoc>("read_note", { path }),
  previewNote: (path) => invoke<NoteDoc>("preview_note", { path }),
  backlinks: (noteId) => invoke<Backlink[]>("backlinks", { id: noteId }),
  saveNote: (path, body) => invoke<NoteMeta>("save_note", { path, body }),
  renameNote: (path) => invoke<NoteMeta>("rename_note", { path }),
  createNote: (title) => invoke<NoteMeta>("create_note", { title: title ?? null }),
  deleteNote: (path) => invoke<void>("delete_note", { path }),
  recordOpen: (path) => invoke<void>("record_open", { path }),
  searchFiles: (query) => invoke<FileHit[]>("search_files", { query }),
  searchContent: (query, mode) => invoke<ContentHit[]>("search_content", { query, mode }),
  async getConfig() {
    return (await (await store()).get<Config>("config")) ?? null;
  },
  async setConfig(cfg) {
    await (await store()).set("config", cfg);
  },
  async getLastNotebook() {
    return (await (await store()).get<string>("lastNotebook")) ?? null;
  },
  async setLastNotebook(path) {
    await (await store()).set("lastNotebook", path);
  },
  async watchNotebook(onChange) {
    return await listen("notebook:changed", () => onChange());
  },
};
