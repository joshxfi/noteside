import { boot, expect, test } from "./fixtures";

// The mock backend seeds two notebooks (/demo-notebook + /demo-journal); boot
// opens /demo-notebook, so switching is observable as the sidebar note list
// swapping. See src/backend/mock.ts.
test.describe("notebook switcher", () => {
  test("the titlebar button switches notebooks, swapping the note list", async ({ page }) => {
    await boot(page);
    await expect(page.locator(".av-item").filter({ hasText: "Welcome to Noteside" })).toHaveCount(
      1,
    );

    await page.locator('button[aria-label="switch notebook"]').click();
    await expect(page.locator(".nb-panel")).toBeVisible();
    // both seeded notebooks are listed, current one marked
    await expect(page.locator(".nb-list .fnd-row").filter({ hasText: "demo-journal" })).toHaveCount(
      1,
    );
    await expect(page.locator(".fnd-row").filter({ hasText: "demo-notebook" })).toContainText(
      "current",
    );

    await page.locator(".nb-list .fnd-row").filter({ hasText: "demo-journal" }).click();
    await expect(page.locator(".nb-panel")).toHaveCount(0);
    // the sidebar now shows the journal's notes, not the demo notebook's
    await expect(page.locator(".av-item").filter({ hasText: "Monday" })).toHaveCount(1);
    await expect(page.locator(".av-item").filter({ hasText: "Welcome to Noteside" })).toHaveCount(
      0,
    );
  });

  test("Mod-o opens the switcher; Esc closes it without switching", async ({ page }) => {
    await boot(page);
    await page.locator(".cm-content").click(); // focus the editor so the chord routes through it
    const before = await page.locator(".av-item").count();

    await page.keyboard.press("ControlOrMeta+o");
    await expect(page.locator(".nb-panel")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".nb-panel")).toHaveCount(0);
    await expect(page.locator(".av-item")).toHaveCount(before); // nothing switched
  });
});
