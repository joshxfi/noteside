import { boot, expect, test } from "./fixtures";

// Every delete now routes through the confirm modal (ConfirmDialog). The note
// context menu itself is a native OS menu (Tauri only), so it isn't reachable in
// the web build under test — these drive the delete via :rm / the toolbar, which
// share the same modal. (Manually verify the native right-click menu in the app.)
test.describe("delete note", () => {
  test(":rm opens the confirm modal; confirming deletes and opens another", async ({ page }) => {
    await boot(page, { vimMode: true });
    await page.locator(".cm-content").click();

    const activeTitle = await page.locator(".av-item.is-active .av-item-titletext").innerText();
    const before = await page.locator(".av-item").count();
    expect(before).toBeGreaterThan(1); // the demo seeds several notes

    // :rm → the "delete" command → the confirm modal (no immediate delete).
    await page.keyboard.press(":");
    await page.keyboard.type("rm");
    await page.keyboard.press("Enter");
    await expect(page.locator(".cfm-panel")).toBeVisible();
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

  test("cancelling the modal (Esc / Cancel) deletes nothing", async ({ page }) => {
    await boot(page, { vimMode: true });
    await page.locator(".cm-content").click();
    const before = await page.locator(".av-item").count();

    // Esc dismisses without deleting.
    await page.keyboard.press(":");
    await page.keyboard.type("rm");
    await page.keyboard.press("Enter");
    await expect(page.locator(".cfm-panel")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".cfm-panel")).toHaveCount(0);
    await expect(page.locator(".av-item")).toHaveCount(before);

    // The Cancel button also dismisses without deleting.
    await page.keyboard.press(":");
    await page.keyboard.type("rm");
    await page.keyboard.press("Enter");
    await page.locator(".cfm-btn", { hasText: "Cancel" }).click();
    await expect(page.locator(".cfm-panel")).toHaveCount(0);
    await expect(page.locator(".av-item")).toHaveCount(before);
  });
});
