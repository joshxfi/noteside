import { boot, expect, test } from "./fixtures";

test.describe("command palette", () => {
  test("runs a command by name", async ({ page }) => {
    await boot(page, { vimMode: false });
    await page.locator(".cm-content").click();
    const sidebar = page.locator(".av-sidebar");
    await expect(sidebar).not.toHaveClass(/is-collapsed/);

    await page.keyboard.press("ControlOrMeta+Shift+p");
    await page.locator(".fnd-panel").waitFor();
    await page.locator(".fnd-input").fill("sidebar");

    // Click the matching row (deterministic) rather than relying on Enter/selection.
    await page
      .locator(".fnd-row")
      .filter({ hasText: /sidebar/i })
      .first()
      .click();

    // Running "Toggle sidebar" collapses it.
    await expect(sidebar).toHaveClass(/is-collapsed/);
  });
});
