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
  test("folder groups render first, then a divider, then the root notes (empties included)", async ({
    page,
  }) => {
    await boot(page);
    // Every group header precedes the loose notes: the first row is a header,
    // the divider separates the last group from the root notes, and the root
    // notes sit after it.
    const nav = page.locator(".av-list");
    await expect(nav.locator("> :first-child")).toHaveClass(/av-grouphead/);
    await expect(page.locator(".av-grouphead")).toHaveCount(5); // archive ideas journal recipes work
    await expect(page.locator(".av-grouphead .av-group-name").first()).toHaveText("archive");
    await expect(page.locator(".av-divider")).toHaveCount(1);
    await expect(nav.locator(".av-divider + .av-item")).toHaveAttribute("data-dir", "");
    await expect(nav.locator("> :last-child")).toHaveAttribute("data-dir", "");
    // The empty archive group renders its blank drop row.
    await expect(page.locator('.av-group-blank[data-dir="archive"]')).toBeVisible();
    // Group members carry their dir (and the nested class that indents them);
    // the journal group holds its two notes.
    await expect(page.locator('.av-item.is-nested[data-dir="journal"]')).toHaveCount(2);
    await expect(page.locator('.av-item.is-nested[data-dir=""]')).toHaveCount(0);
  });

  test("the open note's folder header is marked, and the header shows its icon + count", async ({
    page,
  }) => {
    await boot(page); // welcome.md (a root note) is open → no header marked
    await expect(page.locator(".av-grouphead.is-here")).toHaveCount(0);
    await page.locator('.av-item[data-dir="journal"]').first().click();
    await expect(page.locator(".av-grouphead.is-here .av-group-name")).toHaveText("journal");
    await expect(page.locator('.av-grouphead[data-dir="journal"] .av-group-icon')).toBeVisible();
    await expect(page.locator('.av-grouphead[data-dir="journal"] .av-group-count')).toHaveText("2");
  });

  test("Collapse all / Expand all from a folder menu (and :foldall / :unfoldall)", async ({
    page,
  }) => {
    await boot(page);
    const header = page.locator('.av-grouphead[data-dir="journal"]');
    await header.hover();
    await header.getByRole("button", { name: "folder actions" }).click();
    await page.locator(".ctx-menu").getByRole("menuitem", { name: "Collapse all" }).click();
    await expect(page.locator(".av-item.is-nested")).toHaveCount(0);
    await expect(page.locator(".av-grouphead")).toHaveCount(5); // headers stay
    await expect(page.locator('.av-item[data-dir=""]')).toHaveCount(3); // root notes untouched
    await header.hover();
    await header.getByRole("button", { name: "folder actions" }).click();
    await page.locator(".ctx-menu").getByRole("menuitem", { name: "Expand all" }).click();
    await expect(page.locator('.av-item[data-dir="journal"]')).toHaveCount(2);
    // The keyboard path through the palette.
    await runCommand(page, "collapse all folders");
    await expect(page.locator(".av-item.is-nested")).toHaveCount(0);
    await runCommand(page, "expand all folders");
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

  test("Mod-j/k step in visual order across the divider and skip a collapsed group", async ({
    page,
  }) => {
    await boot(page); // welcome.md (first root note, right after the divider) is open
    await page.locator('.av-grouphead[data-dir="work"]').click(); // collapse work
    // Up from the first root note crosses the divider into the last VISIBLE
    // group's last note — recipes (work's notes are hidden, headers skipped).
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.locator(".av-item.is-active")).toHaveAttribute("data-dir", "recipes");
    // Down lands back on the root note.
    await page.keyboard.press("ControlOrMeta+j");
    await expect(page.locator(".av-item.is-active")).toHaveAttribute("data-dir", "");
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
    // …and it stayed in its group: the root section (after the divider) has no
    // pinned row, and the group's header still precedes it.
    await expect(page.locator('.av-item[data-dir=""] .av-item-pin')).toHaveCount(0);
    await expect(page.locator(".av-list > :first-child")).toHaveClass(/av-grouphead/);
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
  test.describe("drag-and-drop", () => {
    test.skip(({ browserName }) => browserName !== "chromium", "synthetic DnD is chromium-only");

    /** Drag the `srcIndex`-th `srcSel` row and drop it on the first `targetSel`. */
    const drag = (
      page: import("@playwright/test").Page,
      srcSel: string,
      srcIndex: number,
      targetSel: string,
    ) =>
      page.evaluate(
        ([srcSelector, index, targetSelector]) => {
          const src = [...document.querySelectorAll(srcSelector)].at(index) as HTMLElement;
          const target = document.querySelector(targetSelector) as HTMLElement;
          const nav = document.querySelector(".av-list") as HTMLElement;
          // (A constructed DataTransfer doesn't persist dropEffect outside a
          // real drag session, so the no-drop cursor isn't probed here — the
          // behavior is: no ring, no dialog, nothing moves.)
          const dataTransfer = new DataTransfer();
          src.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
          const nested = nav.classList.contains("is-drag-nested");
          target.dispatchEvent(
            new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer }),
          );
          // A row/header target rings itself; the root target rings the nav's zone.
          const ringed =
            target.classList.contains("is-drop") || target.classList.contains("is-drop-root");
          target.dispatchEvent(
            new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }),
          );
          src.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer }));
          return { nested, ringed, cleared: nav.className === "av-list" };
        },
        [srcSel, srcIndex, targetSel] as const,
      );

    test("onto a group header asks to move; Enter moves, Esc leaves the note put", async ({
      page,
    }) => {
      await boot(page);
      const root = page.locator('.av-item[data-dir=""]');
      const title = await root.last().locator(".av-item-titletext").innerText();
      // A root note onto the archive header: the header rings and no root drop
      // zone was offered (the note was already at the root) — nothing moves
      // until the confirm says so.
      const first = await drag(
        page,
        '.av-item[data-dir=""]',
        -1,
        '.av-grouphead[data-dir="archive"]',
      );
      expect(first).toEqual({ nested: false, ringed: true, cleared: true });
      const dialog = page.locator(".cfm-panel");
      await expect(dialog).toContainText(`Move “${title}” to archive?`);
      await expect(page.locator('.av-item[data-dir="archive"]')).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(page.locator('.av-item[data-dir="archive"]')).toHaveCount(0);
      // Again, confirmed with Enter this time.
      await drag(page, '.av-item[data-dir=""]', -1, '.av-grouphead[data-dir="archive"]');
      await expect(dialog).toContainText("to archive?");
      await page.keyboard.press("Enter");
      await expect(page.locator(".av-toast")).toContainText("moved to archive");
      await expect(page.locator('.av-item[data-dir="archive"]')).toHaveCount(1);
      await expect(page.locator('.av-item[data-dir="archive"] .av-item-titletext')).toHaveText(
        title,
      );
    });

    test("onto its own folder is a no-op (no ring, no dialog)", async ({ page }) => {
      await boot(page);
      // The root drop zone WAS offered, since the note came from a folder.
      const same = await drag(
        page,
        '.av-item[data-dir="journal"]',
        0,
        '.av-grouphead[data-dir="journal"]',
      );
      expect(same).toEqual({ nested: true, ringed: false, cleared: true });
      await page.waitForTimeout(300);
      await expect(page.locator(".cfm-panel")).toHaveCount(0);
      await expect(page.locator(".av-toast")).toHaveCount(0);
      await expect(page.locator('.av-item[data-dir="journal"]')).toHaveCount(2);
    });

    test("onto the root zone asks to move to the notebook root", async ({ page }) => {
      await boot(page);
      const title = await page
        .locator('.av-item[data-dir="journal"]')
        .first()
        .locator(".av-item-titletext")
        .innerText();
      const rootBefore = await page.locator('.av-item[data-dir=""]').count();
      // Dropping on the nav itself (empty space / the ::after root zone) — the
      // nav rings its root zone rather than any row.
      const hit = await drag(page, '.av-item[data-dir="journal"]', 0, ".av-list");
      expect(hit).toEqual({ nested: true, ringed: true, cleared: true });
      await expect(page.locator(".cfm-panel")).toContainText(
        `Move “${title}” to the notebook root?`,
      );
      await page.keyboard.press("Enter");
      await expect(page.locator(".av-toast")).toContainText("moved to notebook root");
      await expect(page.locator('.av-item[data-dir="journal"]')).toHaveCount(1);
      await expect(page.locator('.av-item[data-dir=""]')).toHaveCount(rootBefore + 1);
    });

    test("onto another note groups both into a new folder beside the target", async ({ page }) => {
      await boot(page);
      const root = page.locator('.av-item[data-dir=""]');
      const rootBefore = await root.count();
      const dragged = await root.last().locator(".av-item-titletext").innerText();
      const target = await root.first().locator(".av-item-titletext").innerText();
      // The target NOTE row rings (with its "new folder" label) — not a header.
      const hit = await drag(page, '.av-item[data-dir=""]', -1, '.av-item[data-dir=""]');
      expect(hit).toEqual({ nested: false, ringed: true, cleared: true });
      const dialog = page.locator(".cfm-panel");
      await expect(dialog).toContainText("New folder");
      await expect(dialog).toContainText(`“${dragged}” and “${target}” move into it.`);
      await expect(page.locator(".cfm-input")).toBeFocused();
      // An empty name can't be submitted (the button is disabled, Enter is inert).
      await page.keyboard.press("Enter");
      await expect(dialog).toHaveCount(1);
      await page.keyboard.type("pair");
      await page.keyboard.press("Enter");
      await expect(page.locator(".av-toast")).toContainText("2 notes moved to pair");
      await expect(page.locator('.av-grouphead[data-dir="pair"]')).toHaveCount(1);
      const grouped = page.locator('.av-item[data-dir="pair"] .av-item-titletext');
      await expect(grouped).toHaveCount(2);
      await expect(grouped.filter({ hasText: target })).toHaveCount(1);
      await expect(grouped.filter({ hasText: dragged })).toHaveCount(1);
      await expect(root).toHaveCount(rootBefore - 2);
    });

    test("onto a note inside a folder nests the new folder there; onto itself is a no-op", async ({
      page,
    }) => {
      await boot(page);
      // Itself: no ring, no dialog.
      const self = await drag(page, '.av-item[data-dir=""]', 0, '.av-item[data-dir=""]');
      expect(self).toEqual({ nested: false, ringed: false, cleared: true });
      await page.waitForTimeout(200);
      await expect(page.locator(".cfm-panel")).toHaveCount(0);
      // A root note onto a journal note: the new folder lives INSIDE journal.
      const hit = await drag(page, '.av-item[data-dir=""]', -1, '.av-item[data-dir="journal"]');
      expect(hit).toEqual({ nested: false, ringed: true, cleared: true });
      await expect(page.locator(".cfm-panel")).toContainText("inside journal.");
      await page.keyboard.type("sub");
      await page.keyboard.press("Enter");
      await expect(page.locator(".av-toast")).toContainText("2 notes moved to journal/sub");
      await expect(page.locator('.av-grouphead[data-dir="journal/sub"]')).toHaveCount(1);
      await expect(page.locator('.av-item[data-dir="journal/sub"]')).toHaveCount(2);
      await expect(page.locator('.av-item[data-dir="journal"]')).toHaveCount(1);
    });

    test("grouping the OPEN note keeps its buffer (id migrates, no remount)", async ({ page }) => {
      await boot(page);
      // Open the last root note and type into it; then drop the ACTIVE row onto
      // another root note (the autosave may have re-sorted it to the top).
      await page.locator('.av-item[data-dir=""]').last().click();
      await caretToEnd(page);
      await page.keyboard.type(" GROUP_SENTINEL");
      await drag(page, ".av-item.is-active", 0, '.av-item[data-dir=""]:not(.is-active)');
      await page.keyboard.type("held");
      await page.keyboard.press("Enter");
      await expect(page.locator(".av-toast")).toContainText("2 notes moved to held");
      // The buffer survived the id change: edit intact, the active row is now in `held`.
      await expect(page.locator(".av-cm .tiptap")).toContainText("GROUP_SENTINEL");
      await expect(page.locator('.av-item.is-active[data-dir="held"]')).toHaveCount(1);
    });
  });
});
