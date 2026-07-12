// Pure link/slug helpers — no CodeMirror/React, so they're unit-testable and
// shared across the editor, backends, and tests. Two concerns:
//   • the openable external URL under a cursor (`gx` / `:follow`), and
//   • filename ⇄ title slugging for rename-on-save.

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
 *  `[…](…)` span (the visible text included) opens its url; half-open column
 *  rule (the column past the URL's last char is "outside"). Reuses the
 *  module-level /g regexes (reset at entry) — synchronous and non-reentrant. */
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

// ── filename ⇄ title slugging (rename-on-save) ────────────────────────────
// The JS mirror of notebook.rs `slugify`/`stem_matches_slug`, shared by the mock
// backend and tests so the rules live in exactly one TS place.

const norm = (s: string) => s.trim().toLowerCase();
const slug = (s: string) =>
  norm(s)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** A filesystem-safe slug for a note title (never empty — falls back to "untitled"). */
export const slugifyTitle = (title: string): string => slug(title) || "untitled";

/** True if a filename stem already represents `s` — exactly, or as a `<s>-N`
 *  collision variant — so rename-on-save can skip a file that's already correct. */
export function stemMatchesSlug(stem: string, s: string): boolean {
  if (stem === s) return true;
  const rest = stem.startsWith(`${s}-`) ? stem.slice(s.length + 1) : null;
  return rest !== null && /^\d+$/.test(rest);
}
