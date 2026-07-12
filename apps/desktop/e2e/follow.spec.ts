import { boot, expect, test } from "./fixtures";

test.describe("open URL under cursor", () => {
  test("following a URL opens it externally", async ({ page }) => {
    // Web build routes external opens through window.open — stub it (no network)
    // and record the URL the app hands off.
    await page.addInitScript(() => {
      const opened: string[] = [];
      (window as Window & { __opened?: string[] }).__opened = opened;
      window.open = ((url?: string | URL) => {
        opened.push(String(url));
        return null;
      }) as typeof window.open;
    });
    await boot(page, { vimMode: false });

    await page.locator(".cm-content").click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("https://noteside.app");
    await page.keyboard.press("Home");
    await page.keyboard.press("Alt+Enter");

    const opened = await page.evaluate(
      () => (window as Window & { __opened?: string[] }).__opened ?? [],
    );
    expect(opened).toContain("https://noteside.app");
  });
});
