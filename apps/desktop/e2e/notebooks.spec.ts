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

  test("New notebook… creates and opens an empty notebook", async ({ page }) => {
    await boot(page);
    await page.locator('button[aria-label="switch notebook"]').click();
    await page.locator(".nb-list .fnd-row").filter({ hasText: "New notebook" }).click();

    // create mode: name field + a location line
    await expect(page.locator(".nb-create")).toBeVisible();
    await page.locator(".fnd-input").fill("My Fresh Notebook");
    await page.keyboard.press("Enter");

    await expect(page.locator(".nb-panel")).toHaveCount(0);
    await expect(page.locator(".av-item")).toHaveCount(0); // brand-new notebook is empty

    // reopening the switcher shows it as the current notebook
    await page.locator('button[aria-label="switch notebook"]').click();
    await expect(page.locator(".fnd-row").filter({ hasText: "My Fresh Notebook" })).toContainText(
      "current",
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

  // Pins the switch-flow invariant: a pending edit must flush into the ORIGIN
  // notebook before the index swaps. Reorder/drop the flush in switchNotebook and
  // the marker would land in the new notebook (or be lost) → this fails.
  test("a pending edit persists to the origin notebook across a switch", async ({ page }) => {
    await boot(page); // opens /demo-notebook, first note = Welcome
    await page.locator(".cm-content").click();
    await page.keyboard.type("\nSWITCH_MARKER_42");

    // switch to the journal, then back — without waiting out the autosave debounce
    await page.locator('button[aria-label="switch notebook"]').click();
    await page.locator(".nb-list .fnd-row").filter({ hasText: "demo-journal" }).click();
    await expect(page.locator(".av-item").filter({ hasText: "Monday" })).toHaveCount(1);
    await page.locator('button[aria-label="switch notebook"]').click();
    await page.locator(".nb-list .fnd-row").filter({ hasText: "demo-notebook" }).click();

    // back in the origin notebook: the just-saved note is the freshest, so it
    // reopens — the marker survived the switch, proving switchNotebook flushed into
    // the ORIGIN notebook before the index swapped. (A save re-derives the title
    // from the first body line, so we assert on the editor, not the sidebar row.)
    await expect(page.locator(".cm-content")).toContainText("SWITCH_MARKER_42");
  });
});
