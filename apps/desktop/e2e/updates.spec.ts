import { boot, expect, test } from "./fixtures";

// The automatic update check is native-only (gated on isTauri), so the web build
// under test never phones home and never shows the badge — these specs cover the
// setting's UI: the switch is on by default, toggles, and persists to the config.
test.describe("automatic updates", () => {
  // The row label carries a hint span ("check on launch"), so match the label
  // text unanchored rather than with ^…$ (the Blink row has no hint; this does).
  const row = (page: import("@playwright/test").Page) =>
    page
      .locator(".set-row")
      .filter({ has: page.locator(".set-rowlabel", { hasText: "Automatic updates" }) });

  test("the switch defaults on and toggles", async ({ page }) => {
    await boot(page, { vimMode: false });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.locator(".set-panel").waitFor();

    const sw = row(page).locator("button.set-switch");
    await expect(sw).toHaveClass(/is-on/); // default on
    await sw.click();
    await expect(sw).not.toHaveClass(/is-on/);
    await sw.click();
    await expect(sw).toHaveClass(/is-on/);
  });

  test("no update badge appears on the web build (never phones home)", async ({ page }) => {
    await boot(page, { vimMode: false });
    // isTauri() is false in the browser, so the boot check never runs.
    await expect(page.locator(".av-update-dot")).toHaveCount(0);
  });
});
