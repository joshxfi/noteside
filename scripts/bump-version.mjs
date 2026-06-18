#!/usr/bin/env node
// bump-version.mjs — write one version into every file that carries it.
//
// Called by semantic-release (@semantic-release/exec `prepareCmd`) with the
// computed next version, e.g. `node scripts/bump-version.mjs 1.2.0`. Also
// runnable by hand to test. The version of record for the built app is
// apps/desktop/src-tauri/tauri.conf.json; the rest are kept in lockstep so the
// monorepo never disagrees with itself. Exits non-zero if any file can't be
// updated, so a release fails loudly rather than shipping a half-bumped tree.
//
// Each target is patched with a narrow regex (not a JSON re-serialize) so the
// diff is exactly the version string — no reflowing of hand-formatted files.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`bump-version: expected a semver version, got: ${version ?? "(none)"}`);
  process.exit(1);
}

// The first top-level `"version": "…"` in each JSON file (it always precedes any
// nested version), and the package-scoped `version = "…"` lines in the Rust files.
const jsonVersion = /("version":\s*")[^"]*(")/;
const targets = [
  { path: "package.json", re: jsonVersion },
  { path: "apps/desktop/package.json", re: jsonVersion },
  { path: "apps/landing/package.json", re: jsonVersion },
  { path: "apps/docs/package.json", re: jsonVersion },
  { path: "apps/brand/package.json", re: jsonVersion },
  { path: "apps/desktop/src-tauri/tauri.conf.json", re: jsonVersion },
  // first `version = "…"` inside the [package] table (stop at the next table).
  { path: "apps/desktop/src-tauri/Cargo.toml", re: /(\[package\][^[]*?\nversion = ")[^"]*(")/ },
  // the `noteside` crate's entry in the lockfile (name line precedes version line).
  { path: "apps/desktop/src-tauri/Cargo.lock", re: /(\nname = "noteside"\nversion = ")[^"]*(")/ },
];

let updated = 0;
for (const { path: rel, re } of targets) {
  const file = resolve(root, rel);
  const before = readFileSync(file, "utf8");
  if (!re.test(before)) {
    console.error(`bump-version: version pattern not found in ${rel}`);
    process.exit(1);
  }
  writeFileSync(file, before.replace(re, `$1${version}$2`));
  console.log(`  ${rel} → ${version}`);
  updated++;
}

console.log(`bump-version: set ${updated} files to ${version}`);
