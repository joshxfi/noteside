import { boot, expect, test } from "./fixtures";

test.describe("note navigation", () => {
  test("clicking a sidebar note opens it and Mod-k switches", async ({ page }) => {
    await boot(page, { vimMode: false });
    const file = page.locator(".av-file");

    await page.locator(".av-item").filter({ hasText: "Keymap" }).click();
    await expect(file).toContainText("Keymap");

    // Mod-k → previous note: the open note changes (order-agnostic assertion;
    // Keymap is the LAST row — folders render first, root notes last — so the
    // step goes up, where there is always somewhere to go).
    await page.locator(".av-cm .tiptap").click();
    await page.keyboard.press("ControlOrMeta+k");
    await expect(file).not.toContainText("Keymap");
  });
});
