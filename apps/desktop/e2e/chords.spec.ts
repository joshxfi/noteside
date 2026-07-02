import { boot, expect, test } from "./fixtures";

// ControlOrMeta maps to Cmd on macOS and Ctrl elsewhere — matching the app's
// `Mod-` chords (Cmd on mac / Ctrl on Linux CI).
test.describe("keyboard chords", () => {
  test("Mod-p opens the finder and Mod-b toggles the sidebar", async ({ page }) => {
    await boot(page, { vimMode: false });
    await page.locator(".cm-content").click();

    await page.keyboard.press("ControlOrMeta+p");
    await expect(page.locator(".fnd-panel")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".fnd-panel")).toBeHidden();

    const sidebar = page.locator(".av-sidebar");
    await expect(sidebar).not.toHaveClass(/is-collapsed/);
    await page.locator(".cm-content").click();
    await page.keyboard.press("ControlOrMeta+b");
    await expect(sidebar).toHaveClass(/is-collapsed/);
  });

  test("Mod± zooms the editor font and Mod-Shift± the interface", async ({ page }) => {
    await boot(page, { vimMode: false });
    await page.locator(".cm-content").click();

    const cssVar = (name: string) =>
      page.evaluate((n) => document.documentElement.style.getPropertyValue(n).trim(), name);

    expect(await cssVar("--editor-size")).toBe("19px");
    await page.keyboard.press("ControlOrMeta+=");
    await expect.poll(() => cssVar("--editor-size")).toBe("20px");
    await page.keyboard.press("ControlOrMeta+-");
    await expect.poll(() => cssVar("--editor-size")).toBe("19px");

    // The shifted pair drives the UI scale, leaving the editor size alone.
    // Press the shifted GLYPHS ("+", "_") — that's what real layouts deliver
    // for Mod-Shift-=/-; Playwright's "Shift+=" syntax synthesizes an
    // untransformed "=" with Shift held (an as-if-CapsLock artifact no real
    // keyboard produces), which CM routes to the unshifted binding instead.
    await page.keyboard.down("ControlOrMeta");
    await page.keyboard.press("+");
    await page.keyboard.up("ControlOrMeta");
    await expect.poll(() => cssVar("--ui-scale")).toBe("1.05");
    expect(await cssVar("--editor-size")).toBe("19px");
    await page.keyboard.down("ControlOrMeta");
    await page.keyboard.press("_");
    await page.keyboard.up("ControlOrMeta");
    await expect.poll(() => cssVar("--ui-scale")).toBe("1");

    // Mod-0 resets the editor font
    await page.keyboard.press("ControlOrMeta+=");
    await page.keyboard.press("ControlOrMeta+=");
    await expect.poll(() => cssVar("--editor-size")).toBe("21px");
    await page.keyboard.press("ControlOrMeta+0");
    await expect.poll(() => cssVar("--editor-size")).toBe("19px");
  });
});
