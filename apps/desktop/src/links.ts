// Wikilinks: `[[Target]]` / `[[Target|Display]]`. Pure logic — parsing,
// resolving a target to a note, the link under a cursor, and backlinks. Kept
// free of CodeMirror/React so it's unit-testable and reused by the editor
// decorations, the `gf` follow command, and the backlinks panel.
import type { Backlink, NoteDoc, NoteMeta } from "./backend";

export type { Backlink };

export interface WikiLink {
  target: string;
  display: string | null;
  from: number; // offset within the scanned string
  to: number;
}

// Target/display contain no brackets, pipes, or newlines.
// Shared stateful /g regex: parseWikilinks is synchronous and non-reentrant, so
// resetting lastIndex at entry is safe — and avoids a RegExp allocation on a
// call made once per visible line per editor update.
const WIKILINK = /\[\[([^[\]|\n]+?)(?:\|([^[\]|\n]+?))?\]\]/g;

export function parseWikilinks(text: string): WikiLink[] {
  if (!text.includes("[[")) return [];
  WIKILINK.lastIndex = 0;
  const out: WikiLink[] = [];
  let m: RegExpExecArray | null;
  while ((m = WIKILINK.exec(text))) {
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

// External links the follow command can open in the browser: bare http(s)/mailto
// URLs and markdown `[text](url)` targets. Only these schemes are ever returned,
// so a relative markdown target (`./note.md`) is treated as "not a URL".
const URL_SCHEME = /^(?:https?|mailto):/i;
const MD_LINK = /\[[^\]\n]*\]\(([^()\s]+)\)/g;
const BARE_URL = /(?:https?:\/\/|mailto:)[^\s<>[\]()]+/gi;

// Drop trailing punctuation a URL wouldn't really end with — sentence marks, and
// a closing paren only when it has no matching open paren inside the URL.
function trimUrl(url: string): string {
  let u = url;
  while (u.length > 0) {
    const last = u[u.length - 1];
    if (".,;:!?'\"".includes(last)) u = u.slice(0, -1);
    else if (last === ")" && !u.includes("(")) u = u.slice(0, -1);
    else break;
  }
  return u;
}

/** The openable external URL at column `col` within a single line, or null.
 *  Markdown `[text](url)` takes precedence over the bare scan so the whole
 *  `[…](…)` span (the visible text included) opens its url; same half-open
 *  column rule as `wikilinkAt`. Reuses the module-level /g regexes (reset at
 *  entry) — synchronous and non-reentrant, like `parseWikilinks`. */
export function urlAt(line: string, col: number): string | null {
  MD_LINK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MD_LINK.exec(line))) {
    if (col >= m.index && col < m.index + m[0].length) {
      return URL_SCHEME.test(m[1]) ? m[1] : null;
    }
  }
  BARE_URL.lastIndex = 0;
  while ((m = BARE_URL.exec(line))) {
    const url = trimUrl(m[0]);
    if (col >= m.index && col < m.index + url.length) return url;
  }
  return null;
}

const norm = (s: string) => s.trim().toLowerCase();
const slug = (s: string) =>
  norm(s)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");

// ── filename ⇄ title slugging (rename-on-save) ────────────────────────────
// The JS mirror of notebook.rs `slugify`/`stem_matches_slug`, shared by the mock
// backend and tests so the rules live in exactly one TS place. (`slug` above stays
// fallback-free on purpose — an empty resolution key must never match.)

/** A filesystem-safe slug for a note title (never empty — falls back to "untitled"). */
export const slugifyTitle = (title: string): string => slug(title) || "untitled";

/** True if a filename stem already represents `s` — exactly, or as a `<s>-N`
 *  collision variant — so rename-on-save can skip a file that's already correct. */
export function stemMatchesSlug(stem: string, s: string): boolean {
  if (stem === s) return true;
  const rest = stem.startsWith(`${s}-`) ? stem.slice(s.length + 1) : null;
  return rest !== null && /^\d+$/.test(rest);
}

// The four resolution indexes, one per specificity tier. Built with
// insert-if-absent so the FIRST note owns a contested key — the map equivalent
// of `notes.find`, keeping ties deterministic. Empty keys (blank titles,
// punctuation-only slugs) are never inserted, so they can never match.
interface ResolveMaps {
  byTitle: Map<string, NoteMeta>;
  byFile: Map<string, NoteMeta>;
  byFileSlug: Map<string, NoteMeta>;
  byTitleSlug: Map<string, NoteMeta>;
}

function buildResolveMaps(notes: NoteMeta[]): ResolveMaps {
  const maps: ResolveMaps = {
    byTitle: new Map(),
    byFile: new Map(),
    byFileSlug: new Map(),
    byTitleSlug: new Map(),
  };
  const put = (map: Map<string, NoteMeta>, key: string, n: NoteMeta) => {
    if (key && !map.has(key)) map.set(key, n);
  };
  for (const n of notes) {
    const file = baseName(n.path);
    put(maps.byTitle, norm(n.title), n);
    put(maps.byFile, norm(file), n);
    put(maps.byFileSlug, slug(file), n);
    put(maps.byTitleSlug, slug(n.title), n);
  }
  return maps;
}

function resolveWithMaps(target: string, maps: ResolveMaps): NoteMeta | null {
  const t = norm(target).replace(/\.md$/i, "");
  const ts = slug(target);
  if (!t && !ts) return null;
  return (
    (t ? maps.byTitle.get(t) : undefined) ??
    (t ? maps.byFile.get(t) : undefined) ??
    (ts ? maps.byFileSlug.get(ts) : undefined) ??
    (ts ? maps.byTitleSlug.get(ts) : undefined) ??
    null
  );
}

/** Resolve a target to a note by decreasing specificity: exact title, exact
 *  filename, filename slug, title slug. Empty keys (punctuation-only targets,
 *  blank titles) never match, and the ordered tiers (first note wins within a
 *  tier) make ties deterministic. */
export function resolveLink(target: string, notes: NoteMeta[]): NoteMeta | null {
  return resolveWithMaps(target, buildResolveMaps(notes));
}

/** Notes (other than `activeId`) whose body has a wikilink resolving to it.
 *  The resolution maps are built once per call, so the scan is ~O(docs × links)
 *  instead of O(docs × links × notes). */
export function computeBacklinks(activeId: string, docs: NoteDoc[], notes: NoteMeta[]): Backlink[] {
  const maps = buildResolveMaps(notes);
  const out: Backlink[] = [];
  for (const doc of docs) {
    if (doc.id === activeId) continue;
    const lines = doc.body.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const hit = parseWikilinks(lines[i]).some(
        (l) => resolveWithMaps(l.target, maps)?.id === activeId,
      );
      if (hit) {
        out.push({ id: doc.id, title: doc.title, lineNumber: i + 1, line: lines[i].trim() });
        break; // one reference line per note
      }
    }
  }
  return out;
}
