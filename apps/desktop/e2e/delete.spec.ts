import { boot, expect, test } from "./fixtures";

test.describe("delete note", () => {
  test(":rm deletes the active note, confirms, and opens another", async ({ page }) => {
    await boot(page, { vimMode: true });
    await page.locator(".cm-content").click();

    const activeTitle = await page.locator(".av-item.is-active .av-item-titletext").innerText();
    const before = await page.locator(".av-item").count();
    expect(before).toBeGreaterThan(1); // the demo seeds several notes

    // Delete via the :rm ex-command (→ the "delete" command → deleteActive).
    await page.keyboard.press(":");
    await page.keyboard.type("rm");
    await page.keyboard.press("Enter");

    // The toast confirms, the row is gone, the sidebar shrank by one, and a
    // different note is now active.
    await expect(page.locator(".av-toast")).toContainText("note deleted");
    await expect(page.locator(".av-item").filter({ hasText: activeTitle })).toHaveCount(0);
    await expect(page.locator(".av-item")).toHaveCount(before - 1);
    await expect(page.locator(".av-item.is-active")).not.toContainText(activeTitle);
  });
});

test.describe("note context menu", () => {
  test("right-click → Delete removes the active note (with a confirm step)", async ({ page }) => {
    await boot(page);
    const activeTitle = await page.locator(".av-item.is-active .av-item-titletext").innerText();
    const before = await page.locator(".av-item").count();
    expect(before).toBeGreaterThan(1);

    // Right-click suppresses the native WebView menu and opens ours at the cursor.
    await page.locator(".av-item.is-active").click({ button: "right" });
    await expect(page.locator(".ctx-menu")).toBeVisible();

    // Delete is a two-step confirm (deletes are permanent — no trash).
    await page.locator(".ctx-item.danger").click();
    await expect(page.locator(".ctx-confirm")).toBeVisible();
    await page.locator(".ctx-btn.danger").click();

    await expect(page.locator(".av-toast")).toContainText("note deleted");
    await expect(page.locator(".av-item").filter({ hasText: activeTitle })).toHaveCount(0);
    await expect(page.locator(".av-item")).toHaveCount(before - 1);
    await expect(page.locator(".ctx-menu")).toHaveCount(0); // closed after the action
  });

  test("right-click → Delete removes a non-active note, active buffer stays", async ({ page }) => {
    await boot(page);
    const activeTitle = await page.locator(".av-item.is-active .av-item-titletext").innerText();
    const before = await page.locator(".av-item").count();

    const target = page.locator(".av-item:not(.is-active)").first();
    const targetTitle = await target.locator(".av-item-titletext").innerText();
    await target.click({ button: "right" });
    await expect(page.locator(".ctx-title")).toHaveText(targetTitle);

    await page.locator(".ctx-item.danger").click();
    await page.locator(".ctx-btn.danger").click();

    await expect(page.locator(".av-item").filter({ hasText: targetTitle })).toHaveCount(0);
    await expect(page.locator(".av-item")).toHaveCount(before - 1);
    // Deleting an inactive note must not switch the open buffer.
    await expect(page.locator(".av-item.is-active .av-item-titletext")).toHaveText(activeTitle);
  });

  test("Escape and outside-click both dismiss the menu without deleting", async ({ page }) => {
    await boot(page);
    const before = await page.locator(".av-item").count();

    await page.locator(".av-item.is-active").click({ button: "right" });
    await expect(page.locator(".ctx-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".ctx-menu")).toHaveCount(0);

    // Confirm-step Escape steps back to the menu, not straight out.
    await page.locator(".av-item.is-active").click({ button: "right" });
    await page.locator(".ctx-item.danger").click();
    await expect(page.locator(".ctx-confirm")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".ctx-confirm")).toHaveCount(0);
    await expect(page.locator(".ctx-menu")).toBeVisible();

    // An outside click closes it (the brand header sits above the menu).
    await page.locator(".av-brand").click();
    await expect(page.locator(".ctx-menu")).toHaveCount(0);
    await expect(page.locator(".av-item")).toHaveCount(before); // nothing deleted
  });
});
