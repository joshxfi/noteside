import { boot, expect, test } from "./fixtures";

// Caret rendering: non-vim uses the native caret (data-cursor still carries
// the configured shape for CSS); vim normal/visual draw the one-char block
// decoration (.av-vim-caret) and hide it again in insert mode.
test.describe("caret", () => {
  test("the configured cursor shape rides data-cursor", async ({ page }) => {
    await boot(page, { vimMode: false, cursor: "bar" });
    await expect(page.locator(".av-editor")).toHaveAttribute("data-cursor", "bar");
  });

  test("vim normal mode draws the block caret; insert hides it", async ({ page }) => {
    await boot(page, { vimMode: true });
    await page.locator(".av-cm .tiptap").click();
    await expect(page.locator(".av-editor")).toHaveAttribute("data-vim-mode", "normal");
    await expect(page.locator(".av-vim-caret, .av-vim-caret-blank").first()).toBeVisible();

    await page.keyboard.press("i");
    await expect(page.locator(".av-editor")).toHaveAttribute("data-vim-mode", "insert");
    await expect(page.locator(".av-vim-caret, .av-vim-caret-blank")).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(page.locator(".av-vim-caret, .av-vim-caret-blank").first()).toBeVisible();
  });

  test("non-vim editors render no vim caret and no vim mode attr", async ({ page }) => {
    await boot(page, { vimMode: false });
    await page.locator(".av-cm .tiptap").click();
    await expect(page.locator(".av-editor")).not.toHaveAttribute("data-vim-mode");
    await expect(page.locator(".av-vim-caret, .av-vim-caret-blank")).toHaveCount(0);
    await expect(page.locator(".av-mode")).toHaveText("TEXT");
  });
});
