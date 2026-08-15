import { boot, expect, test } from "./fixtures";

// ISSUE #24: `~/.notesiderc` is a view of the Config object, not a real file.
// serialize() regenerates it from scratch, so anything parseConfig didn't
// recognize used to vanish on the next open — while the toast still said
// "config applied". These drive the reporter's exact flow through the real
// buffer (now a plain textarea): open, edit, save, close, reopen.
test.describe("the ~/.notesiderc buffer", () => {
  const openConfig = async (page: import("@playwright/test").Page) => {
    await page.keyboard.press("ControlOrMeta+Shift+p");
    await page.keyboard.type("notesiderc");
    await page.keyboard.press("Enter");
    await expect(page.locator(".av-file")).toContainText("notesiderc");
    await expect(page.locator(".av-plain")).toBeVisible();
  };

  /** Place the caret at the very end of the config textarea. */
  const caretToEnd = async (page: import("@playwright/test").Page) => {
    await page.locator(".av-plain").click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ArrowRight");
  };

  test("keeps a line it does not understand, and says so", async ({ page }) => {
    await boot(page);
    await openConfig(page);

    // append an unknown directive at the end of the buffer
    await caretToEnd(page);
    await page.keyboard.type("\nset nonsense = 7");
    await page.keyboard.press("ControlOrMeta+s");

    // the save is honest about what did not take effect
    await expect(page.locator(".av-toast")).toContainText("not recognized");
    await expect(page.locator(".av-toast")).toContainText("nonsense");

    // leave the buffer and come back — the line is still there. (Wait for the
    // note buffer to be back first: its mount refocuses the editor, which would
    // steal focus from a command search opened mid-remount.)
    await page.keyboard.press("ControlOrMeta+w");
    await expect(page.locator(".av-plain")).toHaveCount(0);
    await openConfig(page);
    await expect(page.locator(".av-plain")).toHaveValue(/set nonsense = 7/);
  });

  test("applies `set tabstop=4`, the vim spelling, instead of discarding it", async ({ page }) => {
    await boot(page);
    await openConfig(page);

    await caretToEnd(page);
    await page.keyboard.type("\nset tabstop=4");
    await page.keyboard.press("ControlOrMeta+s");

    // recognized now, so it applies cleanly — no "not recognized" warning
    await expect(page.locator(".av-toast")).toHaveText("config applied");

    // and it is normalized to Noteside's own key on reopen
    await page.keyboard.press("ControlOrMeta+w");
    await expect(page.locator(".av-plain")).toHaveCount(0);
    await openConfig(page);
    await expect(page.locator(".av-plain")).toHaveValue(/set tab-width {4}= 4/);
    // nothing was stashed as unrecognized — the alias was understood, not kept
    await expect(page.locator(".av-plain")).not.toHaveValue(/does not recognize/);
  });

  test("a fully understood config applies without warning", async ({ page }) => {
    await boot(page);
    await openConfig(page);
    await page.locator(".av-plain").click();
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.locator(".av-toast")).toHaveText("config applied");
  });
});
