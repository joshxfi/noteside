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
    const { disposeNoteContextMenu, showNoteContextMenu } = await import("./native-menu");
    const actions = {
      onOpen: vi.fn(),
      onReveal: vi.fn(),
      onDuplicate: vi.fn(),
      onRename: vi.fn(),
      onTogglePin: vi.fn(),
      onDelete: vi.fn(),
    };

    await showNoteContextMenu("one.md", "One", false, actions);
    await showNoteContextMenu("two.md", "Two", false, actions);
    expect(menu.create).toHaveBeenCalledOnce();
    expect(menu.popup).toHaveBeenCalledTimes(2);

    await disposeNoteContextMenu();
    expect(menu.close).toHaveBeenCalledOnce();

    await showNoteContextMenu("three.md", "Three", false, actions);
    expect(menu.create).toHaveBeenCalledTimes(2);
    await disposeNoteContextMenu();
    expect(menu.close).toHaveBeenCalledTimes(2);
  });

  it("retargets the pin item's label per right-clicked note", async () => {
    const { disposeNoteContextMenu, showNoteContextMenu } = await import("./native-menu");
    const actions = {
      onOpen: vi.fn(),
      onReveal: vi.fn(),
      onDuplicate: vi.fn(),
      onRename: vi.fn(),
      onTogglePin: vi.fn(),
      onDelete: vi.fn(),
    };

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

    await disposeNoteContextMenu();
  });
});
