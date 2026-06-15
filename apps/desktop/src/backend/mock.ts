// In-memory backend for browser dev and the landing demo (no Tauri). Seeded
// from the sample vault; search mirrors the Rust behaviour closely enough for
// the demo. Config/last-vault persist to localStorage.
import { NOTES } from "../data";
import type { Config } from "../settings";
import type { Backend, ContentHit, FileHit, GrepMode, NoteDoc, NoteMeta } from "./types";

interface Rec {
  meta: NoteMeta;
  body: string;
}

function seed(): Map<string, Rec> {
  const m = new Map<string, Rec>();
  const now = Date.now();
  NOTES.forEach((n, i) => {
    m.set(n.path, {
      meta: {
        id: n.path,
        path: n.path,
        title: n.title,
        tags: n.tag ? [n.tag] : [],
        created: null,
        updated: now - i * 3_600_000,
        pinned: false,
      },
      body: n.body,
    });
  });
  return m;
}

const recs = seed();
const LS = (k: string) => `noteside:${k}`;

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

function base(r: Rec): Omit<FileHit, "score" | "positions"> {
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
  if (!q) {
    return all
      .sort(
        (a, b) => Number(b.meta.pinned) - Number(a.meta.pinned) || b.meta.updated - a.meta.updated,
      )
      .map((r) => ({ ...base(r), score: 0, positions: [] }));
  }
  const scored: { h: FileHit; s: number }[] = [];
  for (const r of all) {
    const m = subseq(r.meta.path.toLowerCase(), q);
    if (m) scored.push({ h: { ...base(r), score: m.score, positions: m.positions }, s: m.score });
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
  async pickVault() {
    return "/demo-vault";
  },
  async openVault() {
    return metas();
  },
  async currentVault() {
    return "/demo-vault";
  },
  async listNotes() {
    return metas();
  },
  async readNote(path): Promise<NoteDoc> {
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
  async createNote(title) {
    const display = (title ?? "").trim() || "Untitled";
    const slug =
      display
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "untitled";
    let path = `${slug}.md`;
    let n = 2;
    while (recs.has(path)) path = `${slug}-${n++}.md`;
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
  async deleteNote(path) {
    recs.delete(path);
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
  async getLastVault() {
    try {
      return localStorage.getItem(LS("lastVault"));
    } catch {
      return null;
    }
  },
  async setLastVault(path) {
    try {
      localStorage.setItem(LS("lastVault"), path);
    } catch {
      /* ignore */
    }
  },
  async watchVault() {
    return () => {};
  },
};
