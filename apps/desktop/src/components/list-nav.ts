// list-nav.ts — tiny shared helpers for the keyboard-driven lists (finder,
// command palette, theme picker, notebook switcher, sidebar). No React.

/** True if `q` is a subsequence of `text` (the overlays' fuzzy filter). */
export function subseq(q: string, text: string): boolean {
  if (!q) return true;
  const t = text.toLowerCase();
  let i = 0;
  for (let j = 0; j < t.length && i < q.length; j++) if (t[j] === q[i]) i++;
  return i === q.length;
}

// The last known global mouse position (capture-phase, so it updates before any
// React handler sees the same event). Seeds pointerMoved() baselines so an
// overlay MOUNTING under a stationary cursor can compare its first synthetic
// hover event against where the mouse already was.
let lastMouseX = -1;
let lastMouseY = -1;
if (typeof document !== "undefined") {
  document.addEventListener(
    "mousemove",
    (e) => {
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
    },
    { capture: true, passive: true },
  );
}

/**
 * A guard that tells REAL pointer movement apart from the synthetic hover
 * events the browser re-dispatches under a STATIONARY cursor — after a
 * programmatic scroll (keyboard nav shifts rows under the pointer) or when an
 * overlay mounts beneath a parked cursor. Acting on those would steal the
 * selection from the keyboard (or clobber an overlay's deliberate initial
 * selection, e.g. the theme picker's open-on-current-theme). Returns true only
 * when the coordinates actually changed; the baseline starts at the last known
 * global mouse position so the mount-time synthetic event is ignored too.
 */
export function pointerMoved(): (e: { clientX: number; clientY: number }) => boolean {
  let x = lastMouseX;
  let y = lastMouseY;
  return (e) => {
    if (e.clientX === x && e.clientY === y) return false;
    x = e.clientX;
    y = e.clientY;
    return true;
  };
}

/**
 * Scroll `container` the minimum amount to bring its `index`-th child into view.
 *
 * Measured with rects, deliberately: `offsetTop` is relative to the nearest
 * POSITIONED ancestor, which for every one of these lists is some outer scrim or
 * panel — not the scroll container. Comparing that against `scrollTop` left a
 * constant offset baked in, so scrolling back up never fired and scrolling down
 * overshot. Rects are in the same viewport space for both nodes, so their
 * difference is exactly the amount to scroll no matter where the offsetParent is.
 */
export function scrollRowIntoView(container: HTMLElement | null, index: number): void {
  const el = container?.children[index] as HTMLElement | undefined;
  if (!container || !el) return;
  const box = container.getBoundingClientRect();
  const row = el.getBoundingClientRect();
  // clientTop/clientHeight step past the border to the padding box — the region
  // that actually scrolls — so a row tucked under a 1px border still counts as
  // out of view.
  const top = box.top + container.clientTop;
  const bottom = top + container.clientHeight;
  if (row.top < top) container.scrollTop -= top - row.top;
  else if (row.bottom > bottom) container.scrollTop += row.bottom - bottom;
}
