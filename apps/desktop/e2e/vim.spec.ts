import { boot, expect, test } from "./fixtures";

// The hand-built vim subset (src/editor/vim/): modal navigation +
// line-editing over the block editor. The pure machine is unit-tested
// exhaustively; these cover the DOM-coupled seams — mode display, real
// selections/edits, the ex bar, escMap, and the Tab focus-trap.
test.describe("vim mode", () => {
  const bootVim = async (page: import("@playwright/test").Page) => {
    await boot(page, { vimMode: true });
    // clicking centers the caret somewhere mid-doc — normalize to the top
    await page.locator(".av-cm .tiptap").click();
    await page.keyboard.press("g");
    await page.keyboard.press("g");
  };
  const mode = (page: import("@playwright/test").Page) => page.locator(".av-mode");
  const stat = (page: import("@playwright/test").Page) => page.locator(".av-stat").nth(1); // block:offset cell
  const lastBlock = (page: import("@playwright/test").Page) =>
    page.locator(".av-cm .tiptap > *").last();
  /** Append a fresh paragraph holding `text` at the end of the note and come
   *  back to normal mode with the cursor on its first character. */
  const freshLine = async (page: import("@playwright/test").Page, text: string) => {
    await page.keyboard.press("G");
    await page.keyboard.press("A");
    await page.keyboard.press("Enter");
    await page.keyboard.type(text);
    await page.keyboard.press("Escape");
    await page.keyboard.press("0");
    await expect(lastBlock(page)).toHaveText(text);
  };

  test("modes: i enters insert, Esc returns to normal, v enters visual", async ({ page }) => {
    await bootVim(page);
    await expect(mode(page)).toHaveText("NORMAL");
    await page.keyboard.press("i");
    await expect(mode(page)).toHaveText("INSERT");
    await page.keyboard.press("Escape");
    await expect(mode(page)).toHaveText("NORMAL");
    await page.keyboard.press("v");
    await expect(mode(page)).toHaveText("VISUAL");
    await page.keyboard.press("Escape");
    await expect(mode(page)).toHaveText("NORMAL");
  });

  test("typing in normal mode edits nothing", async ({ page }) => {
    await bootVim(page);
    await page.keyboard.type("qqzzmm");
    await expect(page.locator(".av-cm .tiptap")).not.toContainText("qq");
    await expect(page.locator(".av-dirty")).toHaveCount(0);
  });

  test("j moves a visual line; { } hop blocks with counts; gg/G/N-G jump", async ({ page }) => {
    await bootVim(page);
    await expect(stat(page)).toHaveText("1:1");
    // j is VISUAL-vertical: inside a wrapped paragraph it moves within the block
    await page.keyboard.press("j");
    await expect(stat(page)).not.toHaveText("1:1");
    await page.keyboard.press("g");
    await page.keyboard.press("g");
    await expect(stat(page)).toHaveText("1:1");
    // { } are LOGICAL block hops and take counts
    await page.keyboard.press("}");
    await expect(stat(page)).toContainText("2:");
    await page.keyboard.press("2");
    await page.keyboard.press("}");
    await expect(stat(page)).toContainText("4:");
    await page.keyboard.press("{");
    await expect(stat(page)).toContainText("3:");
    await page.keyboard.press("G");
    await expect(stat(page)).not.toHaveText("1:1");
    await page.keyboard.press("3");
    await page.keyboard.press("G");
    await expect(stat(page)).toContainText("3:");
    await page.keyboard.press("g");
    await page.keyboard.press("g");
    await expect(stat(page)).toHaveText("1:1");
  });

  // REGRESSION: a k-probe from an empty block lands in the leading BETWEEN
  // blocks; the boundary position snapped forward (down) again, so k from an
  // empty trailing line went nowhere. j back down must also work.
  test("j/k work from an empty trailing line", async ({ page }) => {
    await bootVim(page);
    await page.keyboard.press("G");
    await page.keyboard.press("A");
    await page.keyboard.press("Enter"); // open an empty block at the very bottom
    await page.keyboard.press("Escape");
    const emptyLine = await stat(page).innerText();
    const emptyBlock = Number(emptyLine.split(":")[0]);

    await page.keyboard.press("k");
    await expect(stat(page)).toHaveText(new RegExp(`^${emptyBlock - 1}:`));
    await page.keyboard.press("j");
    await expect(stat(page)).toHaveText(new RegExp(`^${emptyBlock}:`));
  });

  // REGRESSION (WebKit): probing below a table's last row returns the TABLE's
  // own position; snapped forward, it re-entered row 1 — j cycled inside the
  // table forever. The probe now rejects "advances" against the motion.
  test("j traverses down through a table and out; k comes back up", async ({ page }) => {
    await boot(page, { vimMode: true });
    await page.locator(".av-item").filter({ hasText: "Rich blocks" }).click();
    await page.locator(".av-cm .tiptap table").waitFor();
    await page.locator(".av-cm .tiptap").click();
    await page.keyboard.press("Escape");
    await page.keyboard.press(":");
    await page.locator(".av-exbar-input").fill("3"); // the table block
    await page.keyboard.press("Enter");
    await expect(stat(page)).toHaveText(/^3:/);

    for (let i = 0; i < 8; i++) await page.keyboard.press("j");
    await expect(stat(page)).not.toHaveText(/^3:/); // out the bottom, not cycling

    for (let i = 0; i < 14; i++) await page.keyboard.press("k");
    await expect(stat(page)).toHaveText(/^1:/); // back up through it to the top
  });

  test("dd deletes a block into the register; p pastes it back below", async ({ page }) => {
    await bootVim(page);
    const blocks = page.locator(".av-cm .tiptap > *");
    const before = await blocks.count();
    const firstText = await blocks.first().innerText();

    await page.keyboard.press("d");
    await page.keyboard.press("d");
    await expect(blocks).toHaveCount(before - 1);
    await expect(blocks.first()).not.toHaveText(firstText);

    await page.keyboard.press("p");
    await expect(blocks).toHaveCount(before);
    // pasted AFTER the (new) first block
    await expect(blocks.nth(1)).toHaveText(firstText);
  });

  test("yy + p duplicate a block; x deletes a character", async ({ page }) => {
    await bootVim(page);
    const blocks = page.locator(".av-cm .tiptap > *");
    const before = await blocks.count();
    const firstText = await blocks.first().innerText();

    await page.keyboard.press("y");
    await page.keyboard.press("y");
    await page.keyboard.press("p");
    await expect(blocks).toHaveCount(before + 1);
    await expect(blocks.nth(1)).toHaveText(firstText);

    // x eats the first character of the pasted copy
    await page.keyboard.press("x");
    await expect(blocks.nth(1)).toHaveText(firstText.slice(1));
  });

  test("o on a list item opens a SIBLING item", async ({ page }) => {
    await bootVim(page);
    await page.keyboard.press("G");
    await page.keyboard.press("A"); // insert at the end of the last block
    await page.keyboard.press("Enter");
    await page.keyboard.type("- item one");
    await page.keyboard.press("Escape");

    const items = page.locator(".av-cm .tiptap ul li");
    await expect(items).toHaveCount(1);
    await page.keyboard.press("o");
    await expect(mode(page)).toHaveText("INSERT");
    await page.keyboard.type("item two");
    await expect(items).toHaveCount(2);
    await expect(items.nth(1)).toContainText("item two");
  });

  test("escMap jk exits insert leaving no stray j", async ({ page }) => {
    await boot(page, { vimMode: true, escMap: "jk" });
    await page.locator(".av-cm .tiptap").click();
    await page.keyboard.press("i");
    await page.keyboard.type("hello");
    await page.keyboard.type("jk");
    await expect(mode(page)).toHaveText("NORMAL");
    await expect(page.locator(".av-cm .tiptap")).toContainText("hello");
    await expect(page.locator(".av-cm .tiptap")).not.toContainText("helloj");
  });

  test("f seeks to a character and ; repeats", async ({ page }) => {
    await bootVim(page);
    await page.keyboard.press("G");
    await page.keyboard.press("A"); // insert at the end of the last block
    await page.keyboard.press("Enter");
    await page.keyboard.type("axbxc");
    await page.keyboard.press("Escape");
    await page.keyboard.press("0");
    await expect(stat(page)).toHaveText(/:1$/);
    await page.keyboard.press("f");
    await page.keyboard.press("x");
    await expect(stat(page)).toHaveText(/:2$/);
    await page.keyboard.press(";");
    await expect(stat(page)).toHaveText(/:4$/);
  });

  test("Space opens the leader palette from normal mode", async ({ page }) => {
    await bootVim(page);
    await page.keyboard.press(" ");
    await expect(page.locator(".pal-panel")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".pal-panel")).toHaveCount(0);
  });

  test(":wq via the ex bar saves and closes the note", async ({ page }) => {
    await bootVim(page);
    await page.keyboard.press("i");
    await page.keyboard.type("EX_SAVE_SENTINEL ");
    await page.keyboard.press("Escape");
    await page.keyboard.press(":");
    const ex = page.locator(".av-exbar-input");
    await expect(ex).toBeFocused();
    await ex.fill("wq");
    await page.keyboard.press("Enter");
    await expect(page.locator(".av-empty-title")).toContainText("No note open");

    // reopen: the save landed (the note that was open is a root note — the
    // folder groups render first, so pick it by section, not by "first row")
    await page.locator('.av-item[data-dir=""]').first().click();
    await expect(page.locator(".av-cm .tiptap")).toContainText("EX_SAVE_SENTINEL");
  });

  test("unknown ex command flashes an error", async ({ page }) => {
    await bootVim(page);
    await page.keyboard.press(":");
    await page.locator(".av-exbar-input").fill("frobnicate");
    await page.keyboard.press("Enter");
    await expect(page.locator(".av-toast.is-error")).toContainText("frobnicate");
  });

  test("cw changes a word, typing replaces it, and u undoes the whole change at once", async ({
    page,
  }) => {
    await bootVim(page);
    await freshLine(page, "alpha beta gamma");
    await page.keyboard.press("w"); // onto beta
    await page.keyboard.press("c");
    await expect(page.locator(".av-showcmd")).toHaveText("c");
    await page.keyboard.press("w");
    await expect(mode(page)).toHaveText("INSERT");
    await page.keyboard.type("delta");
    await page.keyboard.press("Escape");
    await expect(lastBlock(page)).toHaveText("alpha delta gamma");
    await expect(mode(page)).toHaveText("NORMAL");
    // one undo restores both the cut and the typed text
    await page.keyboard.press("u");
    await expect(lastBlock(page)).toHaveText("alpha beta gamma");
  });

  test('di" and daw act on text objects; . repeats the last change', async ({ page }) => {
    await bootVim(page);
    await freshLine(page, 'say "hello there" now');
    await page.keyboard.press("f");
    await page.keyboard.press("e"); // inside the quotes
    await page.keyboard.press("d");
    await page.keyboard.press("i");
    await page.keyboard.press('"');
    await expect(lastBlock(page)).toHaveText('say "" now');

    await freshLine(page, "one two three four");
    await page.keyboard.press("d");
    await page.keyboard.press("w");
    await expect(lastBlock(page)).toHaveText("two three four");
    await page.keyboard.press(".");
    await expect(lastBlock(page)).toHaveText("three four");
    await page.keyboard.press("2");
    await page.keyboard.press(".");
    await expect(lastBlock(page)).toHaveText("");
  });

  test("the normal-mode cursor sits ON a character: $ parks on the last one, l stays put, x steps back", async ({
    page,
  }) => {
    await bootVim(page);
    await freshLine(page, "abc");
    const block = await stat(page).innerText();
    await page.keyboard.press("$");
    await expect(stat(page)).toHaveText(/:3$/); // offset 2 → col 3, ON "c"
    await page.keyboard.press("l");
    await page.keyboard.press("l");
    await expect(stat(page)).toHaveText(`${block.split(":")[0]}:3`); // same block, same col
    await page.keyboard.press("x");
    await expect(lastBlock(page)).toHaveText("ab");
    await expect(stat(page)).toHaveText(/:2$/); // back onto "b"
  });

  test("Backspace moves in normal mode instead of deleting; Delete acts like x", async ({
    page,
  }) => {
    await bootVim(page);
    await freshLine(page, "abc");
    await page.keyboard.press("$");
    await page.keyboard.press("Backspace");
    await expect(stat(page)).toHaveText(/:2$/);
    await expect(lastBlock(page)).toHaveText("abc");
    await page.keyboard.press("Delete");
    await expect(lastBlock(page)).toHaveText("ac");
  });

  test("v is charwise visual (l extends, d deletes); V j d deletes two lines", async ({ page }) => {
    await bootVim(page);
    await freshLine(page, "abcdef");
    await page.keyboard.press("v");
    await expect(mode(page)).toHaveText("VISUAL");
    await page.keyboard.press("l");
    await page.keyboard.press("l");
    await page.keyboard.press("d");
    await expect(lastBlock(page)).toHaveText("def");
    await expect(mode(page)).toHaveText("NORMAL");

    const blocks = page.locator(".av-cm .tiptap > *");
    await freshLine(page, "second");
    const before = await blocks.count();
    await page.keyboard.press("k");
    await page.keyboard.press("V");
    await page.keyboard.press("j");
    await page.keyboard.press("d");
    await expect(blocks).toHaveCount(before - 2);
    await expect(mode(page)).toHaveText("NORMAL");
  });

  test("a mouse drag enters visual mode; Esc leaves it", async ({ page }) => {
    await bootVim(page);
    await freshLine(page, "drag across me");
    const box = await lastBlock(page).boundingBox();
    if (!box) throw new Error("no block box");
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + 4, y);
    await page.mouse.down();
    await page.mouse.move(box.x + 60, y, { steps: 6 });
    await page.mouse.up();
    await expect(mode(page)).toHaveText("VISUAL");
    await page.keyboard.press("Escape");
    await expect(mode(page)).toHaveText("NORMAL");
  });

  test("r replaces a character, ~ toggles case, J joins lines", async ({ page }) => {
    await bootVim(page);
    await freshLine(page, "abc");
    await page.keyboard.press("r");
    await page.keyboard.press("x");
    await expect(lastBlock(page)).toHaveText("xbc");
    await page.keyboard.press("~");
    await expect(lastBlock(page)).toHaveText("Xbc");
    await page.keyboard.press("A");
    await page.keyboard.press("Enter");
    await page.keyboard.type("next");
    await page.keyboard.press("Escape");
    await page.keyboard.press("k");
    await page.keyboard.press("J");
    await expect(lastBlock(page)).toHaveText("Xbc next");
  });

  test(">> nests a list item and << unnests it", async ({ page }) => {
    await bootVim(page);
    await page.keyboard.press("G");
    await page.keyboard.press("A");
    await page.keyboard.press("Enter");
    await page.keyboard.type("- item one"); // the input rule makes a bullet list
    await page.keyboard.press("Enter");
    await page.keyboard.type("item two");
    await page.keyboard.press("Escape");
    await expect(page.locator(".av-cm .tiptap ul li")).toHaveCount(2);
    const nested = page.locator(".av-cm .tiptap ul li ul li");
    await expect(nested).toHaveCount(0);
    await page.keyboard.press(">");
    await page.keyboard.press(">");
    await expect(nested).toHaveCount(1);
    await page.keyboard.press("<");
    await page.keyboard.press("<");
    await expect(nested).toHaveCount(0);
  });

  test("yw yanks a word and p pastes it after the cursor", async ({ page }) => {
    await bootVim(page);
    await freshLine(page, "ab cd");
    await page.keyboard.press("y");
    await page.keyboard.press("w");
    await page.keyboard.press("$");
    await page.keyboard.press("p");
    await expect(lastBlock(page)).toContainText("ab cdab");
  });

  test("showcmd echoes a pending count + operator and clears on Esc", async ({ page }) => {
    await bootVim(page);
    const show = page.locator(".av-showcmd");
    await page.keyboard.press("2");
    await page.keyboard.press("d");
    await expect(show).toHaveText("2d");
    await page.keyboard.press("Escape");
    await expect(show).toHaveCount(0);
  });

  test("Tab is swallowed in normal mode, indents in insert (issue #23 semantics)", async ({
    page,
  }) => {
    await bootVim(page);
    const content = page.locator(".av-cm .tiptap");
    const blocks = await content.locator("> *").count();
    await page.keyboard.press("Tab"); // normal: swallowed, still focused, no edit
    await expect(content.locator("> *")).toHaveCount(blocks);
    await expect(content).toBeFocused();
    await expect(page.locator(".av-dirty")).toHaveCount(0);

    // insert on a fresh line: Tab inserts spaces AT THE CARET
    await page.keyboard.press("G");
    await page.keyboard.press("A"); // insert at the end of the last block
    await page.keyboard.press("Enter");
    // type around the Tab — an ArrowLeft between synthetic keys races PM's
    // native-selection sync (real typists never hit that window)
    await page.keyboard.type("a");
    await page.keyboard.press("Tab");
    await page.keyboard.type("b");
    await expect
      .poll(() =>
        page.evaluate(() =>
          /a\s{2,}b/.test(document.querySelector(".av-cm .tiptap")?.textContent ?? ""),
        ),
      )
      .toBe(true);
  });
});
