import { source } from "@/lib/source";
import { SITE_URL } from "@/lib/seo";

// A resource route that returns sitemap.xml, built from every Fumadocs page.
// Prerendered to a static dist/client/sitemap.xml (it's listed in react-router.config
// prerender()). No `headers` export — set Content-Type on the Response (ssr:false).
export async function loader() {
  const urls = source
    .getPages()
    .map((p) => `${SITE_URL}${p.url === "/" ? "" : p.url}`)
    .sort()
    .map((loc) => `  <url><loc>${loc}</loc></url>`)
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

  return new Response(xml, { headers: { "Content-Type": "application/xml" } });
}
