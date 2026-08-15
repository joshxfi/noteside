// goto.ts — source line → ProseMirror position, for opening grep hits. The
// pure scanTopBlocks segmentation (markdown.ts) mirrors the parser's top-level
// tokenization (agreement pinned in goto.test.ts); any residual divergence
// clamps to the last block rather than missing.
import type { Node as PMNode } from "@tiptap/pm/model";
import { scanTopBlocks } from "../markdown";

/** The position just inside the doc child containing 1-based `bodyLine`. */
export function posForBodyLine(doc: PMNode, body: string, bodyLine: number): number | null {
  if (doc.childCount === 0) return null;
  const blocks = scanTopBlocks(body.split("\n"));
  if (blocks.length === 0) return null;
  const target = bodyLine - 1;
  let idx = blocks.findIndex((b) => target >= b.fromLine && target <= b.toLine);
  if (idx === -1) idx = target < blocks[0].fromLine ? 0 : blocks.length - 1;
  idx = Math.max(0, Math.min(idx, doc.childCount - 1));
  let pos = 0;
  for (let k = 0; k < idx; k++) pos += doc.child(k).nodeSize;
  return pos + 1;
}
