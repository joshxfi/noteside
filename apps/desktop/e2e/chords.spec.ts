import { boot, expect, test } from "./fixtures";

// ControlOrMeta maps to Cmd on macOS and Ctrl elsewhere — matching the app's
// `Mod-` chords (Cmd on mac / Ctrl on Linux CI).
test.describe("keyboard chords", () => {
  test("Mod-p opens the finder and Mod-b toggles the sidebar", async ({ page }) => {
    await boot(page, { vimMode: false });
    await page.locator(".cm-content").click();

    await page.keyboard.press("ControlOrMeta+p");
    await expect(page.locator(".fnd-panel")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".fnd-panel")).toBeHidden();

    const sidebar = page.locator(".av-sidebar");
    await expect(sidebar).not.toHaveClass(/is-collapsed/);
    await page.locator(".cm-content").click();
    await page.keyboard.press("ControlOrMeta+b");
    await expect(sidebar).toHaveClass(/is-collapsed/);
  });
});
