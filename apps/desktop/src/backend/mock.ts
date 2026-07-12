// In-memory backend for browser dev and the landing demo (no Tauri). Seeded
// from the sample notebook; search mirrors the Rust behaviour closely enough for
// the demo. Config/last-notebook persist to localStorage.
import { NOTES } from "../data";
import { slugifyTitle, stemMatchesSlug } from "../links";
import type { Config } from "../settings";
import type {
  Backend,
  ContentHit,
  FileHit,
  GrepMode,
  NoteDoc,
  NoteMeta,
  NotebookRef,
} from "./types";

interface Rec {
  meta: NoteMeta;
  body: string;
}
type FrecencyMap = Map<string, { s: number; t: number }>;
interface Notebook {
  recs: Map<string, Rec>;
  frecency: FrecencyMap;
  lastOpened: number;
}
type Seed = { path: string; title: string; body: string; tag?: string };

function seedRecs(notes: Seed[], baseTime: number): Map<string, Rec> {
  const m = new Map<string, Rec>();
  notes.forEach((n, i) => {
    m.set(n.path, {
      meta: {
        id: n.path,
        path: n.path,
        title: n.title,
        tags: n.tag ? [n.tag] : [],
        created: null,
        updated: baseTime - i * 3_600_000,
        pinned: false,
      },
      body: n.body,
    });
  });
  return m;
}

// A second demo notebook so the switcher (and switching) are exercisable in
// browser dev, the landing demo, and e2e. `/demo-notebook` stays the default that
// the boot flow + e2e open; it seeds from the shared NOTES.
const JOURNAL: Seed[] = [
  {
    path: "monday.md",
    title: "Monday",
    body: "# Monday\n\nStand-up notes and the week ahead.\n",
    tag: "log",
  },
  {
    path: "ideas.md",
    title: "Ideas",
    body: "# Ideas\n\n- a calmer inbox\n- revisit Monday's notes\n",
    tag: "log",
  },
];

const DEMO = "/demo-notebook";
const NOW0 = Date.now();
const demoNb: Notebook = { recs: seedRecs(NOTES, NOW0), frecency: new Map(), lastOpened: NOW0 };
const notebooks = new Map<string, Notebook>([
  [DEMO, demoNb],
  [
    "/demo-journal",
    { recs: seedRecs(JOURNAL, NOW0), frecency: new Map(), lastOpened: NOW0 - 3 * 86_400_000 },
  ],
]);

// `current` names the open notebook; `recs`/`frecency` are REBOUND (not copied) to
// its maps when it switches, so every helper below reads the live notebook through
// these bindings — mirroring the Rust `NotebookState::load` swap.
let current = DEMO;
let recs = demoNb.recs;
let frecency = demoNb.frecency;

// MRU order of notebook paths (front = most recent), mirroring the tauri store's
// `notebooks` array. `lastOpened` is display-only, so equal timestamps never
// reorder — the array is authoritative (a timestamp sort would tie in the demo).
const mru: string[] = [DEMO, "/demo-journal"];
function bump(path: string): void {
  const i = mru.indexOf(path);
  if (i >= 0) mru.splice(i, 1);
  mru.unshift(path);
}

const LS = (k: string) => `noteside:${k}`;

function notebookName(path: string): string {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

// Frecency (mirrors the Rust store): exponential decay with a 7-day half-life;
// each open adds 1 to the decayed score. In-memory only — the demo is ephemeral.
const HALF_LIFE_MS = 7 * 24 * 3_600_000;

function decayed(e: { s: number; t: number }, now: number): number {
  return e.s * Math.pow(0.5, (now - e.t) / HALF_LIFE_MS);
}
function frecencyOf(path: string, now: number): number {
  const e = frecency.get(path);
  return e ? decayed(e, now) : 0;
}

function metas(): NoteMeta[] {
  return [...recs.values()]
    .map((r) => r.meta)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated - a.updated);
}

