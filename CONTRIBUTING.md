# Contributing

Issues and PRs are welcome. Start with **[AGENTS.md](AGENTS.md)** for how the codebase
fits together.

## Prerequisites

- **Node 24** and **pnpm 11** — run `corepack enable` (the repo pins both).
- **Rust** (stable) + the [Tauri 2 system dependencies](https://v2.tauri.app/start/prerequisites/),
  to run or build the desktop app.

No Rust toolchain? `pnpm --filter @noteside/desktop dev:web` runs the UI in a plain
browser against an in-memory mock backend — handy for frontend work (edits don't touch disk).

## Develop

```bash
pnpm install

pnpm dev            # landing (:3000) + desktop Tauri window
pnpm dev:desktop    # just the desktop app (native window + Vite HMR)
pnpm dev:landing    # just the landing site
pnpm dev:docs       # just the docs site (:3002)
pnpm dev:brand      # the brand guide (:3001)

pnpm build          # web bundles for all apps
```

Build a native installer:

```bash
# icon art is scripts/mark.html (the brand mark in Newsreader); render it to
# src-tauri/app-icon.png (see that file's header), then regenerate the icon set:
pnpm --filter @noteside/desktop tauri icon src-tauri/app-icon.png
pnpm tauri build
```

## Before a PR

Run the gates (CI runs the same):

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm test:rust
```

- The codebase is kept `oxfmt`-formatted — run `pnpm format`.
- TypeScript is strict (`verbatimModuleSyntax` — use `import type`).
- The desktop app intentionally does **not** use `<React.StrictMode>` (it would
  double-fire the editor's action flush).
- Commits follow [Conventional Commits](https://www.conventionalcommits.org)
  (`feat:` / `fix:` / `perf:` / `docs:` / …) — the type drives the automated release
  and changelog, so it matters.

## Project structure

```
apps/
  desktop/   Tauri 2 + React 19 + TypeScript — the app (Rust core in src-tauri/)
  landing/   Vite + React + Tailwind v4 — the marketing site (embeds the real app)
  docs/      Fumadocs on React Router 7 — the documentation site (docs.noteside.app)
  brand/     The brand guide — internal reference only, not deployed
```
