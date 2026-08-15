import { boot, expect, test } from "./fixtures";

// The WYSIWYG block layer: markdown parses into REAL blocks (tables, task
// lists, KaTeX math, highlighted code, callouts) and edits serialize back to
// markdown through the session — the seeded "Rich blocks" note carries one of
// everything, and the task-toggle test proves the full save/reparse loop.
test.describe("wysiwyg blocks", () => {
  const openRich = async (page: import("@playwright/test").Page) => {
    await page.locator(".av-item").filter({ hasText: "Rich blocks" }).click();
    await expect(page.locator(".av-file")).toContainText("Rich blocks");
  };

  test("the seeded note renders every rich block", async ({ page }) => {
    await boot(page);
    await openRich(page);
    const content = page.locator(".av-cm .tiptap");

    // heading is a real h1
    await expect(content.locator("h1")).toHaveText("Rich blocks");
    // table is a real <table> with header + body cells
    await expect(content.locator("table th").first()).toHaveText("Feature");
    await expect(content.locator("table td").first()).toHaveText("Tables");
    // task list with one checked, one unchecked
    await expect(content.locator('ul[data-type="taskList"] li[data-checked="true"]')).toHaveCount(
      1,
    );
    await expect(content.locator('ul[data-type="taskList"] li[data-checked="false"]')).toHaveCount(
      1,
    );
    // KaTeX rendered both math forms
    await expect(content.locator(".katex").first()).toBeVisible();
    // code block: NodeView chrome (lang label + copy button)
    await expect(content.locator(".av-codeblock .av-code-lang")).toHaveText("ts");
    await expect(content.locator(".av-codeblock .av-code-copy")).toBeVisible();
    // callout renders tinted with its kind, the plain quote stays a blockquote
    await expect(content.locator('.av-callout[data-callout="note"]')).toBeVisible();
    await expect(content.locator("blockquote")).toContainText("plain quote");
    // no raw markup anywhere
    await expect(content).not.toContainText("| Feature |");
    await expect(content).not.toContainText("[!NOTE]");
  });

  test("checkbox clicks round-trip through save and reopen", async ({ page }) => {
    await boot(page);
    await openRich(page);
    const openTask = page.locator('ul[data-type="taskList"] li[data-checked="false"]');
    await expect(openTask).toHaveCount(1);

    await openTask.locator('input[type="checkbox"]').click();
    await expect(page.locator('ul[data-type="taskList"] li[data-checked="true"]')).toHaveCount(2);
    await page.waitForTimeout(1200); // past the autosave debounce

    // Switch away and back — the state must come back from the SAVED markdown.
    await page.locator(".av-item").filter({ hasText: "Welcome" }).click();
    await expect(page.locator(".av-file")).toContainText("Welcome");
    await openRich(page);
    await expect(page.locator('ul[data-type="taskList"] li[data-checked="true"]')).toHaveCount(2);
    await expect(page.locator('ul[data-type="taskList"] li[data-checked="false"]')).toHaveCount(0);
  });

  test("the code copy button copies and confirms", async ({ page, browserName }) => {
    test.skip(browserName === "webkit", "clipboard permissions are chromium-only in Playwright");
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await boot(page);
    await openRich(page);

    // Wait for the lazy ts grammar (its arrival refreshes the code block).
    await expect(page.locator(".av-codeblock .hljs-keyword").first()).toBeVisible();
    await page.locator(".av-code-copy").click();
    await expect(page.locator(".av-code-copy")).toHaveClass(/is-copied/);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain("const answer = compute(42);");
  });

  test("typing markdown shorthand creates real blocks (input rules)", async ({ page }) => {
    await boot(page);
    await page.locator(".av-sidefoot").getByRole("button", { name: "New note" }).click();
    const content = page.locator(".av-cm .tiptap");
    // A fresh note opens as an "# Untitled" h1 — continue on a new line below it.
    await expect(content.locator("h1")).toHaveText("Untitled");
    await content.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");

    await page.keyboard.type("## Section heading");
    await expect(content.locator("h2")).toHaveText("Section heading");
    await page.keyboard.press("Enter");
    await page.keyboard.type("- first bullet");
    await expect(content.locator("ul li").first()).toContainText("first bullet");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter"); // exit the list
    await page.keyboard.type("> a quote");
    await expect(content.locator("blockquote")).toContainText("a quote");
  });
});
