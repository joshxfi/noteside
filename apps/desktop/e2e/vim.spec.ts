import { boot, expect, test } from "./fixtures";

test.describe("vim mode", () => {
  test("insert mode types text and Esc returns to normal", async ({ page }) => {
    await boot(page, { vimMode: true });
    const mode = page.locator(".av-mode");
    const content = page.locator(".cm-content");

    await content.click();
    await expect(mode).toHaveClass(/mode-normal/);

    await page.keyboard.press("i");
    await expect(mode).toHaveClass(/mode-insert/);
    await page.keyboard.type("hello from e2e ");
    await page.keyboard.press("Escape");

    await expect(mode).toHaveClass(/mode-normal/);
    await expect(content).toContainText("hello from e2e");
  });
});
