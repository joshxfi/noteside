// Lightweight "check for updates": ask GitHub for the latest release and compare
// its tag to the running version. User-initiated only (a Settings button), so the
// app stays offline until asked — there's no auto-updater (builds are unsigned).
// The repo mirrors apps/landing/src/downloads.ts (a separate package we can't import).
const REPO = "joshxfi/noteside";
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`;
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
