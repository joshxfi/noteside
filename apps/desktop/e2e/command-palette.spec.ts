import { boot, expect, test } from "./fixtures";

test.describe("command palette", () => {
  test("Mod-Shift-p runs a command by name", async ({ page }) => {
    await boot(page, { vimMode: false });
    await page.locator(".cm-content").click();
    const sidebar = page.locator(".av-sidebar");
    await expect(sidebar).not.toHaveClass(/is-collapsed/);

    await page.keyboard.press("ControlOrMeta+Shift+p");
    await page.locator(".fnd-panel").waitFor();
    await page.locator(".fnd-input").fill("sidebar");
    await expect(page.locator(".fnd-row").first()).toContainText(/sidebar/i);
    await page.keyboard.press("Enter");

    // Running "Toggle sidebar" collapses it.
    await expect(sidebar).toHaveClass(/is-collapsed/);
  });
});
