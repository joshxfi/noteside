import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { load, type Store } from "@tauri-apps/plugin-store";
import type { Config } from "../settings";
import type {
  Backend,
  Backlink,
  ContentHit,
  FileHit,
  NoteDoc,
  NoteMeta,
  NotebookRef,
} from "./types";

let storeP: Promise<Store> | null = null;
const store = () => (storeP ??= load("noteside.json", { autoSave: true, defaults: {} }));

const RECENTS_CAP = 20;

/** Display name for a notebook: its folder's basename (trailing slashes stripped). */
function notebookName(path: string): string {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** The recents list, migrating a pre-list `lastNotebook` into it on first read. */
async function readNotebooks(s: Store): Promise<NotebookRef[]> {
  const list = (await s.get<NotebookRef[]>("notebooks")) ?? [];
  if (list.length) return list;
  const last = await s.get<string>("lastNotebook");
  return last ? [{ path: last, name: notebookName(last), lastOpened: 0 }] : [];
}

/** Real backend: talks to the Rust notebook over Tauri IPC; settings via the store plugin. */
export const tauriBackend: Backend = {
  live: true,
  async pickNotebook() {
    const res = await openDialog({ directory: true, multiple: false, title: "Open a notebook" });
    return typeof res === "string" ? res : null;
  },
  openNotebook: (path) => invoke<NoteMeta[]>("open_notebook", { path }),
  currentNotebook: () => invoke<string | null>("current_notebook"),
  async listNotebooks() {
    return await readNotebooks(await store());
  },
  async rememberNotebook(path) {
    const s = await store();
    const list = await readNotebooks(s);
    const next = [
      { path, name: notebookName(path), lastOpened: Date.now() },
      ...list.filter((n) => n.path !== path),
    ].slice(0, RECENTS_CAP);
    await s.set("notebooks", next);
  },
  async removeRecentNotebook(path) {
    const s = await store();
    const list = await readNotebooks(s);
    await s.set(
      "notebooks",
      list.filter((n) => n.path !== path),
    );
  },
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
