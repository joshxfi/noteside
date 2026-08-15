import { boot, expect, test } from "./fixtures";

test.describe("command palette", () => {
  test("runs a command by name", async ({ page }) => {
    await boot(page);
    await page.locator(".av-cm .tiptap").click();
    const sidebar = page.locator(".av-sidebar");
    await expect(sidebar).not.toHaveClass(/is-collapsed/);

    // Mod-Shift-p works cross-platform now: eventChord matches modifier flags,
    // so Playwright's synthesized Shift never falls through to Mod-p (that was
    // a CM keymap artifact).
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
