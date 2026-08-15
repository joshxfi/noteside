// link-click.ts — pointer-side URL following. Plain click places the caret
// (this is an editor, not a browser); Mod-click opens the URL under the
// pointer. While Mod is held, an `is-mod` class on .av-editor turns the link
// cursor on, so the pointer affordance is honest — CSS-driven, no per-node
// state (the AGENTS.md pointer rule).
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { urlAt } from "../links";
import { isModKey, modActive } from "./platform";

export interface LinkClickOptions {
  onOpenUrl: (url: string) => void;
}

/** The openable URL at a document position: a link mark's href, else a bare
 *  URL in the position's textblock (links.ts urlAt — same rules as `follow`). */
export function urlAtPos(view: EditorView, pos: number): string | null {
  const $pos = view.state.doc.resolve(pos);
  if (!$pos.parent.isTextblock) return null;
  // link mark on the exact position's node
  const idx = $pos.index();
  const child = idx < $pos.parent.childCount ? $pos.parent.child(idx) : null;
  const link = child?.marks.find((m) => m.type.name === "link");
  if (link?.attrs.href) return link.attrs.href as string;
  const text = $pos.parent.textBetween(0, $pos.parent.content.size, "\n", " ");
  return urlAt(text, $pos.parentOffset);
}

const rootOf = (view: EditorView): HTMLElement | null =>
  view.dom.closest(".av-editor") as HTMLElement | null;

export const LinkClick = Extension.create<LinkClickOptions>({
  name: "nsLinkClick",

  addOptions() {
    return { onOpenUrl: () => {} };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin({
        key: new PluginKey("nsLinkClick"),
        props: {
          handleDOMEvents: {
            mousedown: (view, e) => {
              if (e.button !== 0 || !modActive(e)) return false;
              const pos = view.posAtCoords({ left: e.clientX, top: e.clientY });
              if (!pos) return false;
              const url = urlAtPos(view, pos.pos);
              if (!url) return false;
              e.preventDefault();
              options.onOpenUrl(url);
              return true;
            },
            keydown: (view, e) => {
              if (isModKey(e.key)) rootOf(view)?.classList.add("is-mod");
              return false;
            },
            keyup: (view, e) => {
              if (isModKey(e.key)) rootOf(view)?.classList.remove("is-mod");
              return false;
            },
            blur: (view) => {
              rootOf(view)?.classList.remove("is-mod");
              return false;
            },
          },
        },
      }),
    ];
  },
});
