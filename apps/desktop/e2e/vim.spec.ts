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

  test("Tab indents without moving focus in insert mode", async ({ page }) => {
    await boot(page, { vimMode: true });
    await page.getByRole("button", { name: "New note" }).click();
    const content = page.locator(".cm-content");

    await page.keyboard.press("i");
    await page.keyboard.press("Tab");
    await expect(content).toBeFocused();
    await page.keyboard.type("indented");

    const text = await content.textContent();
    expect(text).toMatch(/^ {2}indented/);
  });

  test("Tab does not indent in normal mode", async ({ page }) => {
    await boot(page, { vimMode: true });
    await page.getByRole("button", { name: "New note" }).click();
    const content = page.locator(".cm-content");
    const before = await content.textContent();

    await page.keyboard.press("Tab");

    await expect(content).toBeFocused();
    expect(await content.textContent()).toBe(before);
    await expect(page.locator(".av-mode")).toHaveClass(/mode-normal/);
  });
});
