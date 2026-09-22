/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveThemeVars, THEME_VARS, THEMES } from "./themes";

// index.html's pre-paint script can't import themes.ts (it runs before any
// bundle), so it carries its own copy of the var allowlist and value regex.
// These tests keep the copy honest: the list must equal THEME_VARS, and every
// value the app can ever write (all bundled schemes) must pass the regex.
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

function extract(name: string, re: RegExp): string {
  const m = html.match(re);
  if (!m) throw new Error(`${name} not found in index.html`);
  return m[1];
}

describe("boot-theme script", () => {
  it("allowlists exactly THEME_VARS", () => {
    const list = extract("BOOT_VARS", /var BOOT_VARS = \[([\s\S]*?)\];/);
    const names = [...list.matchAll(/"(--[a-z0-9-]+)"/g)].map((m) => m[1]);
    expect(names).toEqual([...THEME_VARS]);
  });

  it("accepts every value the bundled themes produce", () => {
    const src = extract("BOOT_VALUE", /var BOOT_VALUE = \/(.+)\/;/);
    const re = new RegExp(src);
    for (const theme of THEMES) {
      for (const [k, v] of Object.entries(resolveThemeVars(theme))) {
        expect(re.test(v), `${theme.id} ${k}=${v}`).toBe(true);
      }
    }
  });

  it("rejects a url() or a script-shaped value", () => {
    const src = extract("BOOT_VALUE", /var BOOT_VALUE = \/(.+)\/;/);
    const re = new RegExp(src);
    for (const bad of [
      "url(http://x/y)",
      "red; background: url(x)",
      "a\\b",
      "'x'",
      "x".repeat(121),
    ]) {
      expect(re.test(bad), bad).toBe(false);
    }
  });
});
