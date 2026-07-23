import { boot, expect, test } from "./fixtures";

test.describe("settings apply live", () => {
  test("picking a theme updates the document immediately", async ({ page }) => {
    await boot(page, { theme: "light" });
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", "light");

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.locator(".set-panel").waitFor();

    // The Theme row opens the two-column live-preview picker.
    await page.getByRole("button", { name: /Noteside Light/ }).click();
    await page.locator(".thm-cols").waitFor();

    // A builtin theme applies no inline overrides — the base16 pick must land
    // its palette inline on <html> (and flip data-theme) with no reload.
    const paperVar = () =>
      page.evaluate(() => document.documentElement.style.getPropertyValue("--paper").trim());
    expect(await paperVar()).toBe("");

    await page.locator(".thm-row", { hasText: "Catppuccin Mocha" }).click();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect.poll(paperVar).not.toBe("");
    await expect(page.locator(".thm-cols")).toHaveCount(0); // click commits + closes
  });

  test("Enter follows the focused close button", async ({ page }) => {
    await boot(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const close = page.locator(".set-x");

    // Direct focus is portable across Safari's "Tab skips buttons" OS setting.
    await close.focus();
    await expect(close).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(page.locator(".set-panel")).toHaveCount(0);
    await expect(page.locator(".thm-cols")).toHaveCount(0);
  });
});
