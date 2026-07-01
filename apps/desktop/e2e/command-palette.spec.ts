import { boot, expect, test } from "./fixtures";

test.describe("command palette", () => {
  test("runs a command by name", async ({ page }) => {
    await boot(page, { vimMode: true });
    await page.locator(".cm-content").click();
    const sidebar = page.locator(".av-sidebar");
    await expect(sidebar).not.toHaveClass(/is-collapsed/);

    // Open the searchable command palette via the :commands ex-command. (The
    // Mod-Shift-p chord loses its Shift under Playwright on Linux and falls
    // through to Mod-p, opening the finder instead.)
    await page.keyboard.press(":");
    await page.keyboard.type("commands");
    await page.keyboard.press("Enter");

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
