import { boot, expect, test } from "./fixtures";

// The sidebar's drag handle (Config.sidebarWidth). The live drag writes the
// --sidebar-w CSS var imperatively; pointer-up commits the width into config.
test.describe("sidebar resize", () => {
  test("dragging the handle resizes; double-click resets", async ({ page }) => {
    await boot(page);
    const sidebar = page.locator(".av-sidebar");
    const before = (await sidebar.boundingBox())!.width;

    const handle = page.locator(".av-sidebar-resize");
    const hb = (await handle.boundingBox())!;
    await page.mouse.move(hb.x + 2, hb.y + 200);
    await page.mouse.down();
    await page.mouse.move(hb.x + 102, hb.y + 200, { steps: 4 });
    await page.mouse.up();
    await expect
      .poll(async () => (await sidebar.boundingBox())!.width)
      .toBeGreaterThan(before + 90);

    // double-click the handle → back to the default width (animated)
    await page.locator(".av-sidebar-resize").dblclick();
    await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeLessThan(before + 10);
  });

  test("the drag clamps to the maximum width", async ({ page }) => {
    await boot(page);
    const sidebar = page.locator(".av-sidebar");
    const handle = page.locator(".av-sidebar-resize");
    const hb = (await handle.boundingBox())!;
    await page.mouse.move(hb.x + 2, hb.y + 200);
    await page.mouse.down();
    await page.mouse.move(hb.x + 900, hb.y + 200, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeLessThanOrEqual(421);
  });
});
