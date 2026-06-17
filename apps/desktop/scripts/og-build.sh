#!/usr/bin/env bash
# Render the branded Open Graph cards (1200x630) from og.html via headless Chrome,
# the same pipeline as the app icon (mark.html). One template, two variants.
# Be online — the Newsreader + IBM Plex Mono fonts load from Google Fonts.
#   Usage:  pnpm og:build      (or: CHROME=/path/to/chrome bash apps/desktop/scripts/og-build.sh)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
HTML="file://$ROOT/apps/desktop/scripts/og.html"

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
if [ ! -x "$CHROME" ]; then
  CHROME="$(command -v google-chrome || command -v chromium || command -v chrome || true)"
fi
if [ -z "${CHROME:-}" ] || [ ! -x "$CHROME" ]; then
  echo "Chrome not found. Set CHROME=/path/to/chrome and retry." >&2
  exit 1
fi

render() { # <url> <out>
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=1 --window-size=1200,630 \
    --virtual-time-budget=8000 --default-background-color=fff9f5ed \
    --screenshot="$2" "$1" >/dev/null 2>&1
  echo "  → $2"
}

echo "Rendering OG cards…"
render "$HTML?variant=landing" "$ROOT/apps/landing/public/og.png"
render "$HTML?variant=docs" "$ROOT/apps/docs/public/og.png"
echo "Done."
