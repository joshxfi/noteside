// native-menu.ts — the sidebar note row's right-click menu, rendered as a real
// OS context menu via Tauri's menu API (not a themed in-app component). It's
// native-only: the landing demo / browser build has no right-click menu, so this
// no-ops outside Tauri. The menu module is dynamically imported so it stays off
// the web bundle's first-paint path (mirroring use-app-version's app import).
//
// Needs `core:menu:default` in src-tauri/capabilities/default.json — without the
// grant Menu.new()/popup() are silently denied and right-click does nothing (the
// same class of capability gap as the window-destroy bug).
import { isTauri } from "./use-window-controls";

export interface NoteMenuActions {
  onOpen: (id: string) => void;
  onDelete: (id: string, title: string) => void;
}

/** Pop up the native "Open / Delete" menu for a note at the cursor. Resolves once
 *  shown; the item `action`s fire later when the user picks one. */
export async function showNoteContextMenu(
  id: string,
  title: string,
  actions: NoteMenuActions,
): Promise<void> {
  if (!isTauri()) return;
  const { Menu } = await import("@tauri-apps/api/menu");
  const menu = await Menu.new({
    items: [
      { id: "note-open", text: "Open", action: () => actions.onOpen(id) },
      { item: "Separator" },
      { id: "note-delete", text: "Delete", action: () => actions.onDelete(id, title) },
    ],
  });
  await menu.popup(); // no position → at the cursor
}
