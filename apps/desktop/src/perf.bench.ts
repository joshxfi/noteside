// JS-side hot-path baselines (run: `pnpm --filter @noteside/desktop bench`).
import { bench, describe } from "vitest";
import { getSchema } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { EditorState } from "@tiptap/pm/state";
import { parseInline, scanBlocks } from "./markdown";
import { docWordCount, transactionWordDelta } from "./editor/pm-doc";

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

// Markdown parse (open-time) and serialize (autosave-time) — the two O(doc)
// costs the editor pays per note. Parse gates the open; serialize runs on the
// 800ms autosave debounce (never per keystroke — the onChange thunk defers it).
import { Markdown, MarkdownManager } from "@tiptap/markdown";
const manager = new MarkdownManager({ extensions: [StarterKit, Markdown] });
for (const n of [1000, 10000]) {
  const md = buildMarkdownDoc(n).join("\n");
  const parsed = manager.parse(md);
  describe(`markdown io N=${n} lines`, () => {
    bench("manager.parse (open-time)", () => {
      manager.parse(md);
    });
    bench("manager.serialize (autosave-time)", () => {
      manager.serialize(parsed);
    });
  });
}

// The status bar's word counter runs on EVERY doc change. The delta path should
// be flat in document size; the full rescan it replaced is the comparison arm.
const schema = getSchema([StarterKit]);
for (const n of [1000, 10000]) {
  const doc = schema.node(
    "doc",
    null,
    buildMarkdownDoc(n).map((l) => schema.node("paragraph", null, l ? [schema.text(l)] : [])),
  );
  const state = EditorState.create({ schema, doc });
  // Type one character in the middle of the doc.
  const mid = Math.floor(doc.content.size / 2);
  const typed = state.tr.insertText("x", mid, mid);
  describe(`word count N=${n} blocks`, () => {
    bench("delta (one typed character)", () => {
      transactionWordDelta(typed);
    });
    bench("full rescan (the old per-keystroke path)", () => {
      docWordCount(typed.doc);
    });
  });
}
