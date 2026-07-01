import { boot, expect, test } from "./fixtures";

test.describe("content search", () => {
  test("Mod-Shift-f greps note bodies and opens a hit", async ({ page }) => {
    await boot(page, { vimMode: false });
    await page.locator(".cm-content").click();

    await page.keyboard.press("ControlOrMeta+Shift+f");
    await page.locator(".fnd-panel").waitFor();
    // "Frost bluffed" appears only in the Thursday note's body.
    await page.locator(".fnd-input").fill("Frost bluffed");
    await expect(page.locator(".fnd-grepline").first()).toContainText(/frost bluffed/i);

    await page.keyboard.press("Enter");
    await expect(page.locator(".fnd-panel")).toBeHidden();
    await expect(page.locator(".av-file")).toContainText("Thursday");
  });
});
