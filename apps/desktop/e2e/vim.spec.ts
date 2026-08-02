import { boot, expect, test } from "./fixtures";

test.describe("vim mode", () => {
  test("insert mode types text and Esc returns to normal", async ({ page }) => {
    await boot(page, { vimMode: true });
    const mode = page.locator(".av-mode");
    const content = page.locator(".cm-content");

    await content.click();
    await expect(mode).toHaveClass(/mode-normal/);

    await page.keyboard.press("i");
    await expect(mode).toHaveClass(/mode-insert/);
    await page.keyboard.type("hello from e2e ");
    await page.keyboard.press("Escape");

    await expect(mode).toHaveClass(/mode-normal/);
    await expect(content).toContainText("hello from e2e");
  });

  test("Tab indents without moving focus in insert mode", async ({ page }) => {
    await boot(page, { vimMode: true });
    await page.locator(".av-sidefoot").getByRole("button", { name: "New note" }).click();
    const content = page.locator(".cm-content");

    await page.keyboard.press("i");
    await page.keyboard.press("Tab");
    await expect(content).toBeFocused();
    await page.keyboard.type("indented");

    const text = await content.textContent();
    expect(text).toMatch(/^ {2}indented/);
  });

  // ISSUE #23: Tab was bound to indentMore, which indents the whole LINE wherever
  // the caret sits — so pressing it mid-sentence jumped the indent to the line's
  // left edge instead of inserting at the cursor. Both older Tab tests press at
  // the line start, where indentMore and insertTab agree, which is how this hid.
  test("Tab inserts at the cursor, not at the start of the line", async ({ page }) => {
    await boot(page, { vimMode: true });
    await page.locator(".av-sidefoot").getByRole("button", { name: "New note" }).click();
    const content = page.locator(".cm-content");

    await page.keyboard.press("i");
    await page.keyboard.type("ab");
    await page.keyboard.press("Tab");
    await page.keyboard.type("cd");

    // the indent lands between "ab" and "cd" — the line is NOT left-shifted
    const line = (await content.textContent())?.split("\n")[0] ?? "";
    expect(line).toContain("ab  cd");
    expect(line.startsWith(" ")).toBe(false);
  });

  test("Tab does not indent in normal mode", async ({ page }) => {
    await boot(page, { vimMode: true });
    await page.locator(".av-sidefoot").getByRole("button", { name: "New note" }).click();
    const content = page.locator(".cm-content");
    const before = await content.textContent();

    await page.keyboard.press("Tab");

    await expect(content).toBeFocused();
    expect(await content.textContent()).toBe(before);
    await expect(page.locator(".av-mode")).toHaveClass(/mode-normal/);
  });
});
