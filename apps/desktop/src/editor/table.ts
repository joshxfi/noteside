// table.ts — GFM pipe tables. TableKit's pieces, with one fidelity fix: the
// stock serializer never escapes literal `|` inside cell text, so a cell
// containing a pipe corrupts on the next parse (the cell splits). The escape
// wrapper below applies GFM's `\|` rule to every serialized cell — matching
// the parse-side preprocessor the extension already ships (which expects `\|`
// even inside code spans, per the GFM spec's odd-but-true table rule).
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
  renderTableToMarkdown,
} from "@tiptap/extension-table";
import type { MarkdownRendererHelpers } from "@tiptap/core";

const escapeCellPipes = (s: string): string =>
  s.replace(/\\\||\|/g, (m) => (m === "|" ? "\\|" : m));

const NsTable = Table.extend({
  renderMarkdown(node, h) {
    const escaped: MarkdownRendererHelpers = {
      ...h,
      renderChildren: (nodes, separator) => escapeCellPipes(h.renderChildren(nodes, separator)),
    };
    return renderTableToMarkdown(node, escaped);
  },
});

export function tableExtensions() {
  return [NsTable, TableRow, TableHeader, TableCell];
}
