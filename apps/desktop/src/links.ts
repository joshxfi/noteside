// Wikilinks: `[[Target]]` / `[[Target|Display]]`. Pure logic — parsing,
// resolving a target to a note, the link under a cursor, and backlinks. Kept
// free of CodeMirror/React so it's unit-testable and reused by the editor
// decorations, the `gf` follow command, and the backlinks panel.
import type { NoteDoc, NoteMeta } from "./backend";

export interface WikiLink {
  target: string;
  display: string | null;
  from: number; // offset within the scanned string
  to: number;
}

// Target/display contain no brackets, pipes, or newlines.
const WIKILINK = /\[\[([^[\]|\n]+?)(?:\|([^[\]|\n]+?))?\]\]/g;

export function parseWikilinks(text: string): WikiLink[] {
  const re = new RegExp(WIKILINK.source, "g");
  const out: WikiLink[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push({
      target: m[1].trim(),
      display: m[2] ? m[2].trim() : null,
      from: m.index,
      to: m.index + m[0].length,
    });
  }
  return out;
}

/** The wikilink target at column `col` within a single line, or null. */
export function wikilinkAt(line: string, col: number): string | null {
  for (const l of parseWikilinks(line)) {
    if (col >= l.from && col < l.to) return l.target; // half-open: not the col past ]]
  }
  return null;
}

const norm = (s: string) => s.trim().toLowerCase();
const slug = (s: string) =>
  norm(s)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");

/** Resolve a target to a note by decreasing specificity: exact title, exact
 *  filename, filename slug, title slug. Empty keys (punctuation-only targets,
 *  blank titles) never match, and the ordered passes make ties deterministic. */
export function resolveLink(target: string, notes: NoteMeta[]): NoteMeta | null {
  const t = norm(target).replace(/\.md$/i, "");
  const ts = slug(target);
  if (!t && !ts) return null;
  return (
    (t ? notes.find((n) => norm(n.title) === t) : undefined) ??
    (t ? notes.find((n) => norm(baseName(n.path)) === t) : undefined) ??
    (ts ? notes.find((n) => slug(baseName(n.path)) === ts) : undefined) ??
    (ts ? notes.find((n) => slug(n.title) === ts) : undefined) ??
    null
  );
}

export interface Backlink {
  id: string;
  title: string;
  lineNumber: number;
  line: string;
}

/** Notes (other than `activeId`) whose body has a wikilink resolving to it. */
export function computeBacklinks(activeId: string, docs: NoteDoc[], notes: NoteMeta[]): Backlink[] {
  const out: Backlink[] = [];
  for (const doc of docs) {
    if (doc.id === activeId) continue;
    const lines = doc.body.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const hit = parseWikilinks(lines[i]).some(
        (l) => resolveLink(l.target, notes)?.id === activeId,
      );
      if (hit) {
        out.push({ id: doc.id, title: doc.title, lineNumber: i + 1, line: lines[i].trim() });
        break; // one reference line per note
      }
    }
  }
  return out;
}
