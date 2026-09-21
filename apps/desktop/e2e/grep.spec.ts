import { boot, expect, test } from "./fixtures";

test.describe("content search", () => {
  test("greps note bodies and opens a hit", async ({ page }) => {
    await boot(page, { vimMode: false });
    await page.locator(".av-cm .tiptap").click();

    // Open the finder with Mod-p and switch to the content tab, rather than the
    // Mod-Shift-f chord (which collides with CodeMirror's in-note search on Linux).
    await page.keyboard.press("ControlOrMeta+p");
    await page.locator(".fnd-panel").waitFor();
    await page
      .locator(".fnd-tab")
      .filter({ hasText: /content/i })
      .click();

    // "bluffed" appears only in the Thursday note's body.
    await page.locator(".fnd-input").fill("bluffed");
    await expect(page.locator(".fnd-grepline").first()).toContainText(/bluffed/i);

    // Click the hit (deterministic) rather than relying on Enter/selection.
    await page.locator(".fnd-row").first().click();
    await expect(page.locator(".fnd-panel")).toBeHidden();
    await expect(page.locator(".av-file")).toContainText("Thursday");
    // gotoLine maps the hit's source line onto its block — the caret (and so
    // the active-block highlight) must land on the paragraph with the match.
    await expect(page.locator(".av-active-block")).toContainText("bluffed");
  });

  test("a term in two notes gives two hits; opening the second lands on its block", async ({
    page,
  }) => {
    await boot(page, { vimMode: false });
    await page.locator(".av-cm .tiptap").click();

    await page.keyboard.press("ControlOrMeta+p");
    await page.locator(".fnd-panel").waitFor();
    await page
      .locator(".fnd-tab")
      .filter({ hasText: /content/i })
      .click();

    // "fig tree" sits in a LATER paragraph of both journal notes, and the
    // recipe's "figs, quartered" doesn't contain the phrase — so exactly two
    // hits, neither of them on its note's first line.
    await page.locator(".fnd-input").fill("fig tree");
    const rows = page.locator(".fnd-row");
    await expect(rows).toHaveCount(2);

    // Read which note the SECOND hit belongs to from its "title:line" label, so
    // the assertion doesn't bake in the ranking order.
    const loc = await rows.nth(1).locator(".fnd-loc").innerText();
    const noteTitle = loc.slice(0, loc.lastIndexOf(":"));

    await rows.nth(1).click();
    await expect(page.locator(".fnd-panel")).toBeHidden();
    await expect(page.locator(".av-file")).toContainText(noteTitle);
    await expect(page.locator(".av-active-block")).toContainText("fig tree");
  });
});
