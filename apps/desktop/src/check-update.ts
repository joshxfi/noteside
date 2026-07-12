// Lightweight "check for updates": ask GitHub for the latest release and compare
// its tag to the running version. Runs on launch when the `auto-update` setting is
// on (throttled — see dueForCheck), and on demand from the Settings About row.
// There's no auto-updater (builds are unsigned) — a found update only surfaces a
// badge + the About row's download link, never installs anything.
// The repo mirrors apps/landing/src/downloads.ts (a separate package we can't import).
const REPO = "joshxfi/noteside";
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`;

/** Throttle window for the automatic launch check — at most one network hit per
 *  day, regardless of how often the app is relaunched. */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Should the automatic check run now, given when it last ran (0/NaN = never)?
 *  A `lastTs` in the future (clock skew) also reads as "due", never as blocked. */
export function dueForCheck(now: number, lastTs: number): boolean {
  if (!Number.isFinite(lastTs) || lastTs <= 0) return true;
  return now - lastTs >= CHECK_INTERVAL_MS || now < lastTs;
}
/** Where "get the update" sends the user: the landing's download section, which
 *  auto-detects the visitor's OS — friendlier than the raw GitHub releases page. */
export const DOWNLOAD_PAGE = "https://noteside.app/#get";

export type UpdateCheck =
  | { kind: "current" }
  | { kind: "available"; latest: string }
  | { kind: "error" };

/** Is dotted version `latest` strictly newer than `current`? Numeric x.y.z
 *  compare; missing or non-numeric parts count as 0. Callers strip any leading "v". */
export function isNewer(latest: string, current: string): boolean {
  const a = latest.split(".");
  const b = current.split(".");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = Number(a[i]) || 0;
    const y = Number(b[i]) || 0;
    if (x !== y) return x > y;
  }
  return false;
}

export async function checkForUpdate(current: string): Promise<UpdateCheck> {
  try {
    const r = await fetch(LATEST_API, { headers: { Accept: "application/vnd.github+json" } });
    if (!r.ok) return { kind: "error" };
    const data = (await r.json()) as { tag_name?: string };
    const latest = String(data.tag_name ?? "").replace(/^v/, "");
    if (!latest) return { kind: "error" };
    return isNewer(latest, current) ? { kind: "available", latest } : { kind: "current" };
  } catch {
    return { kind: "error" };
  }
}
