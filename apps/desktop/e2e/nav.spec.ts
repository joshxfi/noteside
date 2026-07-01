import { boot, expect, test } from "./fixtures";

test.describe("note navigation", () => {
  test("clicking a sidebar note opens it and Mod-j switches", async ({ page }) => {
    await boot(page, { vimMode: false });
    const file = page.locator(".av-file");

    await page.locator(".av-item").filter({ hasText: "Keymap" }).click();
    await expect(file).toContainText("Keymap");

    // Mod-j → next note: the open note changes (order-agnostic assertion).
    await page.locator(".cm-content").click();
    await page.keyboard.press("ControlOrMeta+j");
    await expect(file).not.toContainText("Keymap");
  });
});
