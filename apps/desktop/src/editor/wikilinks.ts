// CodeMirror integration for `[[wikilinks]]`: a decoration plugin that styles
// them as links and (in live-preview, off the cursor line) hides the `[[ ]]`
// syntax — mirroring live-preview.ts — plus a `[[`-triggered autocompletion over
// the notebook's note titles. The document is never rewritten, so `gf` and vim
// motions still operate on the literal `[[Target]]` text.
import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { parseWikilinks } from "../links";
import { activeLines, activeLinesKey } from "./live-preview";

const linkMark = Decoration.mark({ class: "cm-wikilink" });
const hide = Decoration.replace({});

function build(view: EditorView, preview: boolean): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  const active = activeLines(view);
  const { doc } = view.state;
  for (const { from, to } of view.visibleRanges) {
    const last = doc.lineAt(to).number;
    for (let n = doc.lineAt(from).number; n <= last; n++) {
      const line = doc.line(n);
      const reveal = !preview || active.has(n);
      for (const l of parseWikilinks(line.text)) {
        const s = line.from + l.from;
        const e = line.from + l.to;
        if (reveal) {
          b.add(s, e, linkMark); // show the literal [[...]], just accented
          continue;
        }
        b.add(s, s + 2, hide); // [[
        if (l.display !== null) {
          const pipe = line.from + line.text.indexOf("|", l.from);
          b.add(s + 2, pipe + 1, hide); // target|
          b.add(pipe + 1, e - 2, linkMark); // display text
        } else {
          b.add(s + 2, e - 2, linkMark); // target text
        }
        b.add(e - 2, e, hide); // ]]
      }
    }
  }
  return b.finish();
}

export function wikilinks(preview: boolean) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      activeKey: string;
      constructor(view: EditorView) {
        this.activeKey = activeLinesKey(view);
        this.decorations = build(view, preview);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) {
          this.activeKey = activeLinesKey(u.view);
          this.decorations = build(u.view, preview);
        } else if (preview && u.selectionSet) {
          // Outside preview the decorations ignore the selection entirely; in
          // preview, rebuild only when the revealed-line set changed (see
          // livePreview — same post-update key compare).
          const key = activeLinesKey(u.view);
          if (key === this.activeKey) return;
          this.activeKey = key;
          this.decorations = build(u.view, preview);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
}

// Pre-lowered titles, cached per linkTargets array identity — the array is only
// re-created when the note list changes, so each `[[` trigger reuses the cache
// instead of re-lowercasing every title.
const loweredCache = new WeakMap<readonly string[], { title: string; lower: string }[]>();
function loweredTargets(targets: string[]): { title: string; lower: string }[] {
  let entries = loweredCache.get(targets);
  if (!entries) {
    entries = targets.map((t) => ({ title: t, lower: t.toLowerCase() }));
    loweredCache.set(targets, entries);
  }
  return entries;
}

// `[[`-triggered completion over the notebook's note titles (read live via
// `getTargets`, since the editor is mounted once but the note list changes).
export function wikilinkComplete(getTargets: () => string[]) {
  return autocompletion({
    override: [
      (ctx: CompletionContext): CompletionResult | null => {
        // `[^\]\n|]*$` stops the run at any existing `]` or `|`, so we only ever
        // complete the target (never the display half of [[a|b]]).
        const before = ctx.matchBefore(/\[\[[^\]\n|]*$/);
        if (!before || ctx.pos < before.from + 2) return null;
        const typed = before.text.slice(2).toLowerCase();
        // ALL matches, uncapped: CM caps rendering itself, and `validFor`
        // refines within this list — a cap would make later notes unreachable.
        const options: Completion[] = [];
        for (const { title, lower } of loweredTargets(getTargets())) {
          if (typed && !lower.includes(typed)) continue;
          options.push({
            label: title,
            type: "text",
            // append only the brackets that aren't already there, so re-picking
            // inside an existing [[link]] can't produce `]]]]`.
            apply: (view: EditorView, _c: Completion, from: number, to: number) => {
              const next2 = view.state.sliceDoc(to, to + 2);
              const close = next2 === "]]" ? "" : next2[0] === "]" ? "]" : "]]";
              view.dispatch({
                changes: { from, to, insert: title + close },
                selection: { anchor: from + title.length + 2 },
              });
            },
          });
        }
        if (!options.length) return null;
        return { from: before.from + 2, options, validFor: /^[^\]\n|]*$/ };
      },
    ],
  });
}
