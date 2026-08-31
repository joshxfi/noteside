import { beforeEach, describe, expect, it, vi } from "vitest";

const menu = vi.hoisted(() => ({
  close: vi.fn(async () => {}),
  create: vi.fn(),
  popup: vi.fn(async () => {}),
  // The pin row is the one item built separately (its label depends on the
  // right-clicked note), so the mock has to hand back a real-ish MenuItem.
  setText: vi.fn(async () => {}),
  itemNew: vi.fn(),
}));

vi.mock("./use-window-controls", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/menu", () => ({
  Menu: { new: menu.create },
  MenuItem: { new: menu.itemNew },
}));

const noteActions = () => ({
  onOpen: vi.fn(),
  onReveal: vi.fn(),
  onDuplicate: vi.fn(),
  onMove: vi.fn(),
  onRename: vi.fn(),
  onTogglePin: vi.fn(),
  onDelete: vi.fn(),
});

const folderActions = () => ({
  onNewNote: vi.fn(),
  onNewSubfolder: vi.fn(),
  onRename: vi.fn(),
  onDelete: vi.fn(),
});

describe("native note context menu lifecycle", () => {
  beforeEach(() => {
    menu.close.mockClear();
    menu.create.mockReset();
    menu.popup.mockClear();
    menu.setText.mockClear();
    menu.itemNew.mockReset();
    menu.create.mockResolvedValue({ close: menu.close, popup: menu.popup });
    menu.itemNew.mockResolvedValue({ setText: menu.setText });
  });

  it("reuses one menu, disposes it, and creates a fresh resource afterward", async () => {
    const { disposeNativeMenus, showNoteContextMenu } = await import("./native-menu");
    const actions = noteActions();

    await showNoteContextMenu("one.md", "One", false, actions);
    await showNoteContextMenu("two.md", "Two", false, actions);
    expect(menu.create).toHaveBeenCalledOnce();
    expect(menu.popup).toHaveBeenCalledTimes(2);

    await disposeNativeMenus();
    expect(menu.close).toHaveBeenCalledOnce();

    await showNoteContextMenu("three.md", "Three", false, actions);
    expect(menu.create).toHaveBeenCalledTimes(2);
    await disposeNativeMenus();
    expect(menu.close).toHaveBeenCalledTimes(2);
  });

  it("retargets the pin item's label per right-clicked note", async () => {
    const { disposeNativeMenus, showNoteContextMenu } = await import("./native-menu");
    const actions = noteActions();

    await showNoteContextMenu("plain.md", "Plain", false, actions);
    expect(menu.setText).toHaveBeenLastCalledWith("Pin");
    await showNoteContextMenu("pinned.md", "Pinned", true, actions);
    expect(menu.setText).toHaveBeenLastCalledWith("Unpin");
    // one menu AND one item, reused across both popups
    expect(menu.itemNew).toHaveBeenCalledOnce();

    // The item's action toggles away from the right-clicked note's current state.
    const built = menu.itemNew.mock.calls[0][0] as { action: () => void };
    built.action();
    expect(actions.onTogglePin).toHaveBeenCalledWith("pinned.md", false);

    await disposeNativeMenus();
  });

  it("the note menu carries a Move to folder item dispatching the handler", async () => {
    const { disposeNativeMenus, showNoteContextMenu } = await import("./native-menu");
    const actions = noteActions();
    await showNoteContextMenu("a.md", "A", false, actions);
    const built = menu.create.mock.calls[0][0] as {
      items: ({ id?: string; text?: string; action?: () => void } | unknown)[];
    };
    const move = built.items.find(
      (i): i is { id: string; action: () => void } =>
        typeof i === "object" && i !== null && (i as { id?: string }).id === "note-move",
    );
    expect(move).toBeDefined();
    move?.action();
    expect(actions.onMove).toHaveBeenCalledWith("a.md", "A");
    await disposeNativeMenus();
  });

  it("the folder menu is its own retained resource with the four folder ops", async () => {
    const { disposeNativeMenus, showFolderContextMenu, showNoteContextMenu } =
      await import("./native-menu");
    const actions = folderActions();

    await showFolderContextMenu("work", actions);
    await showFolderContextMenu("journal", actions);
    // one folder menu, reused; independent of the note menu
    expect(menu.create).toHaveBeenCalledOnce();
    expect(menu.popup).toHaveBeenCalledTimes(2);
    await showNoteContextMenu("a.md", "A", false, noteActions());
    expect(menu.create).toHaveBeenCalledTimes(2);

    const built = menu.create.mock.calls[0][0] as {
      items: ({ id?: string; action?: () => void } | unknown)[];
    };
    const byId = (id: string) =>
      built.items.find(
        (i): i is { id: string; action: () => void } =>
          typeof i === "object" && i !== null && (i as { id?: string }).id === id,
      );
    byId("folder-new-note")?.action();
    expect(actions.onNewNote).toHaveBeenCalledWith("journal"); // the LAST popped folder
    byId("folder-rename")?.action();
    expect(actions.onRename).toHaveBeenCalledWith("journal");
    byId("folder-delete")?.action();
    expect(actions.onDelete).toHaveBeenCalledWith("journal");
    byId("folder-new-subfolder")?.action();
    expect(actions.onNewSubfolder).toHaveBeenCalledWith("journal");

    // dispose closes BOTH retained menus
    await disposeNativeMenus();
    expect(menu.close).toHaveBeenCalledTimes(2);
  });
});
