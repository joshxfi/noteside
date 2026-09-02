import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json" with { type: "json" };

// @tauri-apps/cli sets TAURI_DEV_HOST when developing over the network.
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/  — tuned per Tauri's Vite guide.
export default defineConfig({
  plugins: [react()],
  // Build-time app version (kept in lockstep with tauri.conf.json by
  // scripts/bump-version.mjs) — the web/demo fallback for useAppVersion().
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // Relative base so the same build can be served standalone AND embedded
  // in the landing page's <iframe> from /demo/.
  base: "./",
  build: {
    chunkSizeWarningLimit: 1200,
    rolldownOptions: {
      output: {
        // Split the heavy editor + react vendors so they cache independently
        // (mainly helps the landing demo, which loads over the network).
        // Rolldown's native chunking API — groups are matched in ORDER, and a
        // group pulls its matched modules' static dependencies in with them
        // (includeDependenciesRecursively), so the order below is load-bearing:
        // React must be claimed BEFORE the editor group, or @tiptap/react's
        // dependency on react drags React into the editor chunk and the entry
        // then imports that chunk statically — the whole editor eager at first
        // paint, the exact invariant scripts/check-editor-lazy.mjs pins. (The
        // old function-form manualChunks silently did just that under Rolldown.)
        advancedChunks: {
          groups: [
            // Vite's preload helper is imported by every chunk that has a
            // dynamic import(); left alone it can be hoisted INTO the lazy
            // editor chunk, re-eagering it. Pin it to its own tiny chunk.
            { name: "preload", test: /vite\/preload-helper/ },
            { name: "react", test: /node_modules\/(react|react-dom|scheduler)\// },
            // KaTeX is statically imported by the math extension, so it can't
            // be fully lazy — but it gets its own cache-isolated chunk that
            // loads WITH the editor chunk, still off the first paint.
            { name: "katex", test: /node_modules\/katex\// },
            // Per-language highlight.js grammars are dynamic imports from
            // code-block.ts — no group claims them, so each stays its own lazy
            // chunk (the successor of the CM-era codeLanguages contract); only
            // the core joins the editor chunk.
            {
              name: "editor",
              test: /node_modules\/(@tiptap\/|prosemirror-|lowlight\/|highlight\.js\/lib\/core|marked\/)/,
            },
          ],
        },
      },
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: {
      // Tauri owns the Rust side; don't let Vite watch it.
      ignored: ["**/src-tauri/**"],
    },
  },
});
