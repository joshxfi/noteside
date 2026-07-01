import { defineConfig, devices } from "@playwright/test";

// Browser-level e2e (Layer 1): drives the web build (`vite` on :1420) with the
// in-memory mock backend — no native shell. See e2e/fixtures.ts for the boot
// helper that seeds localStorage to land straight in the editor.
const CI = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: "http://localhost:1420",
    trace: "on-first-retry",
  },
  // Chromium ≈ the Windows webview (WebView2); WebKit ≈ the macOS/Linux webview
  // (WKWebView / WebKitGTK) — engine-level parity for CSS/animation quirks.
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "pnpm exec vite",
    url: "http://localhost:1420",
    reuseExistingServer: !CI,
    timeout: 120_000,
  },
});
