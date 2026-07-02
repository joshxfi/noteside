// list-nav.ts — tiny shared helpers for the keyboard-driven list overlays
// (command palette, theme picker). Pure, no React.

/** True if `q` is a subsequence of `text` (the overlays' fuzzy filter). */
export function subseq(q: string, text: string): boolean {
  if (!q) return true;
  const t = text.toLowerCase();
  let i = 0;
  for (let j = 0; j < t.length && i < q.length; j++) if (t[j] === q[i]) i++;
  return i === q.length;
}

/** Scroll `container` the minimum amount to bring its `index`-th child into view. */
export function scrollRowIntoView(container: HTMLElement | null, index: number): void {
  const el = container?.children[index] as HTMLElement | undefined;
  if (!container || !el) return;
  const top = el.offsetTop;
  const bottom = top + el.offsetHeight;
  if (top < container.scrollTop) container.scrollTop = top;
  else if (bottom > container.scrollTop + container.clientHeight) {
    container.scrollTop = bottom - container.clientHeight;
  }
}
