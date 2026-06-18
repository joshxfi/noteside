# Contributing

Issues and PRs are welcome. Before opening a PR, please run the gates:

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm test:rust
```

- The codebase is kept `oxfmt`-formatted — run `pnpm format`.
- TypeScript is strict (`verbatimModuleSyntax` — use `import type`).
- The desktop app intentionally does **not** use `<React.StrictMode>` (it would
  double-fire the editor's action flush).
- Commits follow [Conventional Commits](https://www.conventionalcommits.org)
  (`feat:` / `fix:` / `perf:` / `docs:` / …) — the type drives the automated
  release and changelog, so it matters.

Start with **[AGENTS.md](AGENTS.md)** for how the codebase fits together, the
[README](README.md) for full setup, and the docs at
[docs.noteside.app](https://docs.noteside.app).
