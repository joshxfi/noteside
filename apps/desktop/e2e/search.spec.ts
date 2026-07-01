import { boot, expect, test } from "./fixtures";

test.describe("finder", () => {
  test("Mod-p finds a note by title and opens it", async ({ page }) => {
    await boot(page, { vimMode: false });
    await page.locator(".cm-content").click();

    await page.keyboard.press("ControlOrMeta+p");
    await page.locator(".fnd-panel").waitFor();
    await page.locator(".fnd-input").fill("keymap");
    // Wait for the query to filter the list before opening, so Enter can't race
    // the pre-filter selection.
    await expect(page.locator(".fnd-row").first()).toContainText(/keymap/i);
    await page.keyboard.press("Enter");

    await expect(page.locator(".fnd-panel")).toBeHidden();
    // "Keymap" is a seed note; opening it updates the editor's file label.
    await expect(page.locator(".av-file")).toContainText("Keymap");
  });
});
