import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// REGRESSION (v1.3.0): registering a JS `onCloseRequested` listener makes
// Tauri core intercept the native close; the @tauri-apps/api wrapper then
// closes the window itself via `destroy()`. Without the destroy permission
// that invoke is silently denied and the window's X button does NOTHING.
// This test pins the coupling between the app code and the capability file.
describe("tauri capabilities", () => {
  const read = (p: string) => readFileSync(join(__dirname, p), "utf8");

  it("grants window destroy whenever app code hooks onCloseRequested", () => {
    const app = read("app.tsx");
    if (!app.includes("onCloseRequested")) return; // hook removed → nothing to require
    const caps = JSON.parse(read("../src-tauri/capabilities/default.json")) as {
      permissions: unknown[];
    };
    expect(caps.permissions).toContain("core:window:allow-destroy");
  });
});
