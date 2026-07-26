import { boot, expect, test } from "./fixtures";

// ISSUE #24: `~/.notesiderc` is a view of the Config object, not a real file.
// serialize() regenerates it from scratch, so anything parseConfig didn't
// recognize used to vanish on the next open — while the toast still said
// "config applied". These drive the reporter's exact flow through the real
// buffer: `:config`, edit, `:w`, close, reopen.
test.describe("the ~/.notesiderc buffer", () => {
  const openConfig = async (page: import("@playwright/test").Page) => {
    await page.locator(".cm-content").click();
    await page.keyboard.press(":");
    await page.keyboard.type("config");
    await page.keyboard.press("Enter");
    await expect(page.locator(".av-file")).toContainText("notesiderc");
  };

  const write = async (page: import("@playwright/test").Page) => {
    await page.keyboard.press("Escape");
    await page.keyboard.press(":");
    await page.keyboard.type("w");
    await page.keyboard.press("Enter");
  };

  test("keeps a line it does not understand, and says so", async ({ page }) => {
    await boot(page, { vimMode: true });
    await openConfig(page);

    // append an unknown directive at the end of the buffer
    await page.keyboard.press("G");
    await page.keyboard.press("o");
    await page.keyboard.type("set nonsense = 7");
    await write(page);

    // the save is honest about what did not take effect
    await expect(page.locator(".av-toast")).toContainText("not recognized");
    await expect(page.locator(".av-toast")).toContainText("nonsense");

    // leave the buffer and come back — the line is still there
    await page.keyboard.press(":");
    await page.keyboard.type("q");
    await page.keyboard.press("Enter");
    await openConfig(page);
    // `G` first: CodeMirror only renders the viewport, and the kept-lines
    // section sits past the fold — without scrolling it simply isn't in the DOM.
    await page.keyboard.press("G");
    await expect(page.locator(".cm-content")).toContainText("set nonsense = 7");
  });

  test("applies `set tabstop=4`, the vim spelling, instead of discarding it", async ({ page }) => {
    await boot(page, { vimMode: true });
    await openConfig(page);

    await page.keyboard.press("G");
    await page.keyboard.press("o");
    await page.keyboard.type("set tabstop=4");
    await write(page);

    // recognized now, so it applies cleanly — no "not recognized" warning
    await expect(page.locator(".av-toast")).toHaveText("config applied");

    // and it is normalized to Noteside's own key on reopen
    await page.keyboard.press(":");
    await page.keyboard.type("q");
    await page.keyboard.press("Enter");
    await openConfig(page);
    await expect(page.locator(".cm-content")).toContainText("set tab-width    = 4");
    // nothing was stashed as unrecognized — the alias was understood, not kept
    await page.keyboard.press("G");
    await expect(page.locator(".cm-content")).not.toContainText("does not recognize");
  });

  test("a fully understood config applies without warning", async ({ page }) => {
    await boot(page, { vimMode: true });
    await openConfig(page);
    await write(page);
    await expect(page.locator(".av-toast")).toHaveText("config applied");
  });
});
