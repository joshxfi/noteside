import { boot, expect, test } from "./fixtures";

test.describe("new note", () => {
  test("the sidebar button creates and opens an untitled note", async ({ page }) => {
    await boot(page, { vimMode: false });
    await page.getByRole("button", { name: "New note" }).click();
    // A fresh note is titled "Untitled" and opens in the editor.
    await expect(page.locator(".av-file")).toContainText("Untitled");
    await expect(page.locator(".av-item.is-active")).toContainText("Untitled");
  });
});
