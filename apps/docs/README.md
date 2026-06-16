# @noteside/docs

The documentation site for **Noteside**, built with [Fumadocs](https://fumadocs.dev)
on React Router 7 (SPA mode) + Vite + Tailwind v4. Content lives in
`content/docs/*.mdx`; the build prerenders every page to static HTML and a static,
client-side search index (Orama) — no server required.

```bash
pnpm dev:docs       # dev server on http://localhost:3002  (from the repo root)
pnpm --filter @noteside/docs build      # static build → apps/docs/dist/client
pnpm --filter @noteside/docs preview     # serve the build locally
pnpm --filter @noteside/docs typecheck   # react-router typegen + fumadocs-mdx + tsc
```

## Writing docs

- Add a page: drop an `.mdx` file in `content/docs/`. Frontmatter: `title`, `description`.
- Order the sidebar: edit `content/docs/meta.json`.
- MDX components (`<Cards>`, `<Card>`, `<Callout>`, …) come from `fumadocs-ui`.

## Notes

- **Vite is pinned to `^7`.** Vite 8 ships the Rolldown bundler, whose React interop
  currently breaks the prerender; Vite 6 is too old for `fumadocs-mdx`'s generated
  `import.meta.glob({ base })`. Vite 7 is the working middle.
- `vite.config.ts` sets `ssr.noExternal: true` + `resolve.dedupe` to force a single
  React instance during prerender. The generated `.source/` (fumadocs-mdx codegen)
  and `.react-router/` (typegen) directories are gitignored.
