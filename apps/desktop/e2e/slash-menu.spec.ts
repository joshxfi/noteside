import { caretToEnd, boot, expect, test } from "./fixtures";

// The `/` block-insertion menu (editor/slash-menu.ts): opens at the start of
// an empty line, filters with the shared fuzzy, inserts on Enter or click.
test.describe("slash menu", () => {
  const freshLine = async (page: import("@playwright/test").Page) => {
    await page.locator(".av-sidefoot").getByRole("button", { name: "New note" }).click();
    await caretToEnd(page);
    await page.keyboard.press("Enter");
  };

  test("keyboard: / filters, arrows move, Enter inserts a table", async ({ page }) => {
    await boot(page);
    await freshLine(page);

    await page.keyboard.type("/");
    await expect(page.locator(".av-slash")).toBeVisible();
    await page.keyboard.type("table");
    await expect(page.locator(".av-slash-row")).toHaveCount(1);
    await page.keyboard.press("Enter");

    await expect(page.locator(".av-slash")).toHaveCount(0);
    await expect(page.locator(".av-cm .tiptap table")).toBeVisible();
    // no literal "/table" text left behind
    await expect(page.locator(".av-cm .tiptap")).not.toContainText("/table");
  });

  test("pointer: a row click inserts; Esc closes without inserting", async ({ page }) => {
    await boot(page);
    await freshLine(page);

    await page.keyboard.type("/");
    await expect(page.locator(".av-slash")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".av-slash")).toHaveCount(0);
    // the "/" stays as text and typing continues without the menu
    await page.keyboard.type("x");
    await expect(page.locator(".av-slash")).toHaveCount(0);

    // a fresh line starts a fresh session
    await page.keyboard.press("Enter");
    await page.keyboard.type("/quo");
    await page.locator(".av-slash-row", { hasText: "Quote" }).click();
    await expect(page.locator(".av-cm .tiptap blockquote")).toBeVisible();
  });
});
