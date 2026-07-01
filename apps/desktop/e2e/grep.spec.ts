import { boot, expect, test } from "./fixtures";

test.describe("content search", () => {
  test("greps note bodies and opens a hit", async ({ page }) => {
    await boot(page, { vimMode: false });
    await page.locator(".cm-content").click();

    // Open the finder with Mod-p and switch to the content tab, rather than the
    // Mod-Shift-f chord (which collides with CodeMirror's in-note search on Linux).
    await page.keyboard.press("ControlOrMeta+p");
    await page.locator(".fnd-panel").waitFor();
    await page
      .locator(".fnd-tab")
      .filter({ hasText: /content/i })
      .click();

    // "bluffed" appears only in the Thursday note's body.
    await page.locator(".fnd-input").fill("bluffed");
    await expect(page.locator(".fnd-grepline").first()).toContainText(/bluffed/i);

    // Click the hit (deterministic) rather than relying on Enter/selection.
    await page.locator(".fnd-row").first().click();
    await expect(page.locator(".fnd-panel")).toBeHidden();
    await expect(page.locator(".av-file")).toContainText("Thursday");
  });
});
