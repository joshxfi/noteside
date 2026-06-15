# Noteside.icon — Liquid Glass app icon (macOS 26 / Tahoe)

This is an **Icon Composer** `.icon` bundle: the layered, appearance-aware source
for the macOS 26 "Liquid Glass" icon. It's a package (folder) holding
`icon.json` (the layer manifest) and `Assets/` (the vector layers).

## What's inside

- `Assets/n.svg` — the serif **N** (foreground layer, transparent canvas)
- `Assets/cursor.svg` — the plum block **cursor** (foreground layer)
- `icon.json` — the manifest

The **tile is not baked into a layer**. Liquid Glass draws the squircle + glass
edge from the manifest's `fill`, so the layers carry only the foreground art.
Behaviour:

- **Light** → cream tile (`fill`), ink N, plum cursor.
- **Dark** → ink tile (fill `dark` specialization); the N flips to cream
  (layer `fill-specializations`); the cursor stays plum (brand rule: the cursor
  is *always* plum).
- The `Mark` group has `specular` on + a neutral depth shadow for the glass look;
  the glyphs are left solid (not `glass`) for legibility. Toggle per-layer
  `glass` in Icon Composer if you want a more translucent treatment.

## Regenerating the layers

The SVG layers are generated (same geometry as the flat icon) by:

```bash
swift apps/desktop/scripts/gen-app-icon.swift   # writes Assets/{n,cursor}.svg + app-icon.png
```

Edit colors/effects/appearances in `icon.json` or visually in Icon Composer.

## Previewing / editing

```bash
brew install --cask icon-composer      # or download from developer.apple.com/icon-composer
open apps/desktop/src-tauri/Noteside.icon
```

Icon Composer (and its `ictool`) render the real glass/specular/tint; flat SVGs
preview fine on their own without it.

## Shipping it

Today the app ships the **flat** icon: Tauri's macOS bundler uses the `.icns`
generated from `src-tauri/app-icon.png` (see `tauri.conf.json` → `bundle.icon`),
which is the correctly-margined, native-shaped fallback and works on every macOS
version.

Tauri does **not** yet bundle `.icon` packages, so the full Liquid Glass icon is
a manual step on macOS 26: compile this bundle (Icon Composer / `ictool` / an
Xcode asset catalog) into the `.app` and set `CFBundleIconName`. Revisit once
Tauri gains native `.icon` support.
