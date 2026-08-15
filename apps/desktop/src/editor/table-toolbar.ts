// table-toolbar.ts — the floating row/column toolbar shown while the caret is
// inside a table: the POINTER path for table structure ops (the parity rule).
// One shared plain-DOM element (no per-table React, like hover-handle.ts), and
// a thin dispatcher: every button runs the same command-table entry the
// palette and the ex bar dispatch, so the surfaces cannot drift.
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { COMMAND_BY_ID, type Command } from "./commands";

export interface TableToolbarOptions {
  dispatch: (cmd: Command) => void;
}

const BUTTONS: [id: string, label: string][] = [
  ["tableAddRow", "+ row"],
  ["tableDelRow", "− row"],
  ["tableAddCol", "+ col"],
  ["tableDelCol", "− col"],
];

/** The caret's enclosing table position, or null. */
function tablePosAt(view: EditorView): number | null {
  const $head = view.state.selection.$head;
  for (let d = $head.depth; d >= 1; d--) {
    if ($head.node(d).type.name === "table") return $head.before(d);
  }
  return null;
}

export const TableToolbar = Extension.create<TableToolbarOptions>({
  name: "nsTableToolbar",

  addOptions() {
    return { dispatch: () => {} };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin({
        key: new PluginKey("nsTableToolbar"),
        view(view) {
          const bar = document.createElement("div");
          bar.className = "av-tablebar";
          for (const [id, label] of BUTTONS) {
            const cmd = COMMAND_BY_ID[id];
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "av-tablebar-btn";
            btn.textContent = label;
            btn.title = `${cmd.title}${cmd.ex?.[0] ? ` (:${cmd.ex[0]})` : ""}`;
            // keep the editor focused (Chromium focuses buttons on click)
            btn.addEventListener("mousedown", (e) => e.preventDefault());
            btn.addEventListener("click", () => options.dispatch(cmd));
            bar.appendChild(btn);
          }
          // The plugin view is constructed BEFORE EditorContent attaches
          // view.dom to the page, so the host can't be resolved here — attach
          // lazily on the first update that runs with a mounted DOM (and hook
          // the scroller for repositioning at the same moment).
          let raf = 0;
          const onScroll = () => {
            if (raf) return;
            raf = requestAnimationFrame(() => {
              raf = 0;
              place();
            });
          };
          let scroller: Element | null = null;
          const ensureMounted = (): HTMLElement | null => {
            if (bar.isConnected) return bar.parentElement;
            const host = view.dom.closest(".av-cm") as HTMLElement | null;
            if (!host) return null;
            host.appendChild(bar);
            scroller = host.querySelector(".av-editor-scroll");
            scroller?.addEventListener("scroll", onScroll, { passive: true });
            return host;
          };

          function place() {
            const host = ensureMounted();
            const pos = host ? tablePosAt(view) : null;
            const dom = pos !== null ? (view.nodeDOM(pos) as HTMLElement | null) : null;
            if (!host || !dom) {
              bar.classList.remove("is-visible");
              return;
            }
            const rect = dom.getBoundingClientRect();
            const hostRect = host.getBoundingClientRect();
            bar.style.left = `${Math.max(2, rect.left - hostRect.left)}px`;
            bar.style.top = `${Math.max(2, rect.top - hostRect.top - 30)}px`;
            bar.classList.add("is-visible");
          }

          place();
          return {
            update: place,
            destroy() {
              if (raf) cancelAnimationFrame(raf);
              scroller?.removeEventListener("scroll", onScroll);
              bar.remove();
            },
          };
        },
      }),
    ];
  },
});
