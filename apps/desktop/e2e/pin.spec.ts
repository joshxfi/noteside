import { boot, expect, test } from "./fixtures";

// Pin is a native-menu item backed by a real command, so — like duplicate/rename
// — these drive the command-search path the web build can exercise. The native
// menu is a thin dispatcher onto the same handler.

/** Run a command by title through the searchable command palette. */
const runCommand = async (page: import("@playwright/test").Page, title: string) => {
  await page.keyboard.press("ControlOrMeta+Shift+p");
  await expect(page.locator(".fnd-input")).toBeFocused();
  await page.keyboard.type(title);
  await page.keyboard.press("Enter");
};

test.describe("pin note", () => {
  test("pin floats the note to the top of the sidebar and marks the row", async ({ page }) => {
    await boot(page);

    // Open the LAST note so pinning has somewhere visible to move it from.
    const rows = page.locator(".av-item");
    const before = await rows.count();
    await rows.nth(before - 1).click();
    const title = await page.locator(".av-item.is-active .av-item-titletext").innerText();
    await expect(page.locator(".av-item-pin")).toHaveCount(0);

    await runCommand(page, "pin note");

    await expect(page.locator(".av-toast")).toContainText("note pinned");
    await expect(page.locator(".av-item")).toHaveCount(before); // nothing added/removed
    // the pinned note is now first, and carries the marker
    await expect(rows.first().locator(".av-item-titletext")).toHaveText(title);
    await expect(rows.first().locator(".av-item-pin")).toHaveCount(1);
    await expect(page.locator(".av-item-pin")).toHaveCount(1); // only that one row
  });

  test("unpin clears the marker", async ({ page }) => {
    await boot(page);

    await runCommand(page, "pin note");
    await expect(page.locator(".av-item-pin")).toHaveCount(1);

    await runCommand(page, "unpin");

    await expect(page.locator(".av-toast")).toContainText("note unpinned");
    await expect(page.locator(".av-item-pin")).toHaveCount(0);
  });

  // Pin/Unpin are two commands, not one toggle — `needsPinned` keeps the
  // palette offering only the one that applies, so the wrong-state action
  // (the old :unpin-pins-a-note bug) is unreachable from this surface.
  // (The ex-command spellings get re-covered by vim.spec when the vim layer lands.)
  test("the palette only offers the applicable pin command", async ({ page }) => {
    await boot(page);

    await page.keyboard.press("ControlOrMeta+Shift+p");
    await page.keyboard.type("pin");
    await expect(page.locator(".fnd-row").filter({ hasText: "Pin note" })).toHaveCount(1);
    await expect(page.locator(".fnd-row").filter({ hasText: "Unpin note" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await runCommand(page, "pin note");
    await expect(page.locator(".av-item-pin")).toHaveCount(1);

    await page.keyboard.press("ControlOrMeta+Shift+p");
    await page.keyboard.type("pin");
    await expect(page.locator(".fnd-row").filter({ hasText: "Unpin note" })).toHaveCount(1);
    await expect(page.locator(".fnd-row").filter({ hasText: /^Pin note/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  // The regression this guards: pinning rewrites the note's frontmatter on disk,
  // so the open buffer must be flushed AND reloaded. Without the reload the editor
  // would still hold the pre-pin text and the next keystroke's autosave would
  // write it back, silently unpinning the note.
  test("pinning the open note keeps unsaved edits and survives later typing", async ({ page }) => {
    await boot(page);
    await page.locator(".av-cm .tiptap").click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.type(" UNSAVED_PIN_SENTINEL");

    await runCommand(page, "pin note");
    await expect(page.locator(".av-toast")).toContainText("note pinned");

    // the pre-pin edit was flushed, not lost
    await expect(page.locator(".av-cm .tiptap")).toContainText("UNSAVED_PIN_SENTINEL");
    // the frontmatter the backend wrote never appears in the editor — it is
    // split off verbatim before parsing, not rendered-and-hidden
    await expect(page.locator(".av-cm .tiptap")).not.toContainText("pinned");

    // typing afterwards autosaves the reloaded buffer (held frontmatter
    // re-attached on serialize), so the pin sticks instead of being written away
    await page.locator(".av-cm .tiptap").click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.type(" AFTER_PIN");
    await page.waitForTimeout(1200); // past the 800ms autosave debounce

    // if the autosave had dropped the frontmatter, the mock's meta parse would
    // unpin the row — its marker surviving IS the end-to-end proof
    await expect(page.locator(".av-item.is-active .av-item-pin")).toHaveCount(1);
  });
});
