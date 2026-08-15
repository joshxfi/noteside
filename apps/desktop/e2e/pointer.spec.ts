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

  test("clicking a toast dismisses it", async ({ page }) => {
    await boot(page);
    // run any toast-producing command (pin) via the command search
    await page.keyboard.press("ControlOrMeta+Shift+p");
    await page.keyboard.type("pin note");
    await page.keyboard.press("Enter");
    const toast = page.locator(".av-toast");
    await expect(toast).toContainText("note pinned");
    await toast.click();
    await expect(toast).toHaveCount(0);
  });

  test("status bar: the [+] dirty chip is click-to-save", async ({ page }) => {
    await boot(page);
    await page.locator(".av-cm .tiptap").click();
    await page.keyboard.type("dirty me");
    const dirty = page.locator(".av-dirty");
    await expect(dirty).toBeVisible();
    await dirty.click();
    await expect(dirty).toHaveCount(0);
  });

  test("empty state offers clickable actions", async ({ page }) => {
    await boot(page);
    await page.locator(".av-cm .tiptap").click();
    await page.keyboard.press("ControlOrMeta+w");
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

  test("sidebar rows are keyboard-activatable (focus + Enter)", async ({ page }) => {
    await boot(page);
    // Direct focus (portable across Safari's "Tab skips buttons" OS setting) —
    // the row div carries tabIndex=0 + Enter/Space activation like the old <button>.
    const target = page.locator(".av-item").nth(2);
    const title = await target.locator(".av-item-titletext").innerText();
    await target.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".av-file")).toContainText(title);
  });

  test("the notebook create form has a clickable submit", async ({ page }) => {
    await boot(page);
    await page.locator(".av-titlebar").getByRole("button", { name: "switch notebook" }).click();
    await page.locator(".nb-list .fnd-row").filter({ hasText: "New notebook" }).click();
    const create = page.locator(".nb-createactions .cfm-btn");
    await expect(create).toBeDisabled(); // no name typed yet
    await page.keyboard.type("Clicked Notebook");
    await expect(create).toBeEnabled();
    await create.click();
    await expect(page.locator(".av-item")).toHaveCount(0); // brand-new notebook is empty
  });

  test("a link inside a table follows on Mod-click; plain click edits", async ({ page }) => {
    await boot(page);
    // outside Tauri, open-external falls back to window.open — stub it
    await page.evaluate(() => {
      (window as unknown as { __opened: string | null }).__opened = null;
      window.open = ((url: string) => {
        (window as unknown as { __opened: string | null }).__opened = String(url);
        return window; // a non-null return marks success to open-external
      }) as typeof window.open;
    });
    await page.locator(".av-item").filter({ hasText: "Rich blocks" }).click();
    const link = page.locator(".av-cm .tiptap table a", { hasText: "Docs" });
    await expect(link).toBeVisible();

    // plain click places the caret (tables are editable now) — nothing opens
    await link.click();
    expect(
      await page.evaluate(() => (window as unknown as { __opened: string | null }).__opened),
    ).toBe(null);

    // Mod-click follows — the honest affordance everywhere in the editor
    await link.click({ modifiers: ["ControlOrMeta"] });
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __opened: string | null }).__opened))
      .toBe("https://noteside.app");
  });
});
