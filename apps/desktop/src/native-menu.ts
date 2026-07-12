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
  onReveal: (id: string) => void;
  onDuplicate: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string, title: string) => void;
}

// The OS-appropriate label for "reveal the file in the system file manager".
function revealLabel(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/Mac|iPhone|iPad/i.test(ua)) return "Reveal in Finder";
  if (/Win/i.test(ua)) return "Reveal in File Explorer";
  return "Open Containing Folder";
}

/** Pop up the native note menu at the cursor. Resolves once shown; the item
 *  `action`s fire later when the user picks one. */
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
      { id: "note-reveal", text: revealLabel(), action: () => actions.onReveal(id) },
      { id: "note-duplicate", text: "Duplicate", action: () => actions.onDuplicate(id) },
      { id: "note-rename", text: "Rename…", action: () => actions.onRename(id, title) },
      { item: "Separator" },
      { id: "note-delete", text: "Delete", action: () => actions.onDelete(id, title) },
    ],
  });
  await menu.popup(); // no position → at the cursor
}
