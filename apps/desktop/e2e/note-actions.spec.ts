import { caretToEnd, boot, expect, test } from "./fixtures";

// Duplicate + Rename are native-menu items backed by real commands; the menu is
// native (Tauri-only), so these drive the command-search path that the web
// build can exercise — same handlers the native menu dispatches. (Reveal opens
// a file manager and no-ops in the mock, so it isn't covered here.)

/** Run a (non-danger) command by title through the searchable command palette. */
const runCommand = async (page: import("@playwright/test").Page, title: string) => {
  await page.keyboard.press("ControlOrMeta+Shift+p");
  await expect(page.locator(".fnd-input")).toBeFocused();
  await page.keyboard.type(title);
  await page.keyboard.press("Enter");
};

test.describe("duplicate note", () => {
  test("duplicate copies the active note to a '… copy' and opens it", async ({ page }) => {
    await boot(page);
    await page.locator(".av-cm .tiptap").click();

    const activeTitle = await page.locator(".av-item.is-active .av-item-titletext").innerText();
    const before = await page.locator(".av-item").count();

    await runCommand(page, "duplicate");

    await expect(page.locator(".av-toast")).toContainText("note duplicated");
    await expect(page.locator(".av-item")).toHaveCount(before + 1);
    // the copy is now active and titled "<original> copy"
    await expect(page.locator(".av-item.is-active .av-item-titletext")).toHaveText(
      `${activeTitle} copy`,
    );
    // the original still exists
    await expect(page.locator(".av-item-titletext").filter({ hasText: activeTitle })).toHaveCount(
      2, // "X" and "X copy" both contain "X"
    );
  });

  test("duplicate includes edits made immediately before duplication", async ({ page }) => {
    await boot(page);
    // Caret to the end of the doc, then type an unsaved sentinel.
    await caretToEnd(page);
    await page.keyboard.type(" UNSAVED_DUPLICATE_SENTINEL");

    await runCommand(page, "duplicate");

    await expect(page.locator(".av-toast")).toContainText("note duplicated");
    await expect(page.locator(".av-cm .tiptap")).toContainText("UNSAVED_DUPLICATE_SENTINEL");
  });
});

test.describe("rename note", () => {
  test("rename opens a prefilled prompt; confirming retitles the note", async ({ page }) => {
    await boot(page);
    await page.locator(".av-cm .tiptap").click();
    const before = await page.locator(".av-item").count();

    await runCommand(page, "rename");

    // The prompt opens with the current title pre-selected.
    const input = page.locator(".cfm-input");
    await expect(input).toBeVisible();
    await expect(input).not.toHaveValue("");

    await input.fill("Renamed By Test");
    await page.keyboard.press("Enter");

    await expect(page.locator(".cfm-panel")).toHaveCount(0);
    await expect(page.locator(".av-toast")).toContainText("note renamed");
    // no note added/removed; the active row shows the new title
    await expect(page.locator(".av-item")).toHaveCount(before);
    await expect(page.locator(".av-item.is-active .av-item-titletext")).toHaveText(
      "Renamed By Test",
    );
  });

  test("cancelling the rename prompt changes nothing", async ({ page }) => {
    await boot(page);
    await page.locator(".av-cm .tiptap").click();
    const activeTitle = await page.locator(".av-item.is-active .av-item-titletext").innerText();

    await runCommand(page, "rename");
    await expect(page.locator(".cfm-input")).toBeVisible();
    await page.keyboard.press("Escape");

    await expect(page.locator(".cfm-panel")).toHaveCount(0);
    await expect(page.locator(".av-item.is-active .av-item-titletext")).toHaveText(activeTitle);
  });
});
