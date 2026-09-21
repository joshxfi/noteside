import { boot, expect, test } from "./fixtures";

// Every delete routes through the confirm modal (ConfirmDialog). These drive it
// via the command search; the pointer path (right-click → the in-app context
// menu in the web build) is covered by context-menu.spec.ts and shares the same
// modal. (The Tauri-native menu still needs a manual check in `pnpm dev:desktop`.)
test.describe("delete note", () => {
  /** Open the confirm modal for the active note via the command search.
   *  Danger commands get the search's own inline confirm first (Enter → y/Enter),
   *  then deleteActive opens the ConfirmDialog. */
  const requestDelete = async (page: import("@playwright/test").Page) => {
    await page.keyboard.press("ControlOrMeta+Shift+p");
    await expect(page.locator(".fnd-input")).toBeFocused();
    await page.keyboard.type("delete note");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter"); // inline danger confirm
    await expect(page.locator(".cfm-panel")).toBeVisible();
  };

  test("the delete command opens the confirm modal; confirming deletes and opens another", async ({
    page,
  }) => {
    await boot(page);
    await page.locator(".av-cm .tiptap").click();

    const activeTitle = await page.locator(".av-item.is-active .av-item-titletext").innerText();
    const before = await page.locator(".av-item").count();
    expect(before).toBeGreaterThan(1); // the demo seeds several notes

    // Leader → d → the "delete" command → the confirm modal (no immediate delete).
    await requestDelete(page);
    await expect(page.locator(".cfm-title")).toContainText(activeTitle);
    await expect(page.locator(".av-item")).toHaveCount(before); // nothing deleted yet

    // Enter confirms (the modal owns focus); the row is gone, another is active.
    await page.keyboard.press("Enter");
    await expect(page.locator(".cfm-panel")).toHaveCount(0);
    await expect(page.locator(".av-toast")).toContainText("note deleted");
    await expect(page.locator(".av-item").filter({ hasText: activeTitle })).toHaveCount(0);
    await expect(page.locator(".av-item")).toHaveCount(before - 1);
    await expect(page.locator(".av-item.is-active")).not.toContainText(activeTitle);
  });

  // The held-note bug: delete gated its autosave pause on the note being ACTIVE.
  // Typing in a note and opening the config overlay within the 800ms debounce
  // left the queued save alive — it recreated the file after deleteNote — and
  // lastNoteId kept pointing at the dead path, so :q reseeded a vanished note
  // instead of going to the empty state.
  test("deleting the note under the config overlay drops its queued save and :q lands on the empty state", async ({
    page,
  }) => {
    await boot(page);
    await page.locator(".av-cm .tiptap").click();
    const activeTitle = await page.locator(".av-item.is-active .av-item-titletext").innerText();

    // Queue an autosave, then cover the note with the config overlay INSIDE the
    // 800ms debounce — no wait between these two, that race is the bug.
    await page.keyboard.type(" edited");
    await page.keyboard.press("ControlOrMeta+Shift+p");
    await page.keyboard.type("notesiderc");
    await page.keyboard.press("Enter");
    await expect(page.locator(".av-plain")).toBeVisible();

    // Delete the (now non-active) note through the row's context menu.
    await page.locator(".av-item", { hasText: activeTitle }).click({ button: "right" });
    await page.locator(".ctx-menu").getByRole("menuitem", { name: "Delete" }).click();
    await page.locator(".cfm-btn", { hasText: "Delete" }).click();
    await expect(page.locator(".av-toast")).toContainText("note deleted");
    await expect(page.locator(".av-item").filter({ hasText: activeTitle })).toHaveCount(0);

    // Deliberate sleep past the 800ms autosave debounce: the cancelled save must
    // not fire and recreate the row.
    await page.waitForTimeout(1000);
    await expect(page.locator(".av-item").filter({ hasText: activeTitle })).toHaveCount(0);

    // :q from the overlay has no note to return to — the empty state, not a
    // buffer reseeded from the deleted file. (The editor-crash boundary is also
    // .av-empty but carries no .av-mark.) Refocus the textarea first: the confirm
    // modal left focus on <body>, where the quit chord doesn't reach the buffer.
    await page.locator(".av-plain").click();
    await page.keyboard.press("ControlOrMeta+w");
    await expect(page.locator(".av-plain")).toHaveCount(0);
    await expect(page.locator(".av-empty .av-mark")).toBeVisible();
    await expect(page.locator(".av-empty")).not.toContainText("The editor failed to load");
  });

  test("cancelling the modal (Esc / Cancel) deletes nothing", async ({ page }) => {
    await boot(page);
    await page.locator(".av-cm .tiptap").click();
    const before = await page.locator(".av-item").count();

    // Esc dismisses without deleting.
    await requestDelete(page);
    await page.keyboard.press("Escape");
    await expect(page.locator(".cfm-panel")).toHaveCount(0);
    await expect(page.locator(".av-item")).toHaveCount(before);

    // Focus the Cancel button and activate it from the keyboard. Enter must
    // follow the focused button, not bubble into the panel's default confirm.
    // Direct focus is portable across Safari's "Tab skips buttons" OS setting.
    await requestDelete(page);
    const cancel = page.locator(".cfm-btn", { hasText: "Cancel" });
    await cancel.focus();
    await expect(cancel).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator(".cfm-panel")).toHaveCount(0);
    await expect(page.locator(".av-item")).toHaveCount(before);
  });
});
