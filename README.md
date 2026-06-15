# Noteside

**Notes for keyboard people.** An offline, local-first notebook with first-class
vim keybindings. Your notes are plain Markdown files on your disk — grep them,
back them up, sync them however you like. No account, no cloud.

This is a Turborepo + pnpm monorepo:

```
apps/
  desktop/   Tauri 2 + React 19 + TypeScript — the app
  landing/   Vite + React 19 + TypeScript + Tailwind v4 — the marketing site
```

## Prerequisites

- **Node ≥ 20** and **pnpm 10** (`corepack enable`)
- **Rust** (stable) + the [Tauri 2 system deps](https://v2.tauri.app/start/prerequisites/)
  for running/building the desktop app

## Getting started

```bash
pnpm install

pnpm dev            # run everything (landing on :3000, desktop Tauri window)
pnpm dev:landing    # just the landing site
pnpm dev:desktop    # just the desktop app (launches the Tauri window)

pnpm typecheck      # tsc across the workspace
pnpm test           # Vitest unit tests (frontend)
pnpm test:rust      # cargo test (Rust backend)
pnpm lint           # oxlint        (pnpm format = oxfmt)
pnpm build          # web builds for both apps
```

### Desktop

```bash
pnpm dev:desktop                 # tauri dev — native window + Vite HMR
pnpm --filter @noteside/desktop build   # web bundle only (apps/desktop/dist)
pnpm tauri build                 # full native bundle (needs full icon set, see below)
```

The window is **decorationless**; the in-app titlebar (traffic lights, sidebar
toggle, finder) drives close/minimize/maximize via the Tauri window API. In a
browser those controls are inert, so the same UI also runs as the landing demo.

**Icons.** The committed icon set is generated from the brand logo
(`src-tauri/app-icon.png`). After changing the art, regenerate the full
cross-platform set (`.icns` / `.ico` / PNGs) with:

```bash
pnpm --filter @noteside/desktop tauri icon src-tauri/app-icon.png
```

### Landing + live demo

The landing page embeds the **real app** in an `<iframe>` (`?embed=1` makes it
fill the frame). In `pnpm dev` it points at the desktop dev server. For a static
production build, bake the desktop web build into the site first:

```bash
pnpm demo:build     # builds desktop web bundle → apps/landing/public/demo/
pnpm --filter @noteside/landing build
```

Override the embed target any time with `VITE_DEMO_URL`.

## How it works

- **Files-as-truth notebook.** Notes are plain Markdown files in a folder you pick.
  The Rust backend (`src-tauri/src/`) scans them into a rebuildable in-memory
  index, writes atomically (temp + fsync + rename), and watches the folder so
  external edits (other editors, git, sync) reload live. Nothing leaves your disk.
- **First-class vim** via **CodeMirror 6 + `@replit/codemirror-vim`**: real modes,
  motions, operators, registers, macros, counts, `/` search, and ex-commands wired
  to the app — `:w :q :wq :find :grep :nav :settings :config` (plus `:set` for vim
  options). Markdown highlighting, relative line numbers, a vim command line, and a
  live mode in the status bar. `Cmd/Ctrl-S` and debounced autosave.
- **Search**: fuzzy file/title finding (Rust `nucleo`) + line-level content search
  (plain / regex / fuzzy) with a preview pane.
- **Settings** persist via the Tauri store plugin; the live `~/.notesiderc` config
  buffer applies on `:w`.
- **Backend seam** (`src/backend/`): a `Backend` interface with a Tauri adapter
  (real IPC) and an in-memory mock, so `pnpm dev:web` and the landing demo run
  without a Rust backend.

## Releasing (v1)

```bash
pnpm --filter @noteside/desktop tauri icon src-tauri/app-icon.png  # full icon set
pnpm tauri build                                                   # native installers
```

Code signing/notarization (macOS Developer ID, Windows Authenticode) and
auto-update (`tauri-plugin-updater`) require your own certificates + a release
feed — wire them into CI per the [Tauri distribution docs](https://v2.tauri.app/distribute/).

## Scale & follow-ups

- The in-memory index targets ~1–5k notes (instant). For 10k+, swap the search
  module for SQLite **FTS5** behind the same seam — no UI changes.
- Content-search byte ranges assume ASCII; multi-byte highlight alignment is a
  known v1 limitation.
- Future: inline live-preview (CM6 decorations), backlinks, note delete UI, sync.
