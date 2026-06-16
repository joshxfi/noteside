import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import mdx from "fumadocs-mdx/vite";
import { fileURLToPath } from "node:url";

export default defineConfig(({ command }) => ({
  plugins: [mdx(), tailwindcss(), reactRouter()],
  // Mirror the tsconfig `paths` as aliases (Vite doesn't apply tsconfig `paths` on
  // its own here). The alias boundary-matches (`@/…`, `collections/…`), so it won't
  // clobber scoped packages like `@orama/orama`. `collections/*` points at the
  // generated `.source/` directory (fumadocs-mdx codegen).
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./app", import.meta.url)),
      collections: fileURLToPath(new URL("./.source", import.meta.url)),
    },
    dedupe: ["react", "react-dom"],
  },
  // BUILD ONLY: bundle everything into the prerender server build so react,
  // react-dom, and react-router share exactly one React instance — otherwise an
  // externalized react-router resolves its own react copy and its hooks see a null
  // dispatcher during prerender ("Cannot read … 'useCallback'"). This must NOT apply
  // in dev: Vite's dev SSR module runner then tries to inline-evaluate React's CJS
  // files, which throws "module is not defined".
  ...(command === "build" ? { ssr: { noExternal: true } } : {}),
  // 3000 = landing, 3001 = brand, 3002 = docs.
  server: {
    port: 3002,
  },
}));
