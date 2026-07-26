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
