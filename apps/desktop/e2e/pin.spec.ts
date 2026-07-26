import { boot, expect, test } from "./fixtures";

// Pin is a native-menu item backed by a real command, so — like duplicate/rename
// — these drive the command path (:pin / :unpin) the web build can exercise. The
// native menu is a thin dispatcher onto the same handler.
test.describe("pin note", () => {
  test(":pin floats the note to the top of the sidebar and marks the row", async ({ page }) => {
    await boot(page, { vimMode: true });
    await page.locator(".cm-content").click();

    // Open the LAST note so pinning has somewhere visible to move it from.
    const rows = page.locator(".av-item");
    const before = await rows.count();
    await rows.nth(before - 1).click();
    const title = await page.locator(".av-item.is-active .av-item-titletext").innerText();
    await expect(page.locator(".av-item-pin")).toHaveCount(0);

    await page.locator(".cm-content").click();
    await page.keyboard.press(":");
    await page.keyboard.type("pin");
    await page.keyboard.press("Enter");

    await expect(page.locator(".av-toast")).toContainText("note pinned");
    await expect(page.locator(".av-item")).toHaveCount(before); // nothing added/removed
    // the pinned note is now first, and carries the marker
    await expect(rows.first().locator(".av-item-titletext")).toHaveText(title);
    await expect(rows.first().locator(".av-item-pin")).toHaveCount(1);
    await expect(page.locator(".av-item-pin")).toHaveCount(1); // only that one row
  });

  test(":unpin clears the marker", async ({ page }) => {
    await boot(page, { vimMode: true });
    await page.locator(".cm-content").click();

    await page.keyboard.press(":");
    await page.keyboard.type("pin");
    await page.keyboard.press("Enter");
    await expect(page.locator(".av-item-pin")).toHaveCount(1);

    await page.locator(".cm-content").click();
    await page.keyboard.press(":");
    await page.keyboard.type("unpin");
    await page.keyboard.press("Enter");

    await expect(page.locator(".av-toast")).toContainText("note unpinned");
    await expect(page.locator(".av-item-pin")).toHaveCount(0);
  });

  // REGRESSION: `:pin`/`:unpin` used to be two ex-names on ONE toggling command,
  // so each said the opposite of what it did on the wrong state.
  test("the ex-commands set state, they do not toggle", async ({ page }) => {
    await boot(page, { vimMode: true });
    await page.locator(".cm-content").click();

    // :unpin on an already-unpinned note must NOT pin it
    await page.keyboard.press(":");
    await page.keyboard.type("unpin");
    await page.keyboard.press("Enter");
    await expect(page.locator(".av-toast")).toContainText("note unpinned");
    await expect(page.locator(".av-item-pin")).toHaveCount(0);

    // :pin twice leaves it pinned, not toggled back off
    for (let i = 0; i < 2; i++) {
      await page.locator(".cm-content").click();
      await page.keyboard.press(":");
      await page.keyboard.type("pin");
      await page.keyboard.press("Enter");
      await expect(page.locator(".av-toast")).toContainText("note pinned");
    }
    await expect(page.locator(".av-item-pin")).toHaveCount(1);
  });

  // The regression this guards: pinning rewrites the note's frontmatter on disk,
  // so the open buffer must be flushed AND reloaded. Without the reload the editor
  // would still hold the pre-pin text and the next keystroke's autosave would
  // write it back, silently unpinning the note.
  test("pinning the open note keeps unsaved edits and survives later typing", async ({ page }) => {
    await boot(page, { vimMode: true });
    await page.locator(".cm-content").click();
    await page.keyboard.press("G");
    await page.keyboard.press("A");
    await page.keyboard.type(" UNSAVED_PIN_SENTINEL");
    await page.keyboard.press("Escape");

    await page.keyboard.press(":");
    await page.keyboard.type("pin");
    await page.keyboard.press("Enter");
    await expect(page.locator(".av-toast")).toContainText("note pinned");

    // the pre-pin edit was flushed, not lost
    await expect(page.locator(".cm-content")).toContainText("UNSAVED_PIN_SENTINEL");
    // the reopened buffer carries the frontmatter the backend wrote, hidden by
    // preview rather than shown as YAML (see markdown-preview.spec)
    await expect(page.locator(".cm-content")).not.toContainText("pinned");

    // typing afterwards autosaves the reloaded (frontmatter-carrying) text, so
    // the pin sticks instead of being written away
    await page.locator(".cm-content").click();
    await page.keyboard.press("G");
    await page.keyboard.press("A");
    await page.keyboard.type(" AFTER_PIN");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1000); // past the 800ms autosave debounce

    await expect(page.locator(".av-item.is-active .av-item-pin")).toHaveCount(1);
    // and the autosaved text really still carries it — `gg` reveals the block
    await page.keyboard.press("g");
    await page.keyboard.press("g");
    await expect(page.locator(".cm-content")).toContainText("pinned: true");
  });
});
