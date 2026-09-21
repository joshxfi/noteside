import { boot, expect, test } from "./fixtures";

// Edge cases on the operations that WRITE files. The happy paths live in
// new-note/note-actions/delete.spec.ts; these are their awkward neighbours —
// creating while the target folder is collapsed, duplicating a note whose
// frontmatter carries state, retitling onto a slug that is already taken, and
// the delete that empties a folder. All driven through the same mock backend
// and command palette the other specs use.

/** Run a (non-danger) command by title through the searchable command palette.
 *  Mirrors the helper in note-actions.spec.ts / folders.spec.ts. */
const runCommand = async (page: import("@playwright/test").Page, title: string) => {
  await page.keyboard.press("ControlOrMeta+Shift+p");
  await expect(page.locator(".fnd-input")).toBeFocused();
  await page.keyboard.type(title);
  await page.keyboard.press("Enter");
};

test.describe("create a note while its folder is collapsed", () => {
  test("the note lands in the open note's folder and the group re-expands", async ({ page }) => {
    await boot(page);
    // A new note lands in the OPEN note's folder, so open one inside `work`.
    const work = page.locator('.av-item[data-dir="work"]');
    await expect(work).toHaveCount(3);
    const workTitle = await work.first().locator(".av-item-titletext").innerText();
    await work.first().click();
    await expect(page.locator(".av-file")).toContainText(workTitle);

    // Collapsing drops the members from the row model entirely.
    const header = page.locator('.av-grouphead[data-dir="work"]');
    await header.click();
    await expect(header).not.toHaveClass(/is-open/);
    await expect(work).toHaveCount(0);

    await page.locator(".av-sidefoot").getByRole("button", { name: "New note" }).click();

    // Opening the new note auto-expands the group that was hiding it — without
    // that, the note the user just made would have no row at all.
    await expect(page.locator(".av-file")).toContainText("Untitled");
    await expect(header).toHaveClass(/is-open/);
    await expect(work).toHaveCount(4);
    await expect(work.filter({ hasText: "Untitled" })).toHaveCount(1);
    await expect(page.locator(".av-item.is-active")).toHaveAttribute("data-dir", "work");
  });
});

test.describe("duplicate a pinned note", () => {
  test("the copy is pinned too — duplicate copies the body, frontmatter and all", async ({
    page,
  }) => {
    await boot(page);
    await page.locator(".av-cm .tiptap").click();
    const title = await page.locator(".av-item.is-active .av-item-titletext").innerText();
    // Nothing in the demo seed is pinned, so the indicator starts absent.
    await expect(page.locator(".av-item.is-active .av-item-pin")).toHaveCount(0);

    // Pinning the OPEN note rewrites its frontmatter and reopens the buffer.
    await runCommand(page, "pin note");
    await expect(page.locator(".av-item.is-active .av-item-pin")).toHaveCount(1);
    await expect(page.locator(".av-item.is-active .av-item-titletext")).toHaveText(title);

    await runCommand(page, "duplicate");
    await expect(page.locator(".av-toast")).toContainText("note duplicated");

    // `pinned: true` lives in the frontmatter and duplicate copies the BODY, so
    // the copy inherits it: mock.ts's duplicateNote carries `pinned` over and
    // Rust's duplicate_note re-parses the copied body, which still has the key.
    const copy = page.locator(".av-item.is-active");
    await expect(copy.locator(".av-item-titletext")).toHaveText(`${title} copy`);
    await expect(copy.locator(".av-item-pin")).toHaveCount(1);
    // The original kept its pin as well — a duplicate must not move it.
    await expect(page.locator(".av-item-pin")).toHaveCount(2);
  });
});

test.describe("retitle onto a slug that is taken", () => {
  test("both notes keep the title; the new file gets a -2 stem", async ({ page }) => {
    await boot(page);
    await page.locator(".av-cm .tiptap").click();
    // "Keymap" is another ROOT note, so the slug collision is in the same dir.
    const taken = "Keymap";
    await expect(page.locator(".av-item-titletext").filter({ hasText: taken })).toHaveCount(1);

    await runCommand(page, "rename note");
    const input = page.locator(".cfm-input");
    await expect(input).toBeVisible();
    await input.fill(taken);
    await page.keyboard.press("Enter");

    await expect(page.locator(".cfm-panel")).toHaveCount(0);
    await expect(page.locator(".av-toast")).toContainText("note renamed");
    // Two notes now share one title — the collision is resolved on disk, not by
    // refusing the rename or by silently overwriting the other note.
    await expect(page.locator(".av-item-titletext").filter({ hasText: taken })).toHaveCount(2);
    await expect(page.locator(".av-file")).toContainText(taken);

    // The finder shows them as two distinct files, one carrying the -2 stem.
    await page.keyboard.press("ControlOrMeta+p");
    await page.locator(".fnd-panel").waitFor();
    await page.locator(".fnd-input").fill(taken);
    await expect(page.locator(".fnd-row").first()).toBeVisible();
    const paths = await page.locator(".fnd-row .fnd-path").allInnerTexts();
    expect(paths.filter((p) => /(^|\/)keymap\.md$/.test(p))).toHaveLength(1);
    expect(paths.filter((p) => /(^|\/)keymap-2\.md$/.test(p))).toHaveLength(1);
  });
});

test.describe("delete the last note in a folder", () => {
  test("the folder outlives its last note", async ({ page }) => {
    await boot(page);
    // `recipes` holds exactly one seeded note.
    const row = page.locator('.av-item[data-dir="recipes"]');
    await expect(row).toHaveCount(1);
    const title = await row.locator(".av-item-titletext").innerText();
    await row.click();
    await expect(page.locator(".av-file")).toContainText(title);
    const before = await page.locator(".av-item").count();

    // The danger path delete.spec.ts drives: palette → inline confirm → modal.
    await page.keyboard.press("ControlOrMeta+Shift+p");
    await expect(page.locator(".fnd-input")).toBeFocused();
    await page.keyboard.type("delete note");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter"); // inline danger confirm
    await expect(page.locator(".cfm-panel")).toBeVisible();
    await page.keyboard.press("Enter");

    await expect(page.locator(".av-toast")).toContainText("note deleted");
    await expect(page.locator(".av-item")).toHaveCount(before - 1);
    await expect(page.locator('.av-item[data-dir="recipes"]')).toHaveCount(0);
    // Empty folders are first-class: the header stays, ready to be filled again
    // (deleting a note must not quietly remove the directory).
    await expect(page.locator('.av-grouphead[data-dir="recipes"]')).toBeVisible();
    await expect(page.locator(".av-item.is-active")).not.toContainText(title);
  });
});