function titleFromBody(text: string): string | null {
  for (const raw of text.split("\n")) {
    const t = raw
      .trim()
      .replace(/^#+\s*/, "")
      .trim();
    if (t) return t;
  }
  return null;
}

/** Rewrite the body so titleFromBody derives `newTitle` (mirrors Rust set_title,
 *  minus frontmatter — the demo notes use `# heading`): replace a leading heading,
 *  else prepend one. */
function setTitle(body: string, newTitle: string): string {
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    const hashes = lines[i].match(/^\s*(#+)/);
    if (hashes) {
      lines[i] = `${hashes[1]} ${newTitle}`;
      return lines.join("\n");
    }
    break; // first non-blank line isn't a heading → prepend
  }
  return `# ${newTitle}\n\n${body}`;
}

/** First free `<dir><slug>.md` / `<dir><slug>-N.md` key (mirrors unique_note_path). */
function uniquePath(dir: string, slug: string): string {
  let path = `${dir}${slug}.md`;
  let n = 2;
  while (recs.has(path)) path = `${dir}${slug}-${n++}.md`;
  return path;
}

function base(r: Rec): Omit<FileHit, "score" | "positions" | "titlePositions"> {
  return {
    id: r.meta.id,
    path: r.meta.path,
    title: r.meta.title,
    tags: r.meta.tags,
    pinned: r.meta.pinned,
  };
}

function subseq(hay: string, needle: string): { score: number; positions: number[] } | null {
  let qi = 0,
    score = 0,
    prev = -2;
  const positions: number[] = [];
  for (let i = 0; i < hay.length && qi < needle.length; i++) {
    if (hay[i] === needle[qi]) {
      positions.push(i);
      score += i === prev + 1 ? 8 : 4;
      if (i === 0 || /[/\s_\-.]/.test(hay[i - 1])) score += 6;
      prev = i;
      qi++;
    }
  }
  return qi === needle.length ? { score: score - hay.length * 0.05, positions } : null;
}

function fileSearch(query: string): FileHit[] {
  const q = query.trim().toLowerCase();
  const all = [...recs.values()];
  const now = Date.now();
  if (!q) {
    // Recents: frecency ranks opened notes MRU-style; never-opened notes score 0
    // and keep the plain (pinned, updated) order among themselves.
    return all
      .sort(
        (a, b) =>
          Number(b.meta.pinned) - Number(a.meta.pinned) ||
          frecencyOf(b.meta.path, now) - frecencyOf(a.meta.path, now) ||
          b.meta.updated - a.meta.updated,
      )
      .map((r) => ({ ...base(r), score: 0, positions: [], titlePositions: [] }));
  }
  const scored: { h: FileHit; s: number }[] = [];
  for (const r of all) {
    const pathMatch = subseq(r.meta.path.toLowerCase(), q);
    const titleMatch = subseq(r.meta.title.toLowerCase(), q);
    if (!pathMatch && !titleMatch) continue;
    const pathScore = pathMatch?.score ?? 0;
    const titleScore = titleMatch ? titleMatch.score + 16 : 0;
    const score = Math.max(pathScore, titleScore);
    // Bounded frecency nudge (≤ +15%): text relevance stays dominant; frecency
    // breaks near-ties toward often-opened notes.
    const f = frecencyOf(r.meta.path, now);
    const boosted = score * (1 + 0.15 * (f / (f + 3)));
    scored.push({
      h: {
        ...base(r),
        score,
        positions: pathMatch?.positions ?? [],
        titlePositions: titleMatch?.positions ?? [],
      },
      s: boosted,
    });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.map((x) => x.h);
}

function contentSearch(query: string, mode: GrepMode): ContentHit[] {
  const needle = query.trim();
  if (!needle) return [];
  const smart = /[A-Z]/.test(needle);
  let re: RegExp | null = null;
  if (mode === "regex") {
    try {
      re = new RegExp(needle, smart ? "g" : "gi");
    } catch {
      return [];
    }
  }
  const lc = needle.toLowerCase();
  const out: ContentHit[] = [];
  for (const r of recs.values()) {
    const lines = r.body.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const ranges: [number, number][] = [];
      if (mode === "regex" && re) {
        re.lastIndex = 0;
        let mm: RegExpExecArray | null;
        while ((mm = re.exec(line)) && mm[0]) {
          ranges.push([mm.index, mm.index + mm[0].length]);
          if (re.lastIndex === mm.index) re.lastIndex++;
        }
      } else if (mode === "fuzzy") {
        const m = subseq(line.toLowerCase(), lc);
        if (m) for (const p of m.positions) ranges.push([p, p + 1]);
      } else {
        const hay = smart ? line : line.toLowerCase();
        const nee = smart ? needle : lc;
        let idx = hay.indexOf(nee);
        while (idx >= 0) {
          ranges.push([idx, idx + nee.length]);
          idx = hay.indexOf(nee, idx + nee.length);
        }
      }
      if (ranges.length) {
        out.push({
          id: r.meta.id,
          path: r.meta.path,
          title: r.meta.title,
          lineNumber: i + 1,
          line,
          ranges,
        });
        if (out.length >= 200) return out;
      }
    }
  }
  return out;
}

export const mockBackend: Backend = {
  live: false,
  async pickNotebook() {
    return "/demo-notebook";
  },
  async openNotebook(path) {
    let nb = notebooks.get(path);
    if (!nb) {
      nb = { recs: new Map(), frecency: new Map(), lastOpened: Date.now() };
      notebooks.set(path, nb);
    }
    current = path;
    recs = nb.recs;
    frecency = nb.frecency;
    nb.lastOpened = Date.now();
    bump(path);
    return metas();
  },
  async currentNotebook() {
    return current;
  },
  async listNotebooks() {
    const out: NotebookRef[] = [];
    for (const path of mru) {
      const nb = notebooks.get(path);
      if (nb) out.push({ path, name: notebookName(path), lastOpened: nb.lastOpened });
    }
    return out;
  },
  async rememberNotebook(path) {
    const nb = notebooks.get(path);
    if (nb) nb.lastOpened = Date.now();
    else notebooks.set(path, { recs: new Map(), frecency: new Map(), lastOpened: Date.now() });
    bump(path);
  },
  async removeRecentNotebook(path) {
    if (path === current) return;
    notebooks.delete(path);
    const i = mru.indexOf(path);
    if (i >= 0) mru.splice(i, 1);
  },
  async createNotebook(parent, name) {
    // Mirror the Rust sanitizer's shape (one path segment, no separators/reserved
    // chars, no edge dots). Control chars are irrelevant for demo names, so unlike
    // Rust we don't strip them — keeps this free of a control-char regex.
    const folder = name
      .replace(/[/\\:*?"<>|]/g, "")
      .replace(/^\.+|\.+$/g, "")
      .trim();
    const seg = folder || "untitled";
    return !parent || parent === "/" ? `/${seg}` : `${parent.replace(/\/+$/, "")}/${seg}`;
    // The empty notebook itself is materialized lazily by openNotebook.
  },
  async listNotes() {
    return metas();
  },
  async readNote(path): Promise<NoteDoc> {
    const r = recs.get(path);
    if (!r) throw new Error(`no such note: ${path}`);
    return { ...r.meta, body: r.body };
  },
  async previewNote(path): Promise<NoteDoc> {
    const r = recs.get(path);
    if (!r) throw new Error(`no such note: ${path}`);
    return { ...r.meta, body: r.body };
  },
  async saveNote(path, body) {
    const existing = recs.get(path);
    const title = titleFromBody(body) ?? path;
    const meta: NoteMeta = existing
      ? { ...existing.meta, title, updated: Date.now() }
      : { id: path, path, title, tags: [], created: null, updated: Date.now(), pinned: false };
    recs.set(path, { meta, body });
    return meta;
  },
  async renameNote(path) {
    const r = recs.get(path);
    if (!r) throw new Error(`no such note: ${path}`);
    const title = titleFromBody(r.body);
    if (!title) return r.meta; // no heading → the filename is the identity
    const slug = slugifyTitle(title);
    // Mirror the Rust command: compare the FILENAME stem (directory stripped) and
    // rename within the note's own directory — nested notes are never hoisted out.
    const dirEnd = path.lastIndexOf("/") + 1;
    const dir = path.slice(0, dirEnd);
    const stem = path.slice(dirEnd).replace(/\.md$/, "");
    if (stemMatchesSlug(stem, slug)) {
      // Filename already matches — still surface the freshly derived title (parity
      // with rename_note, which re-parses even on a no-op).
      if (r.meta.title === title) return r.meta;
      const meta: NoteMeta = { ...r.meta, title };
      recs.set(path, { meta, body: r.body });
      return meta;
    }
    const newPath = uniquePath(dir, slug);
    const meta: NoteMeta = { ...r.meta, id: newPath, path: newPath, title, updated: Date.now() };
    recs.delete(path);
    recs.set(newPath, { meta, body: r.body });
    const f = frecency.get(path);
    if (f) {
      frecency.delete(path);
      frecency.set(newPath, f);
    }
    return meta;
  },
  async createNote(title) {
    const display = (title ?? "").trim() || "Untitled";
    const path = uniquePath("", slugifyTitle(display));
    const body = `# ${display}\n\n`;
    const meta: NoteMeta = {
      id: path,
      path,
      title: display,
      tags: [],
      created: null,
      updated: Date.now(),
      pinned: false,
    };
    recs.set(path, { meta, body });
    return meta;
  },
  async duplicateNote(path) {
    const r = recs.get(path);
    if (!r) throw new Error(`no such note: ${path}`);
    const newTitle = `${r.meta.title} copy`;
    const body = setTitle(r.body, newTitle);
    const dirEnd = path.lastIndexOf("/") + 1;
    const newPath = uniquePath(path.slice(0, dirEnd), slugifyTitle(newTitle));
    const meta: NoteMeta = {
      id: newPath,
      path: newPath,
      title: newTitle,
      tags: [...r.meta.tags],
      created: null,
      updated: Date.now(),
      pinned: false,
    };
    recs.set(newPath, { meta, body });
    return meta;
  },
  async retitleNote(path, title) {
    const r = recs.get(path);
    if (!r) throw new Error(`no such note: ${path}`);
    const newTitle = title.trim();
    if (!newTitle) throw new Error("a note title can't be empty");
    const body = setTitle(r.body, newTitle);
    const slug = slugifyTitle(newTitle);
    const dirEnd = path.lastIndexOf("/") + 1;
    const stem = path.slice(dirEnd).replace(/\.md$/, "");
    if (stemMatchesSlug(stem, slug)) {
      const meta: NoteMeta = { ...r.meta, title: newTitle };
      recs.set(path, { meta, body });
      return meta;
    }
    const newPath = uniquePath(path.slice(0, dirEnd), slug);
    const meta: NoteMeta = {
      ...r.meta,
      id: newPath,
      path: newPath,
      title: newTitle,
      updated: Date.now(),
    };
    recs.delete(path);
    recs.set(newPath, { meta, body });
    const f = frecency.get(path);
    if (f) {
      frecency.delete(path);
      frecency.set(newPath, f);
    }
    return meta;
  },
  async revealNote() {
    // No OS file manager in the browser demo — a no-op (native only).
  },
  async deleteNote(path) {
    recs.delete(path);
    frecency.delete(path);
  },
  async recordOpen(path) {
    const now = Date.now();
    const e = frecency.get(path);
    frecency.set(path, { s: (e ? decayed(e, now) : 0) + 1, t: now });
  },
  async searchFiles(query) {
    return fileSearch(query);
  },
  async searchContent(query, mode) {
    return contentSearch(query, mode);
  },
  async getConfig() {
    try {
      const v = localStorage.getItem(LS("config"));
      return v ? (JSON.parse(v) as Partial<Config>) : null;
    } catch {
      return null;
    }
  },
  async setConfig(cfg) {
    try {
      localStorage.setItem(LS("config"), JSON.stringify(cfg));
    } catch {
      /* ignore */
    }
  },
  async getLastNotebook() {
    try {
      return localStorage.getItem(LS("lastNotebook"));
    } catch {
      return null;
    }
  },
  async setLastNotebook(path) {
    try {
      localStorage.setItem(LS("lastNotebook"), path);
    } catch {
      /* ignore */
    }
  },
  async watchNotebook() {
    return () => {};
  },
};
