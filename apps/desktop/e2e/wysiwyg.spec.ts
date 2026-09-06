import { caretToEnd, boot, expect, test } from "./fixtures";

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

  // REGRESSION: the app's Tab extension shadowed the table's — Tab inside a
  // cell inserted spaces instead of navigating, and tables could never grow.
  test("Tab navigates table cells and grows a new row past the last one", async ({ page }) => {
    await boot(page);
    await page.locator(".av-sidefoot").getByRole("button", { name: "New note" }).click();
    await caretToEnd(page);
    await page.keyboard.press("Enter");
    await page.keyboard.type("/table");
    await page.keyboard.press("Enter"); // slash menu → 3×3 with a header row
    const rows = page.locator(".av-cm .tiptap table tr");
    await expect(rows).toHaveCount(3);

    // caret lands in the first cell; label the header, Tab to the next cell
    await page.keyboard.type("A1");
    await page.keyboard.press("Tab");
    await page.keyboard.type("B1");
    await expect(page.locator(".av-cm .tiptap table th").nth(0)).toHaveText("A1");
    await expect(page.locator(".av-cm .tiptap table th").nth(1)).toHaveText("B1");
    // Shift-Tab goes back without editing
    await page.keyboard.press("Shift+Tab");
    await expect(rows).toHaveCount(3);

    // From A1: 8 hops land ON the last cell; the 9th Tab goes PAST it and
    // appends a fresh row.
    for (let i = 0; i < 9; i++) await page.keyboard.press("Tab");
    await expect(rows).toHaveCount(4);
    // ...and the caret is IN the new row: typing lands there
    await page.keyboard.type("new row");
    await expect(rows.nth(3)).toContainText("new row");
  });

  test("Tab nests a list item that can nest and is a no-op on one that can't", async ({ page }) => {
    await boot(page);
    await page.locator(".av-sidefoot").getByRole("button", { name: "New note" }).click();
    await caretToEnd(page);
    await page.keyboard.press("Enter");
    await page.keyboard.type("- alpha");
    await page.keyboard.press("Tab"); // the first item has nothing to nest under
    await expect(page.locator(".av-cm .tiptap li").first()).toHaveText("alpha"); // no stray spaces
    await page.keyboard.press("Enter");
    await page.keyboard.type("beta");
    await page.keyboard.press("Tab");
    await expect(page.locator(".av-cm .tiptap li li")).toHaveText("beta");
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator(".av-cm .tiptap li li")).toHaveCount(0);
  });

  // Table structure ops: the floating toolbar is the pointer path, the
  // searchable palette the keyboard path — both dispatch the SAME commands.
  test("the table toolbar and palette add/remove rows and columns", async ({ page }) => {
    await boot(page);
    await page.locator(".av-sidefoot").getByRole("button", { name: "New note" }).click();
    await caretToEnd(page);
    await page.keyboard.press("Enter");
    await page.keyboard.type("/table");
    await page.keyboard.press("Enter");

    const rows = page.locator(".av-cm .tiptap table tr");
    const headerCells = page.locator(".av-cm .tiptap table tr").first().locator("th,td");
    const bar = page.locator(".av-tablebar");

    // toolbar appears while the caret is in the table
    await expect(bar).toBeVisible();

    // pointer path: buttons
    await bar.getByRole("button", { name: "+ col" }).click();
    await expect(headerCells).toHaveCount(4);
    await bar.getByRole("button", { name: "− col" }).click();
    await expect(headerCells).toHaveCount(3);
    await bar.getByRole("button", { name: "+ row" }).click();
    await expect(rows).toHaveCount(4);
    await bar.getByRole("button", { name: "− row" }).click();
    await expect(rows).toHaveCount(3);

    // keyboard path: the palette runs the same command on the same selection
    await page.keyboard.press("ControlOrMeta+Shift+p");
    await page.keyboard.type("add column");
    await page.keyboard.press("Enter");
    await expect(headerCells).toHaveCount(4);

    // caret leaves the table → toolbar hides
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ArrowRight");
    await expect(bar).toBeHidden();
  });

  test("typing markdown shorthand creates real blocks (input rules)", async ({ page }) => {
    await boot(page);
    await page.locator(".av-sidefoot").getByRole("button", { name: "New note" }).click();
    const content = page.locator(".av-cm .tiptap");
    // A fresh note opens as an "# Untitled" h1 — continue on a new line below it.
    await expect(content.locator("h1")).toHaveText("Untitled");
    await caretToEnd(page);
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
