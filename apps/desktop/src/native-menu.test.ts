import { beforeEach, describe, expect, it, vi } from "vitest";

const menu = vi.hoisted(() => ({
  close: vi.fn(async () => {}),
  create: vi.fn(),
  popup: vi.fn(async () => {}),
}));

vi.mock("./use-window-controls", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/menu", () => ({
  Menu: {
    new: menu.create,
  },
}));

describe("native note context menu lifecycle", () => {
  beforeEach(() => {
    menu.close.mockClear();
    menu.create.mockReset();
    menu.popup.mockClear();
    menu.create.mockResolvedValue({ close: menu.close, popup: menu.popup });
  });

  it("reuses one menu, disposes it, and creates a fresh resource afterward", async () => {
    const { disposeNoteContextMenu, showNoteContextMenu } = await import("./native-menu");
    const actions = {
      onOpen: vi.fn(),
      onReveal: vi.fn(),
      onDuplicate: vi.fn(),
      onRename: vi.fn(),
      onDelete: vi.fn(),
    };

    await showNoteContextMenu("one.md", "One", actions);
    await showNoteContextMenu("two.md", "Two", actions);
    expect(menu.create).toHaveBeenCalledOnce();
    expect(menu.popup).toHaveBeenCalledTimes(2);

    await disposeNoteContextMenu();
    expect(menu.close).toHaveBeenCalledOnce();

    await showNoteContextMenu("three.md", "Three", actions);
    expect(menu.create).toHaveBeenCalledTimes(2);
    await disposeNoteContextMenu();
    expect(menu.close).toHaveBeenCalledTimes(2);
  });
});
