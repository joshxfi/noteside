// slash-menu.ts — Notion's `/` block-insertion menu, on @tiptap/suggestion.
// Typing "/" at the start of a line opens a filtered list of block types;
// list-nav.ts's subseq is the filter (the finder/palette/theme-picker fuzzy),
// ↑↓ + Ctrl-n/p move, Enter inserts, Esc closes. Plain-DOM popup — no React,
// no floating-ui: positioned from the caret rect, styled by .av-slash* rules.
import { Extension } from "@tiptap/core";
import type { Editor, Range } from "@tiptap/core";
import { Suggestion } from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import { subseq } from "../components/list-nav";

interface SlashItem {
  title: string;
  hint: string;
  run: (editor: Editor, range: Range) => void;
}

const ITEMS: SlashItem[] = [
  {
    title: "Heading 1",
    hint: "#",
    run: (e, r) => e.chain().focus().deleteRange(r).setNode("heading", { level: 1 }).run(),
  },
  {
    title: "Heading 2",
    hint: "##",
    run: (e, r) => e.chain().focus().deleteRange(r).setNode("heading", { level: 2 }).run(),
  },
  {
    title: "Heading 3",
    hint: "###",
    run: (e, r) => e.chain().focus().deleteRange(r).setNode("heading", { level: 3 }).run(),
  },
  {
    title: "Bullet list",
    hint: "-",
    run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run(),
  },
  {
    title: "Numbered list",
    hint: "1.",
    run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run(),
  },
  {
    title: "Task list",
    hint: "- [ ]",
    run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run(),
  },
  {
    title: "Table",
    hint: "3×3",
    run: (e, r) =>
      e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    title: "Code block",
    hint: "```",
    run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run(),
  },
  {
    title: "Quote",
    hint: ">",
    run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run(),
  },
  {
    title: "Callout",
    hint: "> [!NOTE]",
    run: (e, r) => e.chain().focus().deleteRange(r).wrapIn("callout", { kind: "note" }).run(),
  },
  {
    title: "Math block",
    hint: "$$",
    run: (e, r) => e.chain().focus().deleteRange(r).insertBlockMath({ latex: "x" }).run(),
  },
  {
    title: "Divider",
    hint: "---",
    run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run(),
  },
];

class SlashPopup {
  private root: HTMLDivElement;
  private items: SlashItem[] = [];
  private selected = 0;
  private command: (item: SlashItem) => void = () => {};
  /** Esc closes the menu but the "/" text (and its suggestion session) remain —
   *  stay closed until that session exits, Notion-style. */
  dismissed = false;

  constructor() {
    this.root = document.createElement("div");
    this.root.className = "av-slash";
  }

  open(rect: DOMRect | null): void {
    document.body.appendChild(this.root);
    this.place(rect);
  }

  place(rect: DOMRect | null): void {
    if (!rect) return;
    const menuH = this.root.offsetHeight || 260;
    const below = rect.bottom + 6;
    const top = below + menuH > window.innerHeight ? Math.max(8, rect.top - menuH - 6) : below;
    this.root.style.top = `${top}px`;
    this.root.style.left = `${Math.min(rect.left, window.innerWidth - 280)}px`;
  }

  update(items: SlashItem[], command: (item: SlashItem) => void, rect: DOMRect | null): void {
    if (this.dismissed) return;
    if (!this.root.isConnected) document.body.appendChild(this.root);
    this.items = items;
    this.command = command;
    this.selected = Math.min(this.selected, Math.max(0, items.length - 1));
    this.render();
    this.place(rect);
  }

  private render(): void {
    this.root.textContent = "";
    if (this.items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "av-slash-empty";
      empty.textContent = "no matching block";
      this.root.appendChild(empty);
      return;
    }
    this.items.forEach((item, i) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "av-slash-row" + (i === this.selected ? " is-selected" : "");
      const title = document.createElement("span");
      title.className = "av-slash-title";
      title.textContent = item.title;
      const hint = document.createElement("span");
      hint.className = "av-slash-hint";
      hint.textContent = item.hint;
      row.append(title, hint);
      row.addEventListener("mousedown", (e) => e.preventDefault()); // keep editor focus
      row.addEventListener("click", () => this.command(item));
      this.root.appendChild(row);
    });
    this.root.children[this.selected]?.scrollIntoView({ block: "nearest" });
  }

  move(delta: number): void {
    if (!this.items.length) return;
    this.selected = (this.selected + delta + this.items.length) % this.items.length;
    this.render();
  }

  pick(): boolean {
    const item = this.items[this.selected];
    if (!item) return false;
    this.command(item);
    return true;
  }

  close(): void {
    this.root.remove();
    this.selected = 0;
  }
}

export const SlashMenu = Extension.create({
  name: "nsSlashMenu",

  addProseMirrorPlugins() {
    const editor = this.editor;
    let popup: SlashPopup | null = null;

    return [
      Suggestion<SlashItem>({
        pluginKey: new PluginKey("nsSlashMenu"),
        editor,
        char: "/",
        startOfLine: true,
        items: ({ query }) => ITEMS.filter((i) => subseq(query.toLowerCase(), i.title)),
        command: ({ editor: e, range, props }) => props.run(e, range),
        render: () => ({
          onStart(props) {
            popup = new SlashPopup();
            popup.open(props.clientRect?.() ?? null);
            popup.update(props.items, (item) => props.command(item), props.clientRect?.() ?? null);
          },
          onUpdate(props) {
            popup?.update(props.items, (item) => props.command(item), props.clientRect?.() ?? null);
          },
          onKeyDown({ event }) {
            if (!popup) return false;
            if (popup.dismissed) return false; // closed via Esc — keys act normally
            const key = event.key;
            if (key === "ArrowDown" || (event.ctrlKey && key === "n")) {
              popup.move(1);
              return true;
            }
            if (key === "ArrowUp" || (event.ctrlKey && key === "p")) {
              popup.move(-1);
              return true;
            }
            if (key === "Enter" || key === "Tab") {
              return popup.pick();
            }
            if (key === "Escape") {
              popup.dismissed = true;
              popup.close();
              return true;
            }
            return false;
          },
          onExit() {
            popup?.close();
            popup = null;
          },
        }),
      }),
    ];
  },
});
