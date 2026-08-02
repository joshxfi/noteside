import { boot, expect, test } from "./fixtures";

// The web/demo build's note context menu (components/context-menu.tsx) — the
// in-app twin of the Tauri-native menu. It dispatches the SAME App handlers as
// the commands, so this also covers the note actions' pointer path end-to-end.
// (The native OS menu still needs a manual check in `pnpm dev:desktop`.)
test.describe("note context menu (web)", () => {
  test("right-click opens the menu; Duplicate duplicates", async ({ page }) => {
    await boot(page);
    const before = await page.locator(".av-item").count();
    await page.locator(".av-item").first().click({ button: "right" });
    const menu = page.locator(".ctx-menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Rename…" })).toBeVisible();
    await menu.getByRole("menuitem", { name: "Duplicate" }).click();
    await expect(page.locator(".av-toast")).toContainText("note duplicated");
    await expect(page.locator(".av-item")).toHaveCount(before + 1);
  });

  test("Esc and scrim-click dismiss without running anything", async ({ page }) => {
    await boot(page);
    const before = await page.locator(".av-item").count();
    await page.locator(".av-item").first().click({ button: "right" });
    await expect(page.locator(".ctx-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".ctx-menu")).toHaveCount(0);

    await page.locator(".av-item").first().click({ button: "right" });
    await page.locator(".ctx-scrim").click({ position: { x: 5, y: 5 } });
    await expect(page.locator(".ctx-menu")).toHaveCount(0);
    await expect(page.locator(".av-item")).toHaveCount(before);
  });

  test("Delete routes through the same confirm modal as :rm", async ({ page }) => {
    await boot(page);
    const target = page.locator(".av-item").last();
    const title = await target.locator(".av-item-titletext").innerText();
    const before = await page.locator(".av-item").count();
    await target.click({ button: "right" });
    await page.locator(".ctx-menu").getByRole("menuitem", { name: "Delete" }).click();
    await expect(page.locator(".cfm-title")).toContainText(title);
    await page.locator(".cfm-btn", { hasText: "Delete" }).click();
    await expect(page.locator(".av-toast")).toContainText("note deleted");
    await expect(page.locator(".av-item")).toHaveCount(before - 1);
  });

  test("the ⋯ kebab (hover-revealed) opens the menu; keyboard drives it", async ({ page }) => {
    await boot(page);
    const row = page.locator(".av-item").first();
    await row.hover();
    await row.getByRole("button", { name: "note actions" }).click();
    const menu = page.locator(".ctx-menu");
    await expect(menu).toBeVisible();
    // once open the menu is keyboard-usable: ↓ to Open, Enter runs it
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name: "Open" })).toHaveClass(/is-sel/);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  });

  test("the hover pin button pins and unpins in place", async ({ page }) => {
    await boot(page);
    // pick a row that isn't already pinned (the demo seeds a pinned note)
    const row = page
      .locator(".av-item")
      .filter({ hasNot: page.locator(".av-item-pin") })
      .first();
    const title = await row.locator(".av-item-titletext").innerText();
    await row.hover();
    await row.getByRole("button", { name: "pin note" }).click();
    await expect(page.locator(".av-toast")).toContainText("note pinned");
    const pinned = page.locator(".av-item").filter({ hasText: title });
    await expect(pinned.locator(".av-item-pin")).toBeVisible();

    await pinned.hover();
    await pinned.getByRole("button", { name: "unpin note" }).click();
    await expect(page.locator(".av-toast")).toContainText("note unpinned");
    await expect(
      page.locator(".av-item").filter({ hasText: title }).locator(".av-item-pin"),
    ).toHaveCount(0);
  });

  test("double-clicking a row opens the rename modal", async ({ page }) => {
    await boot(page);
    const row = page.locator(".av-item").first();
    const title = await row.locator(".av-item-titletext").innerText();
    await row.dblclick();
    await expect(page.locator(".cfm-panel .cfm-title")).toContainText("Rename note");
    await expect(page.locator(".cfm-input")).toHaveValue(title);
    await page.keyboard.press("Escape");
    await expect(page.locator(".cfm-panel")).toHaveCount(0);
  });
});
