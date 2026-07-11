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

// scanBlocks runs on EVERY doc change while live preview is on (the
// block-preview StateField re-derives tables/fences/quotes from the raw
// lines) — this pins the per-keystroke cost on a large, block-heavy note.
import { parseInline, scanBlocks } from "./markdown";

function buildMarkdownDoc(lines: number): string[] {
  const out: string[] = [];
  for (let i = 0; out.length < lines; i++) {
    switch (i % 5) {
      case 0:
        out.push(`## Section ${i}`, "", `Some *prose* with a [[Note ${i}]] link and \`code\`.`);
        break;
      case 1:
        out.push("| # | Finding | Effort |", "|---|---|---|");
        for (let r = 0; r < 4; r++) out.push(`| ${r} | **item ${r}** with \`x\` | Low |`);
        out.push("");
        break;
      case 2:
        out.push("```ts");
        for (let r = 0; r < 4; r++) out.push(`const v${r} = compute(${r});`);
        out.push("```", "");
        break;
      case 3:
        out.push("> a quoted thought", "> across two lines", "");
        break;
      default:
        out.push("- [ ] a task", "- [x] a done task", "- a plain bullet", "");
    }
  }
  return out.slice(0, lines);
}

for (const n of [1000, 10000]) {
  const doc = buildMarkdownDoc(n);
  describe(`scanBlocks N=${n} lines`, () => {
    bench("tables + fences + quotes", () => {
      scanBlocks(doc);
    });
  });
}

const cellText = "**bold** then *em* and `a | b` plus [[Target|shown]] and [x](https://x.dev) ";
describe("parseInline", () => {
  bench("mixed table cell", () => {
    parseInline(cellText);
  });
});
