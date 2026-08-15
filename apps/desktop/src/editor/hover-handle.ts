// hover-handle.ts — ONE shared drag grip for the hovered top-level block.
// mousemove repositions a single absolutely-positioned element (no per-block
// React state or DOM — the AGENTS.md pointer-affordance rule); mousedown
// node-selects the block so ProseMirror's native drag machinery moves it.
import { Extension } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

const GRIP_TEXT = "⋮⋮";

function topLevelPosAt(view: EditorView, coords: { left: number; top: number }): number | null {
  const hit = view.posAtCoords(coords);
  if (!hit) return null;
  // inside a block: depth ≥ 1 → the child index at depth 0 gives its start
  const $pos = view.state.doc.resolve(hit.pos);
  if ($pos.depth === 0) {
    // between blocks — use the node right after when there is one
    const idx = $pos.index(0);
    if (idx >= view.state.doc.childCount) return null;
    let pos = 0;
    for (let k = 0; k < idx; k++) pos += view.state.doc.child(k).nodeSize;
    return pos;
  }
  return $pos.before(1);
}

export const HoverHandle = Extension.create({
  name: "nsHoverHandle",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("nsHoverHandle"),
        view(view) {
          const grip = document.createElement("div");
          grip.className = "av-grip";
          grip.textContent = GRIP_TEXT;
          grip.title = "drag to move block";
          grip.setAttribute("draggable", "true");
          let gripPos: number | null = null;

          // view.dom is not on the page yet when the plugin view constructs
          // (EditorContent attaches it afterwards) — resolve the host lazily
          // on the first pointer move, which can only happen post-mount.
          const ensureHost = (): HTMLElement | null => {
            if (grip.isConnected) return grip.parentElement;
            const host = view.dom.closest(".av-cm") as HTMLElement | null;
            host?.appendChild(grip);
            return host;
          };

          const hide = () => {
            grip.classList.remove("is-visible");
            gripPos = null;
          };

          const onMove = (e: MouseEvent) => {
            // never while dragging, and not for hovers over the grip itself
            if (e.buttons !== 0 || grip.contains(e.target as Node)) return;
            const host = ensureHost();
            const pos = topLevelPosAt(view, { left: e.clientX + 40, top: e.clientY });
            if (pos === null) {
              hide();
              return;
            }
            const node = view.state.doc.nodeAt(pos);
            if (!node) {
              hide();
              return;
            }
            const dom = view.nodeDOM(pos) as HTMLElement | null;
            if (!dom || !host) return;
            // Viewport-rect deltas: .av-cm doesn't scroll itself (the inner
            // EditorContent wrapper does), so no scrollTop bookkeeping.
            const rect = dom.getBoundingClientRect();
            const hostRect = host.getBoundingClientRect();
            grip.style.top = `${rect.top - hostRect.top}px`;
            grip.style.left = `${Math.max(2, rect.left - hostRect.left - 26)}px`;
            grip.classList.add("is-visible");
            gripPos = pos;
          };

          // Node-select on grab so PM's own drag handling moves the block.
          const onGripDown = () => {
            if (gripPos === null) return;
            const tr = view.state.tr.setSelection(NodeSelection.create(view.state.doc, gripPos));
            view.dispatch(tr);
          };
          const onGripDragStart = (e: DragEvent) => {
            if (gripPos === null) return;
            // Delegate to PM: synthesize the drag from the selected node
            const sel = view.state.selection;
            if (!(sel instanceof NodeSelection)) return;
            const slice = sel.content();
            view.dragging = { slice, move: true };
            const dom = view.nodeDOM(gripPos) as HTMLElement | null;
            if (dom && e.dataTransfer) {
              e.dataTransfer.setDragImage(dom, 0, 0);
              e.dataTransfer.setData("text/plain", dom.textContent ?? "");
              e.dataTransfer.effectAllowed = "move";
            }
          };

          // Listen on view.dom (always available); the grip itself hangs off
          // .av-cm so its absolute positioning has the right containing block.
          view.dom.addEventListener("mousemove", onMove);
          view.dom.addEventListener("mouseleave", hide);
          grip.addEventListener("mousedown", onGripDown);
          grip.addEventListener("dragstart", onGripDragStart);

          return {
            destroy() {
              view.dom.removeEventListener("mousemove", onMove);
              view.dom.removeEventListener("mouseleave", hide);
              grip.remove();
            },
          };
        },
      }),
    ];
  },
});
