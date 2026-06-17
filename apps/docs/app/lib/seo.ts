// SEO constants + helpers for the docs site (docs.noteside.app). The per-page meta
// tags are rendered in the docs route component body; React 19 hoists <title>/<meta>/
// <link> into the prerendered <head> at build time.

export const SITE_URL = "https://docs.noteside.app";
export const OG_IMAGE = `${SITE_URL}/og.png`;

/**
 * Absolute canonical URL for a Fumadocs page url ("/" or "/getting-started").
 * Root → SITE_URL with no trailing slash; others → SITE_URL + path with no trailing
 * slash, matching the prerendered directory-style URLs (and the sitemap).
 */
export function canonicalUrl(pageUrl: string): string {
  if (!pageUrl || pageUrl === "/") return SITE_URL;
  let p = pageUrl.startsWith("/") ? pageUrl : `/${pageUrl}`;
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return SITE_URL + p;
}

/** Per-page JSON-LD (TechArticle) for a docs page. */
export function articleJsonLd(opts: { title: string; description?: string; url: string }) {
  return {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: opts.title,
    description: opts.description,
    url: opts.url,
    inLanguage: "en",
    author: { "@type": "Person", name: "Josh Daniel", url: "https://github.com/joshxfi" },
    isPartOf: { "@type": "WebSite", name: "Noteside Docs", url: SITE_URL },
  };
}
