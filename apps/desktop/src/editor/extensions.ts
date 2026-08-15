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
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Mathematics } from "@tiptap/extension-mathematics";
import { Chords, type ChordsOptions } from "./chords";
import { HtmlBlock } from "./html-passthrough";
import { tableExtensions } from "./table";
import { Callout } from "./callout";
import { NsImage } from "./image";
import { NsCodeBlock } from "./code-block";
import { ActiveBlock } from "./active-block";
import { Find } from "./find";
import { HoverHandle } from "./hover-handle";
import { LinkClick } from "./link-click";
import { SlashMenu } from "./slash-menu";
import { Vim, type VimOptions } from "./vim";

export interface ExtensionOpts {
  chords: ChordsOptions;
  /** Read live (ref) so a settings change needs no editor reconfigure. */
  getTabWidth: () => number;
  /** Display-URL resolver for images (Tauri asset protocol / passthrough). */
  resolveImageSrc?: (src: string) => string;
  /** Mod-click / follow target — opens in the system browser. */
  onOpenUrl?: (url: string) => void;
  /** The vim layer's options — present only when cfg.vimMode is on (the
   *  parent remounts on a vim-mode change via the editorKey suffix). */
  vim?: VimOptions | null;
}

/** The schema-bearing extension set — the exact configuration the round-trip
 *  tests exercise (round-trip.test.ts builds its MarkdownManager from THIS, so
 *  a config drift between app and test is impossible). Editor-behavior
 *  extensions (chords, Tab, lowlight code blocks — DOM-bound) stack on top in
 *  buildExtensions.
 *
 *  codeBlock comes from StarterKit here (schema + markdown fence spec); the
 *  app swaps it for the lowlight NodeView variant, which shares that spec. */
export function markdownExtensions(opts?: {
  codeBlock?: false;
  resolveImageSrc?: (src: string) => string;
}) {
  return [
    StarterKit.configure({
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
      },
      ...(opts?.codeBlock === false ? { codeBlock: false as const } : {}),
    }),
    Markdown.configure({
      indentation: { style: "space", size: 2 },
      markedOptions: { gfm: true },
    }),
    ...tableExtensions(),
    TaskList,
    TaskItem.configure({ nested: true }),
    Mathematics.configure({ katexOptions: { throwOnError: false } }),
    NsImage.configure({ resolveSrc: opts?.resolveImageSrc ?? ((src) => src) }),
    Callout,
    HtmlBlock,
  ];
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
            // raw insertText — insertContent would route through the markdown
            // parser, which eats a whitespace-only string entirely
            () =>
              commands.command(({ tr, dispatch }) => {
                if (dispatch) tr.insertText(" ".repeat(getTabWidth()));
                return true;
              }),
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
    ...markdownExtensions({ codeBlock: false, resolveImageSrc: opts.resolveImageSrc }),
    NsCodeBlock,
    ActiveBlock,
    Find,
    SlashMenu,
    HoverHandle,
    LinkClick.configure({ onOpenUrl: opts.onOpenUrl ?? (() => {}) }),
    Chords.configure(opts.chords),
    tabKey(opts.getTabWidth),
    ...(opts.vim ? [Vim.configure(opts.vim)] : []),
  ];
}
