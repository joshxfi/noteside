import { boot, expect, test } from "./fixtures";

test.describe("settings apply live", () => {
  test("theme and accent update the document immediately", async ({ page }) => {
    await boot(page, { theme: "light" });
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", "light");

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.locator(".set-panel").waitFor();

    await page.getByRole("button", { name: "Dark", exact: true }).click();
    await expect(html).toHaveAttribute("data-theme", "dark");

    const accentBase = () =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--accent-base").trim(),
      );
    const before = await accentBase();
    await page.locator(".set-swatch").last().click();
    await expect.poll(accentBase).not.toBe(before);
  });
});
