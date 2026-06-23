// downloads.ts — turn the latest GitHub release into one obvious download for
// the visitor's OS, so non-technical users never face the wall of installer
// filenames on the Releases page. Pure helpers (OS/arch detection, asset
// matching) are unit-friendly; `useDownloads()` fetches the release client-side
// (always current, independent of when the landing redeploys) and degrades to
// the Releases page if the request fails or the OS is unknown.
import { useEffect, useState } from "react";

export const GITHUB = "https://github.com/joshxfi/noteside";
export const RELEASES = `${GITHUB}/releases`;
const LATEST_PAGE = `${RELEASES}/latest`;
const LATEST_API = "https://api.github.com/repos/joshxfi/noteside/releases/latest";
const CACHE_KEY = "noteside:latest-release";

export type OS = "mac" | "windows" | "linux" | null;
export type MacArch = "arm" | "x64" | "unknown";

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}
export interface Release {
  tag_name: string;
  assets: ReleaseAsset[];
}

export interface Cta {
  label: string;
  href: string;
  note?: string;
  // A direct file download (browser saves it) vs. a page to open in a new tab.
  download: boolean;
}

/** One platform's primary download, for the inline "macOS · Windows · Linux"
 *  links. Shaped to satisfy `Cta` (label/href/download) so `linkProps` works on it,
 *  plus `os` so the UI can mark the visitor's own platform. */
export interface PlatformLink {
  os: "mac" | "windows" | "linux";
  label: string;
  href: string;
  download: boolean;
}

export interface Downloads {
  primary: Cta;
  alternates: Cta[];
  version: string | null;
  /** One direct download per platform (most common variant), in mac/windows/linux order. */
  platforms: PlatformLink[];
  /** The Releases page ("All downloads ↗") — the escape hatch for other arches/variants. */
  allDownloads: Cta;
}

// --- platform detection (browser-only; callers pass navigator fields in) ---

interface NavInfo {
  ua: string;
  platform: string;
  uaDataPlatform?: string;
  maxTouchPoints?: number;
}

export function detectOS({ ua, platform, uaDataPlatform, maxTouchPoints = 0 }: NavInfo): OS {
  const s = `${uaDataPlatform ?? ""} ${platform} ${ua}`.toLowerCase();
  // Mobile has no desktop build — show the generic picker instead of a wrong file.
  if (/android/.test(s)) return null;
  if (/iphone|ipad|ipod/.test(s)) return null;
  const looksMac = /mac/.test(s);
  // iPadOS in desktop mode reports as "Macintosh" but exposes touch points.
  if (looksMac && maxTouchPoints > 1) return null;
  if (looksMac) return "mac";
  if (/win/.test(s)) return "windows";
  if (/linux|x11|cros/.test(s)) return "linux";
  return null;
}

function currentOS(): OS {
  if (typeof navigator === "undefined") return null;
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return detectOS({
    ua: navigator.userAgent,
    platform: navigator.platform ?? "",
    uaDataPlatform: uaData?.platform,
    maxTouchPoints: navigator.maxTouchPoints,
  });
}

// Best-effort CPU arch for macOS — Chromium exposes it via UA-CH; Safari does
// not, so we return "unknown" and default the UI to Apple Silicon.
async function detectMacArch(): Promise<MacArch> {
  try {
    const uaData = (
      navigator as Navigator & {
        userAgentData?: {
          getHighEntropyValues?: (h: string[]) => Promise<{ architecture?: string }>;
        };
      }
    ).userAgentData;
    if (uaData?.getHighEntropyValues) {
      const { architecture } = await uaData.getHighEntropyValues(["architecture"]);
      if (architecture === "arm") return "arm";
      if (architecture === "x86") return "x64";
    }
  } catch {
    /* fall through to unknown */
  }
  return "unknown";
}

// --- asset matching (version-independent: classify by extension + arch) ---

type Kind = "macArm" | "macX64" | "winExe" | "winMsi" | "linuxAppImage" | "linuxDeb" | "linuxRpm";

function classify(name: string): Kind | null {
  const n = name.toLowerCase();
  if (n.endsWith(".dmg")) {
    if (/aarch64|arm64/.test(n)) return "macArm";
    return "macX64"; // x64 / x86_64 / intel, or an unsuffixed single dmg
  }
  if (n.endsWith(".msi")) return "winMsi";
  if (n.endsWith(".exe")) return "winExe";
  if (n.endsWith(".appimage")) return "linuxAppImage";
  if (n.endsWith(".deb")) return "linuxDeb";
  if (n.endsWith(".rpm")) return "linuxRpm";
  return null; // .app.tar.gz, .sig, checksums — not end-user installers
}

function indexAssets(assets: ReleaseAsset[]): Partial<Record<Kind, string>> {
  const out: Partial<Record<Kind, string>> = {};
  for (const a of assets) {
    const k = classify(a.name);
    if (k && !out[k]) out[k] = a.browser_download_url;
  }
  return out;
}

const PLATFORM_LABEL = { mac: "macOS", windows: "Windows", linux: "Linux" } as const;

