// JS-side hot-path baselines (run: `pnpm --filter @noteside/desktop bench`).
// computeBacklinks resolves every wikilink in every body against the note list,
// so it scales ~O(docs × links × notes) — this measures where that hurts.
import { bench, describe } from "vitest";
import type { NoteDoc, NoteMeta } from "./backend";
import { computeBacklinks, parseWikilinks } from "./links";

function build(n: number): { notes: NoteMeta[]; docs: NoteDoc[] } {
  const notes: NoteMeta[] = [];
  const docs: NoteDoc[] = [];
  for (let i = 0; i < n; i++) {
    const path = `note-${i}.md`;
    const meta: NoteMeta = {
      id: path,
      path,
      title: `Note ${i}`,
      tags: [],
      created: null,
      updated: i,
      pinned: false,
    };
    notes.push(meta);
    const filler = Array.from({ length: 30 }, (_, l) => `filler line ${l} with several words`).join(
      "\n",
    );
    // every note links to its neighbour and to Note 0 (the backlinks target)
    const body = `# Note ${i}\n\nsee [[Note ${(i + 1) % n}]] and [[Note 0]].\n${filler}`;
    docs.push({ ...meta, body });
  }
  return { notes, docs };
}

for (const n of [500, 2000, 5000]) {
  const { notes, docs } = build(n);
  describe(`computeBacklinks N=${n}`, () => {
    bench("backlinks to Note 0 (links from every note)", () => {
      computeBacklinks("note-0.md", docs, notes);
    });
  });
}

const longLine = "intro [[A]] then [[B|display]] then [[C]] and more text ".repeat(20);
describe("parseWikilinks", () => {
  bench("3 links/line × 20", () => {
    parseWikilinks(longLine);
  });
});
