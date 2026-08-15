import { boot, caretToEnd, expect, test } from "./fixtures";

/** Stub window.open (the web build's external-open path) and record hand-offs. */
const stubOpen = async (page: import("@playwright/test").Page) => {
  await page.addInitScript(() => {
    const opened: string[] = [];
    (window as Window & { __opened?: string[] }).__opened = opened;
    window.open = ((url?: string | URL) => {
      opened.push(String(url));
      return null;
    }) as typeof window.open;
  });
};

const openedUrls = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (window as Window & { __opened?: string[] }).__opened ?? []);

test.describe("open URL under cursor", () => {
  test("following a URL opens it externally", async ({ page }) => {
    await stubOpen(page);
    await boot(page);

    await caretToEnd(page);
    await page.keyboard.press("Enter");
    await page.keyboard.type("https://noteside.app");
    await expect(page.locator(".av-cm .tiptap")).toContainText("https://noteside.app");
    // caret inside the URL
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Alt+Enter");

    await expect.poll(() => openedUrls(page)).toContain("https://noteside.app");
  });

  // REGRESSION: urlAt's end is half-open, so a caret resting immediately AFTER
  // a URL (the position you're in the instant you finish typing one) found
  // nothing and Alt-Enter silently did nothing. Following now probes the
  // position before the caret too.
  test("follows a URL with the caret resting right after it", async ({ page }) => {
    await stubOpen(page);
    await boot(page);

    await caretToEnd(page);
    await page.keyboard.press("Enter");
    await page.keyboard.type("https://noteside.app");
    await expect(page.locator(".av-cm .tiptap")).toContainText("https://noteside.app");
    // NO arrow keys — the caret sits at the URL's end, exactly as typed
    await page.keyboard.press("Alt+Enter");

    await expect.poll(() => openedUrls(page)).toContain("https://noteside.app");
  });
});
