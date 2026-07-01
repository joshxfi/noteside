import { boot, expect, test } from "./fixtures";

// Regression guard for the cursor style/blink bug: style was never wired to the
// caret, and blink only applied at mount. Both must now apply live.
test.describe("cursor settings", () => {
  test("style is wired to the caret and applies live", async ({ page }) => {
    await boot(page, { vimMode: false, cursor: "block" });
    const editor = page.locator(".av-editor");
    await expect(editor).toHaveAttribute("data-cursor", "block");

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.locator(".set-panel").waitFor();

    // The cursor "Style" pills — changing them updates the editor live.
    await page.getByRole("button", { name: "Bar", exact: true }).click();
    await expect(editor).toHaveAttribute("data-cursor", "bar");
    await page.getByRole("button", { name: "Underline", exact: true }).click();
    await expect(editor).toHaveAttribute("data-cursor", "underline");

    // Close settings + focus the editor so the caret renders, then confirm the
    // CSS actually reshapes it (underline = bottom border, no left border).
    await page.keyboard.press("Escape");
    await page.locator(".cm-content").click();
    const caret = page.locator(".cm-cursor:not(.cm-fat-cursor)").first();
    await expect(caret).toHaveCSS("border-bottom-width", "2px");
    await expect(caret).toHaveCSS("border-left-width", "0px");
  });

  test("blink toggles the caret animation live", async ({ page }) => {
    await boot(page, { vimMode: false, cursorBlink: true });
    await page.locator(".cm-content").click();

    const blinkRate = () =>
      page.evaluate(
        () =>
          (document.querySelector(".cm-cursorLayer") as HTMLElement | null)?.style
            .animationDuration ?? "",
      );
    await expect.poll(blinkRate).toBe("1200ms");

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.locator(".set-panel").waitFor();
    const blinkSwitch = page
      .locator(".set-row")
      .filter({ has: page.locator(".set-rowlabel", { hasText: /^Blink$/ }) })
      .locator("button");

    await blinkSwitch.click();
    await expect.poll(blinkRate).toBe("0ms");
    await blinkSwitch.click();
    await expect.poll(blinkRate).toBe("1200ms");
  });
});
