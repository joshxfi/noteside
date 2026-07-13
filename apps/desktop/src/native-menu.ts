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

interface MenuContext {
  id: string;
  title: string;
  actions: NoteMenuActions;
}

let activeContext: MenuContext | null = null;
let menuPromise: Promise<import("@tauri-apps/api/menu").Menu> | null = null;

async function noteMenu(): Promise<import("@tauri-apps/api/menu").Menu> {
  if (menuPromise) return menuPromise;
  menuPromise = import("@tauri-apps/api/menu").then(({ Menu }) =>
    Menu.new({
      items: [
        {
          id: "note-open",
          text: "Open",
          action: () => activeContext?.actions.onOpen(activeContext.id),
        },
        {
          id: "note-reveal",
          text: revealLabel(),
          action: () => activeContext?.actions.onReveal(activeContext.id),
        },
        {
          id: "note-duplicate",
          text: "Duplicate",
          action: () => activeContext?.actions.onDuplicate(activeContext.id),
        },
        {
          id: "note-rename",
          text: "Rename…",
          action: () => {
            const context = activeContext;
            if (context) context.actions.onRename(context.id, context.title);
          },
        },
        { item: "Separator" },
        {
          id: "note-delete",
          text: "Delete",
          action: () => {
            const context = activeContext;
            if (context) context.actions.onDelete(context.id, context.title);
          },
        },
      ],
    }),
  );
  return menuPromise;
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
  activeContext = { id, title, actions };
  const menu = await noteMenu();
  await menu.popup(); // no position → at the cursor
}

/** Release the one reusable native resource during app teardown/HMR. */
export async function disposeNoteContextMenu(): Promise<void> {
  activeContext = null;
  const current = menuPromise;
  menuPromise = null;
  if (!current) return;
  try {
    await (await current).close();
  } catch {
    // Window teardown may have already dropped the resource table.
  }
}
