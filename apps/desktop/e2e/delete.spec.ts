import { boot, expect, test } from "./fixtures";

test.describe("delete note", () => {
  test(":rm deletes the active note, confirms, and opens another", async ({ page }) => {
    await boot(page, { vimMode: true });
    await page.locator(".cm-content").click();

    const activeTitle = await page.locator(".av-item.is-active .av-item-titletext").innerText();
    const before = await page.locator(".av-item").count();
    expect(before).toBeGreaterThan(1); // the demo seeds several notes

    // Delete via the :rm ex-command (→ the "delete" command → deleteActive).
    await page.keyboard.press(":");
    await page.keyboard.type("rm");
    await page.keyboard.press("Enter");

    // The toast confirms, the row is gone, the sidebar shrank by one, and a
    // different note is now active.
    await expect(page.locator(".av-toast")).toContainText("note deleted");
    await expect(page.locator(".av-item").filter({ hasText: activeTitle })).toHaveCount(0);
    await expect(page.locator(".av-item")).toHaveCount(before - 1);
    await expect(page.locator(".av-item.is-active")).not.toContainText(activeTitle);
  });
});
