import { boot, caretToEnd, expect, test } from "./fixtures";

// Folders: notes organized into real subdirectories, shown as flat collapsible
// groups (root notes first, then one section per dir). The seeded demo notebook
// has root notes (welcome/rich-blocks/keymap), the journal/work/recipes/ideas
// groups, and an explicitly EMPTY "archive" folder (empty folders are
// first-class). The drag-and-drop test is chromium-only (WebKit's synthetic
// DnD is unreliable in Playwright — the hover-grip precedent); the native
// folder menu still needs a manual check in `pnpm dev:desktop`.

/** Run a command by title through the searchable command palette. */
const runCommand = async (page: import("@playwright/test").Page, title: string) => {
  await page.keyboard.press("ControlOrMeta+Shift+p");
  await expect(page.locator(".fnd-input")).toBeFocused();
  await page.keyboard.type(title);
  await page.keyboard.press("Enter");
};

test.describe("folder groups", () => {
  test("root notes render first, then one collapsible group per dir (empties included)", async ({
    page,
  }) => {
    await boot(page);
    // Root notes precede every group header.
    const nav = page.locator(".av-list");
    await expect(nav.locator("> :first-child")).toHaveClass(/av-item/);
    await expect(page.locator(".av-grouphead")).toHaveCount(5); // archive ideas journal recipes work
    await expect(page.locator(".av-grouphead .av-group-name").first()).toHaveText("archive");
    // The empty archive group renders its blank drop row.
    await expect(page.locator('.av-group-blank[data-dir="archive"]')).toBeVisible();
    // Group members carry their dir; the journal group holds its two notes.
    await expect(page.locator('.av-item[data-dir="journal"]')).toHaveCount(2);
  });

  test("collapse hides members and persists across reload", async ({ page }) => {
    await boot(page);
    await page.locator('.av-grouphead[data-dir="journal"]').click();
    await expect(page.locator('.av-item[data-dir="journal"]')).toHaveCount(0);
    await page.reload();
    await page.locator(".av-editor").waitFor();
    await expect(page.locator('.av-grouphead[data-dir="journal"]')).toBeVisible();
    await expect(page.locator('.av-item[data-dir="journal"]')).toHaveCount(0);
    // Expanding brings the members back.
    await page.locator('.av-grouphead[data-dir="journal"]').click();
    await expect(page.locator('.av-item[data-dir="journal"]')).toHaveCount(2);
  });

  test("opening a note inside a collapsed group auto-expands it", async ({ page }) => {
    await boot(page);
    await page.locator('.av-grouphead[data-dir="journal"]').click();
    await expect(page.locator('.av-item[data-dir="journal"]')).toHaveCount(0);
    // Jump into the group through the finder (Mod-p).
    await page.keyboard.press("ControlOrMeta+p");
    await expect(page.locator(".fnd-input")).toBeFocused();
    await page.keyboard.type("morning");
    await expect(page.locator(".fnd-row").first()).toContainText("Morning pages");
    await page.keyboard.press("Enter");
    await expect(page.locator('.av-item[data-dir="journal"]')).toHaveCount(2);
    await expect(page.locator(".av-item.is-active .av-item-titletext")).toHaveText("Morning pages");
  });

  test("Mod-j steps in visual order and skips a collapsed group", async ({ page }) => {
    await boot(page); // welcome.md (first root note) is open
    await page.locator('.av-grouphead[data-dir="ideas"]').click(); // collapse ideas
    // Step from the last root note: next lands in journal (ideas' notes are
    // hidden, headers are skipped — visual order).
    await page.keyboard.press("ControlOrMeta+j"); // rich-blocks
    await page.keyboard.press("ControlOrMeta+j"); // keymap (last root note)
    await page.keyboard.press("ControlOrMeta+j"); // first journal note (archive is empty, ideas collapsed)
    await expect(page.locator(".av-item.is-active")).toHaveAttribute("data-dir", "journal");
  });

  test("pin floats a foldered note within its group, not to the root", async ({ page }) => {
    await boot(page);
    // Open the LAST work note and pin it.
    await page.locator('.av-item[data-dir="work"]').last().click();
    const title = await page.locator(".av-item.is-active .av-item-titletext").innerText();
    await runCommand(page, "pin note");
    await expect(page.locator(".av-toast")).toContainText("note pinned");
    // First member of the work group is now the pinned note…
    await expect(
      page.locator('.av-item[data-dir="work"]').first().locator(".av-item-titletext"),
    ).toHaveText(title);
    // …and the first sidebar row is still a root note (no hoisting).
    await expect(page.locator(".av-list > :first-child")).toHaveAttribute("data-dir", "");
  });

  test("move via the row menu → picker re-homes the note (and the finder shows the new path)", async ({
    page,
  }) => {
    await boot(page);
    const target = page.locator('.av-item[data-dir=""]').last(); // keymap.md
    await target.click({ button: "right" });
    await page.locator(".ctx-menu").getByRole("menuitem", { name: "Move to folder…" }).click();
    await expect(page.locator(".fnd-input")).toBeFocused();
    await page.keyboard.type("archive");
    await page.keyboard.press("Enter");
    await expect(page.locator(".av-toast")).toContainText("moved to archive");
    await expect(page.locator('.av-item[data-dir="archive"]')).toHaveCount(1);
    await expect(page.locator('.av-group-blank[data-dir="archive"]')).toHaveCount(0);
    // The finder's secondary line shows the new relative path.
    await page.keyboard.press("ControlOrMeta+p");
    await page.keyboard.type("keymap");
    await expect(page.locator(".fnd-row").first().locator(".fnd-path")).toContainText("archive/");
  });

  test("moving the OPEN note keeps the buffer and unsaved edits (no remount)", async ({ page }) => {
    await boot(page); // welcome.md open
    await caretToEnd(page);
    await page.keyboard.type(" MOVE_SENTINEL");
    await runCommand(page, "move to folder");
    await expect(page.locator(".fnd-input")).toBeFocused();
    await page.keyboard.type("recipes");
    await page.keyboard.press("Enter");
    await expect(page.locator(".av-toast")).toContainText("moved to recipes");
    // Same buffer, edit intact — the id migrated in place, no remount.
    await expect(page.locator(".av-cm .tiptap")).toContainText("MOVE_SENTINEL");
    await expect(page.locator(".av-item.is-active")).toHaveAttribute("data-dir", "recipes");
    // Later typing autosaves against the NEW id (the old file must not resurrect).
    await caretToEnd(page);
    await page.keyboard.type(" AFTER_MOVE");
    await page.waitForTimeout(1200); // past the 800ms autosave debounce
    await expect(page.locator(".av-item.is-active .av-item-pin")).toHaveCount(0); // sanity: still one row
    await expect(page.locator('.av-item[data-dir="recipes"]')).toHaveCount(2);
  });

  test("the picker's New folder… creates the folder and moves in one step", async ({ page }) => {
    await boot(page);
    await page.locator('.av-item[data-dir=""]').last().click({ button: "right" });
    await page.locator(".ctx-menu").getByRole("menuitem", { name: "Move to folder…" }).click();
    // Select the "New folder…" action row by clicking it (pointer path).
    await page.locator(".fnd-row", { hasText: "New folder…" }).click();
    await page.keyboard.type("inbox");
    await page.keyboard.press("Enter");
    await expect(page.locator(".av-toast")).toContainText("moved to inbox");
    await expect(page.locator('.av-grouphead[data-dir="inbox"]')).toBeVisible();
    await expect(page.locator('.av-item[data-dir="inbox"]')).toHaveCount(1);
  });

  test("folder menu: New note here creates inside the folder", async ({ page }) => {
    await boot(page);
    await page.locator('.av-grouphead[data-dir="archive"]').click({ button: "right" });
    await page.locator(".ctx-menu").getByRole("menuitem", { name: "New note here" }).click();
    await expect(page.locator('.av-item[data-dir="archive"]')).toHaveCount(1);
    await expect(page.locator(".av-item.is-active")).toHaveAttribute("data-dir", "archive");
  });

  test("rename folder relabels the group and its notes survive", async ({ page }) => {
    await boot(page);
    await page.locator('.av-grouphead[data-dir="recipes"]').click({ button: "right" });
    await page.locator(".ctx-menu").getByRole("menuitem", { name: "Rename folder…" }).click();
    const input = page.locator(".cfm-input");
    await expect(input).toBeFocused();
    await input.fill("pantry");
    await page.keyboard.press("Enter");
    await expect(page.locator(".av-toast")).toContainText("folder renamed to pantry");
    await expect(page.locator('.av-grouphead[data-dir="pantry"]')).toBeVisible();
    await expect(page.locator('.av-grouphead[data-dir="recipes"]')).toHaveCount(0);
    await expect(page.locator('.av-item[data-dir="pantry"]')).toHaveCount(1);
    // The note opens under its rewritten id.
    await page.locator('.av-item[data-dir="pantry"]').click();
    await expect(page.locator(".av-cm .tiptap")).toContainText("figs");
  });

  test("delete folder confirms with the note count and removes the subtree", async ({ page }) => {
    await boot(page);
    await page.locator('.av-grouphead[data-dir="work"]').click({ button: "right" });
    await page.locator(".ctx-menu").getByRole("menuitem", { name: "Delete folder" }).click();
    const dialog = page.locator(".cfm-panel");
    await expect(dialog).toContainText("Delete folder “work”?");
    await expect(dialog).toContainText("3 notes");
    await dialog.locator(".cfm-btn.danger").click();
    await expect(page.locator(".av-toast")).toContainText("folder deleted");
    await expect(page.locator('.av-grouphead[data-dir="work"]')).toHaveCount(0);
    await expect(page.locator('.av-item[data-dir="work"]')).toHaveCount(0);
  });

  test("the palette gates folder commands on the active note being foldered", async ({ page }) => {
    await boot(page); // welcome.md (root) open
    await page.keyboard.press("ControlOrMeta+Shift+p");
    await page.keyboard.type("folder");
    await expect(page.locator(".fnd-row", { hasText: "Rename folder…" })).toHaveCount(0);
    await expect(page.locator(".fnd-row", { hasText: "Delete folder" })).toHaveCount(0);
    await expect(page.locator(".fnd-row", { hasText: "New folder…" })).toHaveCount(1);
    await page.keyboard.press("Escape");
    // Open a foldered note — now the folder-scoped commands appear.
    await page.locator('.av-item[data-dir="journal"]').first().click();
    await page.keyboard.press("ControlOrMeta+Shift+p");
    await page.keyboard.type("folder");
    await expect(page.locator(".fnd-row", { hasText: "Rename folder…" })).toHaveCount(1);
    await expect(page.locator(".fnd-row", { hasText: "Delete folder" })).toHaveCount(1);
    await page.keyboard.press("Escape");
  });

  test("vim :mv opens the move picker", async ({ page }) => {
    await boot(page, { vimMode: true });
    await page.locator(".av-cm .tiptap").click();
    await page.keyboard.press("Escape"); // normal mode
    await page.keyboard.press(":");
    await page.keyboard.type("mv");
    await page.keyboard.press("Enter");
    await expect(page.locator(".fnd-input")).toBeFocused();
    await expect(page.locator(".fnd-row", { hasText: "Notebook root" })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("vim :fold collapses and re-expands the open note's group", async ({ page }) => {
    await boot(page, { vimMode: true });
    await page.locator('.av-item[data-dir="journal"]').first().click();
    await page.locator(".av-cm .tiptap").click();
    await page.keyboard.press("Escape"); // normal mode
    await page.keyboard.press(":");
    await page.keyboard.type("fold");
    await page.keyboard.press("Enter");
    await expect(page.locator('.av-item[data-dir="journal"]')).toHaveCount(0);
    await expect(page.locator('.av-grouphead[data-dir="journal"]')).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await page.keyboard.press(":");
    await page.keyboard.type("fold");
    await page.keyboard.press("Enter");
    await expect(page.locator('.av-item[data-dir="journal"]')).toHaveCount(2);
  });

  test("Mod-k/j from a note hidden by collapsing its OWN group resume from the group", async ({
    page,
  }) => {
    await boot(page);
    await page.locator('.av-item[data-dir="journal"]').last().click(); // Thursday
    await page.locator('.av-grouphead[data-dir="journal"]').click(); // collapse the active group
    await expect(page.locator('.av-item[data-dir="journal"]')).toHaveCount(0);
    // Up: the last visible note BEFORE the collapsed header (ideas), not the top.
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.locator(".av-item.is-active")).toHaveAttribute("data-dir", "ideas");
    // Back into the hidden group via the finder (auto-expands), collapse again…
    await page.keyboard.press("ControlOrMeta+p");
    await expect(page.locator(".fnd-input")).toBeFocused();
    await page.keyboard.type("thursday");
    await expect(page.locator(".fnd-row").first()).toContainText("Thursday");
    await page.keyboard.press("Enter");
    await expect(page.locator('.av-item[data-dir="journal"]')).toHaveCount(2);
    await page.locator('.av-grouphead[data-dir="journal"]').click();
    // …and down lands on the first visible note AFTER the header (recipes).
    await page.keyboard.press("ControlOrMeta+j");
    await expect(page.locator(".av-item.is-active")).toHaveAttribute("data-dir", "recipes");
  });

  test("New note lands in the open note's folder", async ({ page }) => {
    await boot(page);
    await page.locator('.av-item[data-dir="journal"]').first().click();
    await page.locator(".av-sidefoot").getByRole("button", { name: "New note" }).click();
    await expect(page.locator(".av-toast")).toContainText("new note in journal");
    await expect(page.locator('.av-item[data-dir="journal"]')).toHaveCount(3);
    await expect(page.locator(".av-item.is-active")).toHaveAttribute("data-dir", "journal");
  });

  test("the footer's New folder button creates a root folder (and rejects an empty name)", async ({
    page,
  }) => {
    await boot(page);
    const newFolder = page.locator(".av-sidefoot").getByRole("button", { name: "New folder" });
    await newFolder.click();
    const input = page.locator(".cfm-input");
    await expect(input).toBeFocused();
    await input.fill("inbox");
    await page.keyboard.press("Enter");
    await expect(page.locator(".av-toast")).toContainText("folder inbox created");
    await expect(page.locator('.av-grouphead[data-dir="inbox"]')).toBeVisible();
    await expect(page.locator('.av-group-blank[data-dir="inbox"]')).toBeVisible();
    // A separators-only name must not report "created" for a folder that
    // already existed (it would sanitize down to the parent).
    await newFolder.click();
    await page.locator(".cfm-input").fill("/");
    await page.keyboard.press("Enter");
    await expect(page.locator(".av-toast")).toContainText("folder name is empty");
  });

  // Chromium-only: WebKit's synthetic HTML5 drag events are unreliable in
  // Playwright (the hover-grip drag precedent) — verify manually there.
  test("dragging a note row onto a group header moves it; onto its own folder is a no-op", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "synthetic DnD is chromium-only");
    await boot(page);
    const drag = (srcSel: string, srcIndex: number, targetSel: string) =>
      page.evaluate(
        ([srcSelector, index, targetSelector]) => {
          const src = [...document.querySelectorAll(srcSelector)].at(index) as HTMLElement;
          const target = document.querySelector(targetSelector) as HTMLElement;
          const nav = document.querySelector(".av-list") as HTMLElement;
          // (A constructed DataTransfer doesn't persist dropEffect outside a
          // real drag session, so the no-drop cursor isn't probed here — the
          // behavior is: nothing moves and no toast.)
          const dataTransfer = new DataTransfer();
          src.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
          const nested = nav.classList.contains("is-drag-nested");
          target.dispatchEvent(
            new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer }),
          );
          const ringed = target.classList.contains("is-drop");
          target.dispatchEvent(
            new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }),
          );
          src.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer }));
          return { nested, ringed, cleared: nav.className === "av-list" };
        },
        [srcSel, srcIndex, targetSel] as const,
      );
    // A root note onto the archive header: the header rings, the note moves,
    // and no root drop zone was offered (the note was already at the root).
    const first = await drag('.av-item[data-dir=""]', -1, '.av-grouphead[data-dir="archive"]');
    expect(first).toEqual({ nested: false, ringed: true, cleared: true });
    await expect(page.locator(".av-toast")).toContainText("moved to archive");
    await expect(page.locator('.av-item[data-dir="archive"]')).toHaveCount(1);
    // A journal note onto its OWN header: no ring, nothing moves, no toast —
    // but the root drop zone WAS offered, since the note came from a folder.
    await page.waitForTimeout(1800); // let the first toast expire
    const same = await drag('.av-item[data-dir="journal"]', 0, '.av-grouphead[data-dir="journal"]');
    expect(same).toEqual({ nested: true, ringed: false, cleared: true });
    await page.waitForTimeout(300);
    await expect(page.locator(".av-toast")).toHaveCount(0);
    await expect(page.locator('.av-item[data-dir="journal"]')).toHaveCount(2);
  });
});
