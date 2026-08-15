import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json";

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
    rollupOptions: {
      output: {
        // Split the heavy editor + react vendors so they cache independently
        // (mainly helps the landing demo, which loads over the network).
        manualChunks(id) {
          // Vite's preload helper is imported by every chunk that has a
          // dynamic import(). Left to rollup it can get hoisted INTO the lazy
          // editor chunk, which the entry then imports statically — silently
          // re-eagering the whole editor at first paint (the exact invariant
          // this config protects). Pin it to its own tiny chunk.
          if (id.includes("vite/preload-helper")) return "preload";
          // KaTeX is statically imported by the math extension, so it can't be
          // fully lazy — but it gets its own cache-isolated chunk that loads
          // WITH the editor chunk, still off the first paint.
          if (id.includes("/katex/")) return "katex";
          // Per-language highlight.js grammars are loaded on demand by
          // code-block.ts when a fenced block names them — each must stay its
          // own lazy chunk, NOT join the editor chunk (the successor of the
          // CM-era codeLanguages contract).
          if (id.includes("highlight.js/lib/languages/")) return undefined;
          if (
            id.includes("@tiptap") ||
            id.includes("prosemirror-") ||
            id.includes("/lowlight/") ||
            id.includes("highlight.js/lib/core") ||
            id.includes("/marked/")
          )
            return "editor";
          if (id.includes("/react-dom/") || id.includes("/react/")) return "react";
          return undefined;
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
