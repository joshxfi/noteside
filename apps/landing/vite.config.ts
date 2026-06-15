import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
  },
  build: {
    rollupOptions: {
      // Multi-page: the landing + the standalone brand guide (served at /brand.html).
      input: {
        main: "index.html",
        brand: "brand.html",
      },
    },
  },
});
