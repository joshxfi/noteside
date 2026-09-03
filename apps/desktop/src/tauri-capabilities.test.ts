import { describe, expect, it } from "vitest";
import caps from "../src-tauri/capabilities/default.json";
import conf from "../src-tauri/tauri.conf.json";

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

  // The note row's native right-click menu (native-menu.ts → Menu.new/popup)
  // needs this grant; without it the popup invoke is silently denied and
  // right-click does nothing — the same failure mode as the destroy gap above.
  // The Pin row also calls MenuItem.new + setText per popup (to say Pin/Unpin);
  // core:menu:default covers allow-new/allow-set-text, so no extra grant is
  // needed — but narrowing this to individual permissions would break it.
  it("grants the menu permissions the native context menu needs", () => {
    expect(caps.permissions).toContain("core:menu:default");
  });

  // The context menu's "Reveal in Finder/Explorer" → reveal_note → opener plugin.
  it("grants reveal-item-in-dir (the Reveal in Finder/Explorer menu item)", () => {
    expect(caps.permissions).toContain("opener:allow-reveal-item-in-dir");
  });

  // Relative image srcs render through convertFileSrc (editor/image.ts). The
  // STATIC scope stays EMPTY on purpose (least privilege): open_notebook
  // grants the opened folder at runtime via asset_protocol_scope(), so the
  // webview can only ever read files under notebooks the user actually opened.
  // Widening this list would silently re-broaden what a compromised webview
  // could exfiltrate — the runtime grant in commands.rs is the sanctioned path.
  it("enables the asset protocol with an EMPTY static scope (runtime grants only)", () => {
    expect(conf.app.security.assetProtocol.enable).toBe(true);
    expect(conf.app.security.assetProtocol.scope).toEqual([]);
  });
});

// The sidebar's note drag-and-drop is HTML5 DnD inside the webview. Tauri's
// own file drag-drop handler (dragDropEnabled, default ON) claims EVERY drag —
// tauri-runtime-wry's handler returns `true` unconditionally — and on macOS
// wry's WKWebView draggingEntered/draggingUpdated/performDragOperation
// overrides then never forward to WebKit, so the page sees dragstart and
// nothing else: no dragover, no drop, no ring, no dialog (the same on
// Windows, which the Tauri docs do call out). The app never listens for
// native file drops (no onDragDropEvent anywhere), so the handler is pure
// cost; a future "drop an image into the editor" feature should use the
// HTML5 drop event's dataTransfer.files, which WebKit delivers with this off.
describe("tauri window", () => {
  it("disables Tauri's native drag-drop interception (HTML5 DnD needs the webview to see drags)", () => {
    const main = conf.app.windows.find((w) => w.label === "main");
    expect(main?.dragDropEnabled).toBe(false);
  });
});
