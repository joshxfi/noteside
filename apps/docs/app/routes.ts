import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  route("api/search", "routes/search.ts"),

  // LLM integration:
  route("llms.txt", "llms/index.ts"),
  route("llms-full.txt", "llms/full.ts"),
  route("llms.mdx/docs/*", "llms/mdx.ts"),
  route("sitemap.xml", "routes/sitemap.ts"),

  // Docs at the root: an explicit index for "/" (intro), and a splat for every
  // other page. A bare root splat doesn't match "/", so the index is required.
  index("routes/docs.tsx"),
  route("*", "routes/docs.tsx", { id: "docs-page" }),
] satisfies RouteConfig;