// One direct download per platform (the dominant variant) for the inline platform
// links. Until the release loads — or if a platform's asset is missing — the link
// points at the Releases page instead, so it's always clickable and never dead.
function platformLinks(a: Partial<Record<Kind, string>>): PlatformLink[] {
  const pick = {
    mac: a.macArm ?? a.macX64,
    windows: a.winExe ?? a.winMsi,
    linux: a.linuxAppImage ?? a.linuxDeb ?? a.linuxRpm,
  };
  return (["mac", "windows", "linux"] as const).map((os) => ({
    os,
    label: PLATFORM_LABEL[os],
    href: pick[os] ?? LATEST_PAGE,
    download: !!pick[os],
  }));
}

export function buildDownloads(os: OS, macArch: MacArch, release: Release | null): Downloads {
  const version = release?.tag_name ?? null;
  const a = release ? indexAssets(release.assets) : {};
  const file = (href: string, label: string, note?: string): Cta => ({
    label,
    href,
    note,
    download: true,
  });
  // A labelled button pointing at the Releases page — used both as a real
  // new-tab link and as the transient target for a known OS before the release
  // loads, so the button always shows the right OS label from first paint.
  const page = (label: string): Cta => ({ label, href: LATEST_PAGE, download: false });
  const allDownloads = page("All downloads ↗");
  // Fields common to every branch — the inline platform links, the Releases-page
  // escape hatch, and the version.
  const base = { version, platforms: platformLinks(a), allDownloads };

  if (os === "mac") {
    const intel = macArch === "x64";
    const primaryUrl = intel ? (a.macX64 ?? a.macArm) : (a.macArm ?? a.macX64);
    if (!primaryUrl)
      return { ...base, primary: page("Download for macOS"), alternates: [allDownloads] };
    const note = primaryUrl === a.macArm ? "Apple Silicon" : "Intel";
    const otherUrl = primaryUrl === a.macArm ? a.macX64 : a.macArm;
    const otherLabel = primaryUrl === a.macArm ? "Intel Mac" : "Apple Silicon";
    return {
      ...base,
      primary: file(primaryUrl, "Download for macOS", note),
      alternates: [...(otherUrl ? [file(otherUrl, otherLabel)] : []), allDownloads],
    };
  }

  if (os === "windows") {
    const primaryUrl = a.winExe ?? a.winMsi;
    if (!primaryUrl)
      return { ...base, primary: page("Download for Windows"), alternates: [allDownloads] };
    return {
      ...base,
      primary: file(primaryUrl, "Download for Windows"),
      alternates: [
        ...(a.winExe && a.winMsi ? [file(a.winMsi, ".msi installer")] : []),
        allDownloads,
      ],
    };
  }

  if (os === "linux") {
    const primaryUrl = a.linuxAppImage ?? a.linuxDeb ?? a.linuxRpm;
    if (!primaryUrl)
      return { ...base, primary: page("Download for Linux"), alternates: [allDownloads] };
    const note =
      primaryUrl === a.linuxAppImage ? "AppImage" : primaryUrl === a.linuxDeb ? ".deb" : ".rpm";
    const alternates: Cta[] = [];
    for (const [url, label] of [
      [a.linuxAppImage, "AppImage"],
      [a.linuxDeb, ".deb"],
      [a.linuxRpm, ".rpm"],
    ] as const) {
      if (url && url !== primaryUrl) alternates.push(file(url, label));
    }
    return {
      ...base,
      primary: file(primaryUrl, "Download for Linux", note),
      alternates: [...alternates, allDownloads],
    };
  }

  // Genuinely unknown OS (mobile, unrecognised UA) → a generic button to the
  // Releases page; the inline platform links (in `base`) still give one direct
  // download per platform once assets are known.
  return { ...base, primary: page("Download for desktop"), alternates: [allDownloads] };
}

// --- caching: one API call per session, refreshed in the background ---

function readCache(): Release | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    // Validate the same way the network response is — a stale/foreign cache
    // shape would otherwise reach indexAssets and throw during render.
    const data = JSON.parse(raw);
    return data && Array.isArray(data.assets) ? (data as Release) : null;
  } catch {
    return null;
  }
}

function writeCache(release: Release) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(release));
  } catch {
    /* private mode / quota — fine, we just refetch next time */
  }
}

// Returns the asset selection plus the detected `os`, so the UI can show
// OS-specific hints (e.g. the macOS Gatekeeper first-launch note) — including in
// the no-asset fallback, where `buildDownloads` alone wouldn't reveal the OS.
export function useDownloads(): Downloads & { os: OS } {
  const [os] = useState<OS>(currentOS);
  const [macArch, setMacArch] = useState<MacArch>("unknown");
  const [release, setRelease] = useState<Release | null>(readCache);

  useEffect(() => {
    let cancelled = false;

    if (os === "mac") {
      void detectMacArch().then((arch) => {
        if (!cancelled) setMacArch(arch);
      });
    }

    fetch(LATEST_API, { headers: { Accept: "application/vnd.github+json" } })
      .then((r) => (r.ok ? (r.json() as Promise<Release>) : null))
      .then((data) => {
        if (cancelled || !data || !Array.isArray(data.assets)) return;
        // Keep only the fields we use, so the cache stays small.
        const slim: Release = {
          tag_name: data.tag_name,
          assets: data.assets.map((x) => ({
            name: x.name,
            browser_download_url: x.browser_download_url,
          })),
        };
        setRelease(slim);
        writeCache(slim);
      })
      .catch(() => {
        /* offline / rate-limited → the UI keeps the Releases-page fallback */
      });

    return () => {
      cancelled = true;
    };
  }, [os]);

  return { ...buildDownloads(os, macArch, release), os };
}
