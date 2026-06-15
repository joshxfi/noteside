import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @tauri-apps/cli sets TAURI_DEV_HOST when developing over the network.
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/  — tuned per Tauri's Vite guide.
export default defineConfig({
  plugins: [react()],
  // Relative base so the same build can be served standalone AND embedded
  // in the landing page's <iframe> from /demo/.
  base: "./",
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
