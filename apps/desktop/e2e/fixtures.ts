import { test as base, expect, type Page } from "@playwright/test";

// The mock backend persists to two localStorage keys. Seeding them before the
// app boots (via addInitScript) skips onboarding (a non-null config makes
// isFirstLaunch false) and the notebook picker (a lastNotebook opens the seeded
// /demo-notebook + its first note) — so a test lands directly in the editor with
// a controlled config. Each Playwright context has fresh storage, so tests stay
// isolated. Config is a Partial<Config>; only the fields a test asserts on matter.
export type BootConfig = {
  vimMode?: boolean;
  cursor?: "block" | "bar" | "underline";
  cursorBlink?: boolean;
  theme?: "light" | "dark";
  accent?: string;
  [key: string]: unknown;
};

const DEFAULT_CONFIG: BootConfig = {
  vimMode: false,
  cursor: "block",
  cursorBlink: true,
  theme: "light",
};

export async function boot(page: Page, config: BootConfig = {}): Promise<void> {
  await page.addInitScript(
    (cfg) => {
      localStorage.setItem("noteside:lastNotebook", "/demo-notebook");
      localStorage.setItem("noteside:config", JSON.stringify(cfg));
    },
    { ...DEFAULT_CONFIG, ...config },
  );
  await page.goto("/");
  await page.locator(".av-editor").waitFor();
}

export { base as test, expect };
