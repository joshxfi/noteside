import { boot, expect, test } from "./fixtures";

// The rendered-markdown layer of live preview (on by default): pipe tables
// collapse into real <table> widgets that reveal back to source when the
// selection touches them, task markers become clickable checkboxes, bullets
// render as •, and fenced code blocks get block styling + a copy button.
test.describe("markdown preview", () => {
  test("pipe tables render as a widget, reveal on entry, and map clicks to cells", async ({
    page,
  }) => {
    await boot(page, { vimMode: false });
    await page.getByRole("button", { name: "New note" }).click();
    const content = page.locator(".cm-content");
    await content.click();

    await page.keyboard.type("| Col A | Col B |\n| --- | --- |\n| alpha | beta |\n");
    // cursor sits on the blank line below — the table is collapsed
    const table = page.locator(".cm-mdtable");
    await expect(table).toBeVisible();
    await expect(table.locator("th").first()).toHaveText("Col A");
    await expect(table.locator("td").nth(1)).toHaveText("beta");
    await expect(content).not.toContainText("| ---");

    // ArrowUp from below steps INTO the collapsed table (keyboard-first entry)
    await page.keyboard.press("ArrowUp");
    await expect(table).toHaveCount(0);
    await expect(content).toContainText("| alpha | beta |");

    // leaving it re-collapses; clicking a cell reveals again
    await page.keyboard.press("ArrowDown");
    await expect(table).toBeVisible();
    await table.locator("td", { hasText: "beta" }).click();
    await expect(page.locator(".cm-mdtable")).toHaveCount(0);
    await expect(content).toContainText("| Col A | Col B |");
  });

  test("vim normal-mode k/j steps into and out of a collapsed table", async ({ page }) => {
    await boot(page, { vimMode: true });
    await page.getByRole("button", { name: "New note" }).click();
    const content = page.locator(".cm-content");
    await content.click();

    await page.keyboard.press("i");
    await page.keyboard.type("| a | b |\n| --- | --- |\n| 1 | 2 |\n");
    await page.keyboard.press("Escape");
    // normal mode on the blank line below — collapsed
    const table = page.locator(".cm-mdtable");
    await expect(table).toBeVisible();

    // vim k moves by logical line, landing inside the hidden range → reveal
    await page.keyboard.press("k");
    await expect(table).toHaveCount(0);
    await expect(content).toContainText("| 1 | 2 |");

    // j back out re-collapses
    await page.keyboard.press("j");
    await expect(page.locator(".cm-mdtable")).toBeVisible();
  });

  test("task checkboxes toggle the source, bullets and rules render", async ({ page }) => {
    await boot(page, { vimMode: false });
    await page.getByRole("button", { name: "New note" }).click();
    const content = page.locator(".cm-content");
    await content.click();

    await page.keyboard.type("- [ ] buy milk\n- plain bullet\n\n---\n");
    const box = page.locator(".cm-task-box");
    await expect(box).toBeVisible();
    await expect(box).not.toBeChecked();
    // an unchecked task must NOT carry the done (struck-through) line style
    await expect(page.locator(".cm-task-done")).toHaveCount(0);
    await expect(page.locator(".cm-list-bullet")).toHaveText("•");
    await expect(page.locator(".cm-hr")).toBeVisible();

    // clicking the checkbox rewrites `[ ]` → `[x]` without moving the cursor
    await box.click();
    await expect(page.locator(".cm-task-box")).toBeChecked();
    await expect(page.locator(".cm-task-done")).toHaveCount(1);
  });

  test("fenced code blocks style their lines, badge the language, and copy", async ({
    page,
    browserName,
  }) => {
    await boot(page, { vimMode: false });
    await page.getByRole("button", { name: "New note" }).click();
    const content = page.locator(".cm-content");
    await content.click();

    await page.keyboard.type("```js\nconst x = 1\n```\ndone");
    await expect(page.locator(".cm-codeblock")).toHaveCount(3);
    await expect(page.locator(".cm-codeblock-first .cm-code-lang")).toHaveText("js");
    // the ``` fence marks are hidden off the cursor line
    await expect(content).not.toContainText("```");

    const copy = page.locator(".cm-code-copy");
    await expect(copy).toBeVisible();
    // headless webkit denies clipboard-write; the chromium run covers the copy path
    if (browserName === "chromium") {
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await copy.click();
      await expect(copy).toHaveText("copied");
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("const x = 1");
    }
  });
});
