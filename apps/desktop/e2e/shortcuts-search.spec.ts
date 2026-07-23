import { boot, expect, test } from "./fixtures";

// The Mod-/ cheatsheet is the keymap editor; it now leads with a search box so a
// shortcut is quick to find. Typing filters, ↑↓ selects, Enter records a rebind.
test.describe("keyboard shortcuts search", () => {
  test("typing filters the list and Enter+chord rebinds the match", async ({ page }) => {
    await boot(page, { vimMode: false });
    await page.locator(".cm-content").click();

    await page.keyboard.press("ControlOrMeta+/");
    await expect(page.locator(".cheat-panel")).toBeVisible();
    // the search input owns focus on open
    await expect(page.locator(".cheat-search-input")).toBeFocused();

    // filter down to a single command
    await page.keyboard.type("duplicate");
    const rows = page.locator(".cheat-row");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Duplicate note");
    // it starts unbound ("add chord")
    await expect(rows.first().locator(".cheat-key")).toHaveClass(/is-none/);

    // Enter records; press a free modified chord to bind it.
    await page.keyboard.press("Enter");
    await expect(page.locator(".cheat-key.is-recording")).toBeVisible();
    await page.keyboard.press("Alt+d");

    // the row is now bound (no longer the "add chord" placeholder)
    await expect(rows.first().locator(".cheat-key")).not.toHaveClass(/is-none/);
    await expect(rows.first().locator(".cheat-key")).not.toHaveText(/add chord/);
  });

  test("bare typing keys are rejected while recording", async ({ page }) => {
    await boot(page, { vimMode: false });
    const before = await page.locator(".av-item").count();
    await page.keyboard.press("ControlOrMeta+/");
    await page.locator(".cheat-search-input").fill("new note");

    await page.keyboard.press("Enter");
    await page.keyboard.press("a");
    await expect(page.locator(".cheat-unsafe")).toContainText(
      "add Cmd/Ctrl, Alt, or a function key",
    );

    // Escape stops recording, then closes the shortcut editor.
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(page.locator(".cheat-panel")).toHaveCount(0);
    await page.keyboard.press("a");

    await expect(page.locator(".av-item")).toHaveCount(before);
    await expect(page.locator(".cm-content")).toContainText("a");
  });

  test("unsafe persisted overrides are removed on boot", async ({ page }) => {
    await boot(page, { vimMode: false, chords: { new: "a" } });
    const before = await page.locator(".av-item").count();
    await page.keyboard.press("ControlOrMeta+/");
    await page.locator(".cheat-search-input").fill("new note");

    // The unsafe legacy override no longer appears as the effective shortcut.
    await expect(page.locator(".cheat-row")).toHaveCount(1);
    await expect(page.locator(".cheat-key")).not.toHaveText("A");

    await page.keyboard.press("Escape");
    await page.keyboard.press("a");
    await expect(page.locator(".av-item")).toHaveCount(before);
    await expect(page.locator(".cm-content")).toContainText("a");
  });

  test("a no-match query shows the empty state; Escape closes", async ({ page }) => {
    await boot(page, { vimMode: false });
    await page.locator(".cm-content").click();
    await page.keyboard.press("ControlOrMeta+/");
    await page.locator(".cheat-search-input").waitFor();

    await page.keyboard.type("zzzzzzz");
    await expect(page.locator(".cheat-empty")).toBeVisible();
    await expect(page.locator(".cheat-row")).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(page.locator(".cheat-panel")).toHaveCount(0);
  });
});
