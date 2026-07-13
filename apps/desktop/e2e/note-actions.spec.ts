import { boot, expect, test } from "./fixtures";

// Duplicate + Rename are native-menu items backed by real commands; the menu is
// native (Tauri-only), so these drive the command path (:dup / :rename) that the
// web build can exercise — same handlers the native menu dispatches. (Reveal opens
// a file manager and no-ops in the mock, so it isn't covered here.)
test.describe("duplicate note", () => {
  test(":dup copies the active note to a '… copy' and opens it", async ({ page }) => {
    await boot(page, { vimMode: true });
    await page.locator(".cm-content").click();

    const activeTitle = await page.locator(".av-item.is-active .av-item-titletext").innerText();
    const before = await page.locator(".av-item").count();

    await page.keyboard.press(":");
    await page.keyboard.type("dup");
    await page.keyboard.press("Enter");

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

  test(":dup includes edits made immediately before duplication", async ({ page }) => {
    await boot(page, { vimMode: true });
    await page.locator(".cm-content").click();
    await page.keyboard.press("G");
    await page.keyboard.press("A");
    await page.keyboard.type(" UNSAVED_DUPLICATE_SENTINEL");
    await page.keyboard.press("Escape");
    await page.keyboard.press(":");
    await page.keyboard.type("dup");
    await page.keyboard.press("Enter");

    await expect(page.locator(".av-toast")).toContainText("note duplicated");
    await expect(page.locator(".cm-content")).toContainText("UNSAVED_DUPLICATE_SENTINEL");
  });
});

test.describe("rename note", () => {
  test(":rename opens a prefilled prompt; confirming retitles the note", async ({ page }) => {
    await boot(page, { vimMode: true });
    await page.locator(".cm-content").click();
    const before = await page.locator(".av-item").count();

    await page.keyboard.press(":");
    await page.keyboard.type("rename");
    await page.keyboard.press("Enter");

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
    await boot(page, { vimMode: true });
    await page.locator(".cm-content").click();
    const activeTitle = await page.locator(".av-item.is-active .av-item-titletext").innerText();

    await page.keyboard.press(":");
    await page.keyboard.type("rename");
    await page.keyboard.press("Enter");
    await expect(page.locator(".cfm-input")).toBeVisible();
    await page.keyboard.press("Escape");

    await expect(page.locator(".cfm-panel")).toHaveCount(0);
    await expect(page.locator(".av-item.is-active .av-item-titletext")).toHaveText(activeTitle);
  });
});
