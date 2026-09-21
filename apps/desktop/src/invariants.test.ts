/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Load-bearing rules from AGENTS.md that used to be prose only. Each one has a
// silent failure mode (a re-eagered editor chunk, a double-created editor, a
// Linux-only build break, React dragged into the editor chunk), so they are
// pinned here where `pnpm test` runs them in milliseconds — the same shape as
// tauri-capabilities.test.ts and release-workflow.test.ts.
const src = new URL("./", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, src), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe("AGENTS.md invariants", () => {
  it("app.tsx has no static value import from editor/ except the command table", () => {
    const text = read("app.tsx");
    const statics = [
      ...text.matchAll(/^import\s+(?!type\s)[^;]*?from\s+"(\.\/editor\/[^"]+)"/gm),
    ].map((m) => m[1]);
    expect(statics).toEqual(statics.filter((s) => s === "./editor/commands"));
    expect(text).toMatch(/import\("\.\/editor\/editor"\)/);
  });

  it("main.tsx does not wrap the app in StrictMode", () => {
    const text = read("main.tsx").replace(/\/\/.*$/gm, ""); // drop the comment that explains why
    expect(text).not.toMatch(/StrictMode/);
  });

  it("every desktop source file is kebab-case", () => {
    const root = fileURLToPath(src);
    const offenders = walk(root)
      .filter((p) => /\.(ts|tsx)$/.test(p))
      .map((p) => relative(root, p))
      .filter((rel) => !/^([a-z0-9.-]+\/)*[a-z0-9.-]+\.(ts|tsx)$/.test(rel));
    expect(offenders).toEqual([]);
  });

  it("vite.config.ts claims the react chunk before the editor chunk", () => {
    const text = read("../vite.config.ts");
    const order = [...text.matchAll(/name:\s*"(preload|react|katex|editor)"/g)].map((m) => m[1]);
    expect(order.indexOf("react")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("react")).toBeLessThan(order.indexOf("editor"));
    expect(order.indexOf("preload")).toBeLessThan(order.indexOf("editor"));
  });
});
