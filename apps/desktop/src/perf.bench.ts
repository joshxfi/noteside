// JS-side hot-path baselines (run: `pnpm --filter @noteside/desktop bench`).
// scanBlocks runs on EVERY doc change while live preview is on (the
// block-preview StateField re-derives tables/fences/quotes from the raw lines) —
// this pins the per-keystroke cost on a large, block-heavy note.
import { bench, describe } from "vitest";
import { ChangeSet, Text } from "@codemirror/state";
import { parseInline, scanBlocks } from "./markdown";
import { countWordsIn, wordCountDelta } from "./editor/word-count";

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

// The status bar's word counter runs on EVERY doc change. The delta path should
// be flat in document size; the full rescan it replaced is the comparison arm.
for (const n of [1000, 10000]) {
  const doc = Text.of(buildMarkdownDoc(n));
  const text = doc.toString();
  const at = doc.line(Math.floor(n / 2)).from;
  const typed = ChangeSet.of({ from: at, to: at, insert: "x" }, doc.length);
  const after = typed.apply(doc);
  describe(`word count N=${n} lines`, () => {
    bench("delta (one typed character)", () => {
      wordCountDelta(typed, doc, after);
    });
    bench("full rescan (the old per-keystroke path)", () => {
      countWordsIn(text);
    });
  });
}
