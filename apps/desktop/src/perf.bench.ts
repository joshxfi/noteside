// JS-side hot-path baselines (run: `pnpm --filter @noteside/desktop bench`).
// scanBlocks runs on EVERY doc change while live preview is on (the
// block-preview StateField re-derives tables/fences/quotes from the raw lines) —
// this pins the per-keystroke cost on a large, block-heavy note.
import { bench, describe } from "vitest";
import { parseInline, scanBlocks } from "./markdown";

function buildMarkdownDoc(lines: number): string[] {
  const out: string[] = [];
  for (let i = 0; out.length < lines; i++) {
    switch (i % 5) {
      case 0:
        out.push(`## Section ${i}`, "", `Some *prose* with a [link](https://x.dev) and \`code\`.`);
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

const cellText = "**bold** then *em* and `a | b` plus [x](https://x.dev) ";
describe("parseInline", () => {
  bench("mixed table cell", () => {
    parseInline(cellText);
  });
});
