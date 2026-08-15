// extensions.ts — the block editor's extension list, one builder so editor.tsx
// stays wiring-only. Everything here is MIT @tiptap/* or prosemirror-*.
//
// Serialization style is pinned HERE and only here: 2-space indentation,
// independent of cfg.tabWidth — the on-disk shape of a note must never churn
// because a settings stepper moved (tabWidth is a code-block Tab convenience,
// not a file format).
import { Extension } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { Chords, type ChordsOptions } from "./chords";

export interface ExtensionOpts {
  chords: ChordsOptions;
  /** Read live (ref) so a settings change needs no editor reconfigure. */
  getTabWidth: () => number;
}

// Tab keeps focus inside the editor (the CM editor's focus-trap contract):
// in a list it nests/unnests the item; elsewhere it inserts tabWidth spaces at
// the caret (the issue-#23 behavior — never indent-the-whole-line).
function tabKey(getTabWidth: () => number) {
  return Extension.create({
    name: "nsTab",
    addKeyboardShortcuts() {
      return {
        Tab: () =>
          this.editor.commands.first(({ commands }) => [
            () => commands.sinkListItem("listItem"),
            () => commands.insertContent(" ".repeat(getTabWidth())),
          ]),
        "Shift-Tab": () =>
          this.editor.commands.first(({ commands }) => [
            () => commands.liftListItem("listItem"),
            // Swallow even when there's nothing to dedent — Tab must not walk
            // focus out of the editor in either direction.
            () => true,
          ]),
      };
    },
  });
}

export function buildExtensions(opts: ExtensionOpts) {
  return [
    StarterKit.configure({
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
      },
    }),
    Markdown.configure({
      indentation: { style: "space", size: 2 },
      markedOptions: { gfm: true },
    }),
    Chords.configure(opts.chords),
    tabKey(opts.getTabWidth),
  ];
}
