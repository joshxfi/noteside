// fff.ts — search seam that mirrors fff's API shape.
//
// Replace fileSearch / contentSearch with calls into the real `fff` library
// (the fff-search Rust crate, via a Tauri #[command]) when wiring the backend;
// the result shapes here intentionally match fff's: file items expose
// { type, name, relative_path, git_status, frecency, positions }, grep items
// expose { relative_path, name, line_number, col, line_content, match_ranges }.

import type { GitStatus, Note } from "./types";

export type Range = [number, number];

export interface FuzzyResult {
  score: number;
  positions: number[];
}

export interface FileItem {
  type: "file";
  id: string;
  name: string;
  relative_path: string;
  git_status: GitStatus;
  frecency: number;
  positions: number[];
  _total: number;
}

export interface GrepItem {
  id: string;
  relative_path: string;
  name: string;
  line_number: number;
  col: number;
  line_content: string;
  match_ranges: Range[];
  git_status: GitStatus;
}

export interface FileSearchResult {
  items: FileItem[];
  total_matched: number;
  total_files: number;
}

export type GrepMode = "plain" | "regex" | "fuzzy";

export interface ContentSearchResult {
  items: GrepItem[];
  total_matched: number;
  mode: GrepMode;
  regexBad?: boolean;
}

interface Constraints {
  git: string | null;
  ext: string | null;
  dir: string | null;
  excludes: string[];
  terms: string[];
  query: string;
}

// ---- typo-ish fuzzy matcher (stand-in for fff's SIMD/Smith-Waterman core) ----
export function fuzzyMatch(query: string, target: string): FuzzyResult | null {
  if (!query) return { score: 0, positions: [] };
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0,
    prev = -2,
    streak = 0,
    score = 0;
  const positions: number[] = [];
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      positions.push(ti);
      if (ti === prev + 1) {
        streak++;
        score += 8 + streak * 4;
      } else {
        streak = 0;
        score += 5;
      }
      if (ti === 0 || /[/\s_\-.]/.test(t[ti - 1])) score += 10; // start-of-segment bonus
      prev = ti;
      qi++;
    }
  }
  if (qi < q.length) return null;
  score -= positions[0] * 0.4; // earlier match wins
  score -= t.length * 0.08; // shorter path wins
  return { score, positions };
}

export function rangesFromPositions(positions: number[]): Range[] {
  const r: Range[] = [];
  for (const p of positions) {
    const last = r[r.length - 1];
    if (last && p === last[1]) last[1] = p + 1;
    else r.push([p, p + 1]);
  }
  return r;
}

function parseConstraints(query: string): Constraints {
  const out: Constraints = { git: null, ext: null, dir: null, excludes: [], terms: [], query: "" };
  for (const tok of query.trim().split(/\s+/).filter(Boolean)) {
    if (tok.startsWith("git:")) out.git = tok.slice(4).toLowerCase();
    else if (tok.startsWith("!")) out.excludes.push(tok.slice(1).toLowerCase());
    else if (/^\*\.\w+$/.test(tok)) out.ext = tok.slice(1).toLowerCase();
    else if (tok.endsWith("/")) out.dir = tok.toLowerCase();
    else out.terms.push(tok);
  }
  out.query = out.terms.join("");
  return out;
}

function passesConstraints(file: Note, c: Constraints): boolean {
  const p = file.path.toLowerCase();
  if (c.git && (file.git || "") !== c.git) return false;
  if (c.ext && !p.endsWith(c.ext)) return false;
  if (c.dir && !p.includes(c.dir)) return false;
  for (const ex of c.excludes) if (ex && p.includes(ex)) return false;
  return true;
}

// ---- path / filename search ----
export function fileSearch(
  query: string,
  files: Note[],
  opts: { max_results?: number } = {},
): FileSearchResult {
  const c = parseConstraints(query || "");
  const scored: FileItem[] = [];
  for (const f of files) {
    if (!passesConstraints(f, c)) continue;
    let m: FuzzyResult | null = { score: 0, positions: [] };
    if (c.query) {
      m = fuzzyMatch(c.query, f.path);
      if (!m) continue;
    }
    const total = (c.query ? m.score : 0) + f.frecency * (c.query ? 0.35 : 1);
    scored.push({
      type: "file",
      id: f.id,
      name: f.path.split("/").pop() as string,
      relative_path: f.path,
      git_status: f.git,
      frecency: f.frecency,
      positions: m.positions,
      _total: total,
    });
  }
  scored.sort((a, b) => b._total - a._total);
  const max = opts.max_results || 100;
  return { items: scored.slice(0, max), total_matched: scored.length, total_files: files.length };
}

// ---- content grep ----
export function contentSearch(
  query: string,
  files: Note[],
  opts: { mode?: GrepMode; max_results?: number } = {},
): ContentSearchResult {
  const mode: GrepMode = opts.mode || "plain";
  const c = parseConstraints(query || "");
  const needle = c.terms.join(" ");
  const items: GrepItem[] = [];
  if (!needle) return { items, total_matched: 0, mode };
  const smartCaseSensitive = /[A-Z]/.test(needle);

  let rx: RegExp | null = null,
    rxBad = false;
  if (mode === "regex") {
    try {
      rx = new RegExp(needle, smartCaseSensitive ? "g" : "gi");
    } catch {
      rxBad = true;
    }
  }

  for (const f of files) {
    if (!passesConstraints(f, c)) continue;
    const lines = f.body.split("\n");
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      const ranges: Range[] = [];
      if (mode === "regex" && rx) {
        rx.lastIndex = 0;
        let mm: RegExpExecArray | null;
        while ((mm = rx.exec(line)) && mm[0]) {
          ranges.push([mm.index, mm.index + mm[0].length]);
          if (rx.lastIndex === mm.index) rx.lastIndex++;
        }
      } else if (mode === "fuzzy") {
        const fm = fuzzyMatch(needle.replace(/\s+/g, ""), line);
        if (fm) ranges.push(...rangesFromPositions(fm.positions));
      } else {
        // plain
        const hay = smartCaseSensitive ? line : line.toLowerCase();
        const nee = smartCaseSensitive ? needle : needle.toLowerCase();
        let idx = hay.indexOf(nee);
        while (idx >= 0) {
          ranges.push([idx, idx + needle.length]);
          idx = hay.indexOf(nee, idx + needle.length);
        }
      }
      if (ranges.length) {
        items.push({
          id: f.id,
          relative_path: f.path,
          name: f.path.split("/").pop() as string,
          line_number: li + 1,
          col: ranges[0][0] + 1,
          line_content: line,
          match_ranges: ranges,
          git_status: f.git,
        });
        if (items.length >= (opts.max_results || 80))
          return { items, total_matched: items.length, mode, regexBad: rxBad };
      }
    }
  }
  return { items, total_matched: items.length, mode, regexBad: rxBad };
}
