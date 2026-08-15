import { boot, expect, test } from "./fixtures";

// In-note find (editor/find.ts + find-bar.tsx over prosemirror-search):
// Mod-f toggles the bar, Enter/F3 cycle matches, Esc closes the bar but keeps
// the highlights lit (hlsearch parity), ✕ clears them.
test.describe("find in note", () => {
  test("Mod-f finds, cycles, persists highlights on close, clears on ✕", async ({ page }) => {
    await boot(page);
    await page.locator(".av-cm .tiptap").click();

    await page.keyboard.press("ControlOrMeta+f");
    const input = page.locator(".av-find-input");
    await expect(input).toBeFocused();
    await input.fill("the");
    const matches = page.locator(".ProseMirror-search-match");
    await expect(matches.first()).toBeVisible();

    // Enter selects the first match (it becomes the styled active match)
    await page.keyboard.press("Enter");
    await expect(page.locator(".av-find-count")).toHaveText(/^\d+\/\d+$/);
    await expect(page.locator(".ProseMirror-active-search-match")).toHaveCount(1);

    // Esc closes the bar; the highlights stay (hlsearch parity) and F3 cycles
    await page.keyboard.press("Escape");
    await expect(page.locator(".av-find")).toHaveCount(0);
    await expect(page.locator(".ProseMirror-active-search-match")).toHaveCount(1);
    await page.keyboard.press("F3");
    await expect(page.locator(".ProseMirror-active-search-match")).toHaveCount(1);

    // reopen and clear via ✕ — highlights gone
    await page.keyboard.press("ControlOrMeta+f");
    await page.locator(".av-find-close").click();
    await expect(page.locator(".av-find")).toHaveCount(0);
    await expect(page.locator(".ProseMirror-search-match")).toHaveCount(0);
  });

  test("Mod-f toggles closed from inside the bar", async ({ page }) => {
    await boot(page);
    await page.locator(".av-cm .tiptap").click();
    await page.keyboard.press("ControlOrMeta+f");
    await expect(page.locator(".av-find-input")).toBeFocused();
    await page.keyboard.press("ControlOrMeta+f");
    await expect(page.locator(".av-find")).toHaveCount(0);
  });
});
