import { useEffect } from "react";

// Per-route <title> + canonical, set client-side. The landing is a client SPA
// (no prerender), so route-specific SEO lives here rather than in a static
// <head>. Updates the existing canonical <link> in place (no duplicate tags).
export function useHead(title: string, canonical: string) {
  useEffect(() => {
    document.title = title;
    let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "canonical";
      document.head.appendChild(link);
    }
    link.href = canonical;
  }, [title, canonical]);
}
