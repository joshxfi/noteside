import { boot, expect, test } from "./fixtures";

// Pointer-parity coverage (the 2026-08 reposition): every keyboard flow needs a
// mouse twin. These drive the new pointer affordances — titlebar buttons, scrim
// and × dismissal, hover-moves-selection, click-commit, status-bar actions,
// clickable empty state, toast dismissal, and plain-click table links.
test.describe("pointer ergonomics", () => {
  test("titlebar: commands button opens the searchable palette; scrim-click dismisses", async ({
    page,
  }) => {
    await boot(page);
    await page.locator(".av-titlebar").getByRole("button", { name: "commands" }).click();
    await expect(page.locator(".fnd-promptchar")).toContainText("cmd");
    // click the scrim edge (outside the panel) — the overlay dismisses
    await page.locator(".fnd-scrim").click({ position: { x: 5, y: 5 } });
    await expect(page.locator(".fnd-promptchar")).toHaveCount(0);
  });

  test("titlebar: + creates a note", async ({ page }) => {
    await boot(page);
    const before = await page.locator(".av-item").count();
    await page.locator(".av-titlebar").getByRole("button", { name: "new note" }).click();
    await expect(page.locator(".av-item")).toHaveCount(before + 1);
    await expect(page.locator(".av-item.is-active")).toContainText("Untitled");
  });

  test("finder: × closes, hover moves the selection, click opens", async ({ page }) => {
    await boot(page);
    await page.locator(".av-titlebar").getByRole("button", { name: "search" }).click();
    await expect(page.locator(".fnd-list .fnd-row").first()).toBeVisible();
    await page.locator(".fnd-x").click();
    await expect(page.locator(".fnd-list")).toHaveCount(0);

    await page.locator(".av-titlebar").getByRole("button", { name: "search" }).click();
    const rows = page.locator(".fnd-list .fnd-row");
    await rows.nth(2).hover();
    await expect(rows.nth(2)).toHaveClass(/is-sel/);
    const title = await rows.nth(2).locator(".fnd-name").innerText();
    await rows.nth(2).click();
    await expect(page.locator(".fnd-list")).toHaveCount(0);
    await expect(page.locator(".av-file")).toContainText(title);
  });

  test("status bar: the eye toggles live preview; clicking the toast dismisses it", async ({
    page,
  }) => {
    await boot(page);
    await page.getByRole("button", { name: "toggle live preview" }).click();
    const toast = page.locator(".av-toast");
    await expect(toast).toContainText("live preview off");
    await toast.click();
    await expect(toast).toHaveCount(0);
    // toggle back on for good measure
    await page.getByRole("button", { name: "toggle live preview" }).click();
    await expect(page.locator(".av-toast")).toContainText("live preview on");
  });

  test("status bar: the [+] dirty chip is click-to-save", async ({ page }) => {
    await boot(page);
    await page.locator(".cm-content").click();
    await page.keyboard.type("dirty me");
    const dirty = page.locator(".av-dirty");
    await expect(dirty).toBeVisible();
    await dirty.click();
    await expect(dirty).toHaveCount(0);
  });

  test("empty state offers clickable actions", async ({ page }) => {
    await boot(page, { vimMode: true });
    await page.locator(".cm-content").click();
    await page.keyboard.press(":");
    await page.keyboard.type("q");
    await page.keyboard.press("Enter");
    await expect(page.locator(".av-empty-title")).toContainText("No note open");

    // Find a note → the finder opens (Esc backs out)
    await page.locator(".av-empty").getByRole("button", { name: "Find a note" }).click();
    await expect(page.locator(".fnd-list")).toBeVisible();
    await page.keyboard.press("Escape");

    // All commands → the searchable palette (scrim-click backs out)
    await page.locator(".av-empty").getByRole("button", { name: "All commands" }).click();
    await expect(page.locator(".fnd-promptchar")).toContainText("cmd");
    await page.locator(".fnd-scrim").click({ position: { x: 5, y: 5 } });

    // New note → a fresh buffer opens
    await page.locator(".av-empty").getByRole("button", { name: "New note" }).click();
    await expect(page.locator(".av-file")).toContainText("Untitled");
  });

  test("palette danger confirms are clickable (No backs out, Yes proceeds)", async ({ page }) => {
    await boot(page);
    const before = await page.locator(".av-item").count();
    await page.locator(".av-titlebar").getByRole("button", { name: "commands" }).click();
    await page.keyboard.type("delete");
    await page.keyboard.press("Enter"); // danger → in-palette confirm
    await page.locator(".cfm-btn", { hasText: "No" }).click();
    await expect(page.locator(".fnd-row").first()).toBeVisible(); // back to the list

    await page.keyboard.press("Enter");
    await page.locator(".cfm-btn", { hasText: "Yes" }).click();
    // the command routes to the app's confirm modal — cancel there
    await expect(page.locator(".cfm-panel")).toBeVisible();
    await page.locator(".cfm-btn", { hasText: "Cancel" }).click();
    await expect(page.locator(".av-item")).toHaveCount(before); // nothing deleted
  });

  test("a link inside a rendered table follows on plain click", async ({ page }) => {
    await boot(page, { vimMode: false });
    // outside Tauri, open-external falls back to window.open — stub it
    await page.evaluate(() => {
      (window as unknown as { __opened: string | null }).__opened = null;
      window.open = ((url: string) => {
        (window as unknown as { __opened: string | null }).__opened = String(url);
        return window; // a non-null return marks success to open-external
      }) as typeof window.open;
    });
    await page.locator(".av-sidefoot").getByRole("button", { name: "New note" }).click();
    await page.locator(".cm-content").click();
    await page.keyboard.type("| link |\n| --- |\n| [site](https://example.com/x) |\n");

    const link = page.locator(".cm-mdtable .cm-mdlink");
    await expect(link).toBeVisible();
    await link.click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __opened: string | null }).__opened))
      .toBe("https://example.com/x");
    // the click followed the link instead of revealing the table for editing
    await expect(page.locator(".cm-mdtable")).toBeVisible();
  });
});
