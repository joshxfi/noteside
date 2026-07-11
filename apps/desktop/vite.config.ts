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
          // re-eagering ~1.7MB at first paint (the exact invariant this config
          // protects). Pin it to its own tiny chunk.
          if (id.includes("vite/preload-helper")) return "preload";
          // Per-language syntax modules are loaded on demand by
          // @codemirror/language-data when a fenced block names them — each
          // must stay its own lazy chunk, NOT join the editor chunk. Modules
          // the editor statically reaches (lang-markdown → lang-html →
          // lang-css/lang-javascript and their @lezer parsers) stay in it.
          if (/@codemirror\/(lang-(?!markdown|html|css|javascript)|legacy-modes)/.test(id)) {
            return undefined;
          }
          if (/@lezer\/(?!common|highlight|lr|markdown|javascript|css|html)/.test(id)) {
            return undefined;
          }
          if (
            id.includes("@codemirror") ||
            id.includes("@replit/codemirror-vim") ||
            id.includes("@lezer")
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
