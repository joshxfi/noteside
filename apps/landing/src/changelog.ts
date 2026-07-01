// changelog.ts — the /changelog page's data. Fetches every GitHub release
// client-side (always current, independent of when the landing redeploys) and
// parses semantic-release's notes into sections. Mirrors downloads.ts's
// fetch + sessionStorage-cache + graceful-fallback pattern.
import { useEffect, useState } from "react";
import { RELEASES } from "./downloads";

export { RELEASES };

const RELEASES_API = "https://api.github.com/repos/joshxfi/noteside/releases";
const CACHE_KEY = "noteside:releases";
// The initial release is the full first-version feature dump — too long to be
// useful here, so it's hidden from the changelog list.
const HIDDEN_TAGS = new Set(["v1.0.0"]);

interface RawRelease {
  tag_name: string;
  name: string | null;
  published_at: string | null;
  html_url: string;
  body: string | null;
}

export interface ChangeItem {
  scope: string | null;
  text: string;
  commit: { hash: string; url: string } | null;
}
export interface Section {
  title: string;
  items: ChangeItem[];
}
export interface ChangelogEntry {
  version: string; // tag_name, e.g. "v1.2.0"
  date: string | null; // published_at (ISO)
  url: string; // the release's html_url
  sections: Section[];
}

export type ChangelogStatus = "loading" | "ready" | "error";

// `* **scope:** text ([hash](url))` — scope + commit link are both optional.
const BULLET = /^\*\s+(?:\*\*(.+?):\*\*\s+)?(.+?)(?:\s+\(\[([0-9a-f]+)\]\((.+?)\)\))?$/;

/** Parse a semantic-release release body into sections. The leading
 *  `## [x](…) (date)` line is ignored (version/date come from structured
 *  fields); each `### Section` collects its `* bullet` items. Pure. */
export function parseReleaseBody(body: string): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("### ")) {
      current = { title: line.slice(4).trim(), items: [] };
      sections.push(current);
    } else if (current && line.startsWith("* ")) {
      const m = BULLET.exec(line);
      if (m) {
        current.items.push({
          scope: m[1] ?? null,
          text: m[2].trim(),
          commit: m[3] && m[4] ? { hash: m[3], url: m[4] } : null,
        });
      }
    }
  }
  return sections;
}

function toEntries(raw: RawRelease[]): ChangelogEntry[] {
  return raw
    .filter((r) => !HIDDEN_TAGS.has(r.tag_name))
    .map((r) => ({
      version: r.tag_name,
      date: r.published_at,
      url: r.html_url,
      sections: parseReleaseBody(r.body ?? ""),
    }));
}

function readCache(): RawRelease[] | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return Array.isArray(data) ? (data as RawRelease[]) : null;
  } catch {
    return null;
  }
}
function writeCache(releases: RawRelease[]) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(releases));
  } catch {
    /* private mode / quota — we just refetch next time */
  }
}

export function useChangelog(): { entries: ChangelogEntry[]; status: ChangelogStatus } {
  const [raw, setRaw] = useState<RawRelease[] | null>(readCache);
  const [status, setStatus] = useState<ChangelogStatus>(raw ? "ready" : "loading");

  useEffect(() => {
    let cancelled = false;
    fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json" } })
      .then((r) => (r.ok ? (r.json() as Promise<RawRelease[]>) : null))
      .then((data) => {
        if (cancelled) return;
        if (!Array.isArray(data)) {
          setStatus((s) => (s === "ready" ? s : "error"));
          return;
        }
        const slim = data.map((r) => ({
          tag_name: r.tag_name,
          name: r.name,
          published_at: r.published_at,
          html_url: r.html_url,
          body: r.body,
        }));
        setRaw(slim);
        setStatus("ready");
        writeCache(slim);
      })
      .catch(() => {
        if (!cancelled) setStatus((s) => (s === "ready" ? s : "error"));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { entries: raw ? toEntries(raw) : [], status };
}
