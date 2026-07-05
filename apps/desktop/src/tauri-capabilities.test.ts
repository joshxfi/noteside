import { describe, expect, it } from "vitest";
import caps from "../src-tauri/capabilities/default.json";

// REGRESSION (v1.3.0): app.tsx registers a JS `onCloseRequested` listener
// (the config flush), which makes Tauri core intercept the native close; the
// @tauri-apps/api wrapper then closes the window itself via `destroy()`.
// Without the destroy permission that invoke is silently denied and the
// window's X button does NOTHING. Only relax this if the onCloseRequested
// hook is ever removed from app.tsx.
describe("tauri capabilities", () => {
  it("grants window destroy (required by the onCloseRequested hook)", () => {
    expect(caps.permissions).toContain("core:window:allow-destroy");
  });

  it("keeps the window controls the titlebar needs", () => {
    for (const p of ["core:window:allow-close", "core:window:allow-start-dragging"]) {
      expect(caps.permissions).toContain(p);
    }
  });
});
