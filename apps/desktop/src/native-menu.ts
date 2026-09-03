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
  onMove: (id: string, title: string) => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onDelete: (id: string, title: string) => void;
}

export interface FolderMenuActions {
  onNewNote: (dir: string) => void;
  onNewSubfolder: (dir: string) => void;
  onRename: (dir: string) => void;
  onDelete: (dir: string) => void;
  /** Whole-sidebar folds (the pointer path to :foldall / :unfoldall). */
  onCollapseAll: () => void;
  onExpandAll: () => void;
}

interface MenuContext {
  id: string;
  title: string;
  pinned: boolean;
  actions: NoteMenuActions;
}

let activeContext: MenuContext | null = null;
let menuPromise: Promise<import("@tauri-apps/api/menu").Menu> | null = null;
// The one item whose label depends on the right-clicked row, retained so each
// popup can retarget it instead of rebuilding (and leaking) the whole menu.
let pinItem: import("@tauri-apps/api/menu").MenuItem | null = null;

async function noteMenu(): Promise<import("@tauri-apps/api/menu").Menu> {
  if (menuPromise) return menuPromise;
  menuPromise = import("@tauri-apps/api/menu").then(async ({ Menu, MenuItem }) => {
    pinItem = await MenuItem.new({
      id: "note-pin",
      text: "Pin",
      action: () => {
        const context = activeContext;
        if (context) context.actions.onTogglePin(context.id, !context.pinned);
      },
    });
    return Menu.new({
      items: [
        {
          id: "note-open",
          text: "Open",
          action: () => activeContext?.actions.onOpen(activeContext.id),
        },
        pinItem,
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
          id: "note-move",
          text: "Move to folder…",
          action: () => {
            const context = activeContext;
            if (context) context.actions.onMove(context.id, context.title);
          },
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
    });
  });
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
  pinned: boolean,
  actions: NoteMenuActions,
): Promise<void> {
  if (!isTauri()) return;
  activeContext = { id, title, pinned, actions };
  const menu = await noteMenu();
  // Retarget the one state-dependent label before showing (the menu itself is
  // built once and reused).
  await pinItem?.setText(pinned ? "Unpin" : "Pin");
  await menu.popup(); // no position → at the cursor
}

// The folder header's menu — a second lazily-created retained Menu, same
// lifecycle pattern as the note menu (no per-popup rebuild, no leak). Still
// covered by `core:menu:default`; no new capability.
interface FolderMenuContext {
  dir: string;
  actions: FolderMenuActions;
}

let activeFolderContext: FolderMenuContext | null = null;
let folderMenuPromise: Promise<import("@tauri-apps/api/menu").Menu> | null = null;

async function folderMenu(): Promise<import("@tauri-apps/api/menu").Menu> {
  if (folderMenuPromise) return folderMenuPromise;
  folderMenuPromise = import("@tauri-apps/api/menu").then(({ Menu }) =>
    Menu.new({
      items: [
        {
          id: "folder-new-note",
          text: "New note here",
          action: () => activeFolderContext?.actions.onNewNote(activeFolderContext.dir),
        },
        {
          id: "folder-new-subfolder",
          text: "New subfolder…",
          action: () => activeFolderContext?.actions.onNewSubfolder(activeFolderContext.dir),
        },
        {
          id: "folder-rename",
          text: "Rename folder…",
          action: () => activeFolderContext?.actions.onRename(activeFolderContext.dir),
        },
        { item: "Separator" },
        {
          id: "folder-collapse-all",
          text: "Collapse all",
          action: () => activeFolderContext?.actions.onCollapseAll(),
        },
        {
          id: "folder-expand-all",
          text: "Expand all",
          action: () => activeFolderContext?.actions.onExpandAll(),
        },
        { item: "Separator" },
        {
          id: "folder-delete",
          text: "Delete folder",
          action: () => activeFolderContext?.actions.onDelete(activeFolderContext.dir),
        },
      ],
    }),
  );
  return folderMenuPromise;
}

/** Pop up the native folder menu at the cursor. */
export async function showFolderContextMenu(
  dir: string,
  actions: FolderMenuActions,
): Promise<void> {
  if (!isTauri()) return;
  activeFolderContext = { dir, actions };
  const menu = await folderMenu();
  await menu.popup(); // no position → at the cursor
}

/** Release the reusable native resources during app teardown/HMR. */
export async function disposeNativeMenus(): Promise<void> {
  activeContext = null;
  activeFolderContext = null;
  const current = menuPromise;
  const currentFolder = folderMenuPromise;
  menuPromise = null;
  folderMenuPromise = null;
  pinItem = null; // owned by the menu being closed below
  for (const p of [current, currentFolder]) {
    if (!p) continue;
    try {
      await (await p).close();
    } catch {
      // Window teardown may have already dropped the resource table.
    }
  }
}
