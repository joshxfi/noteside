import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(appRoot, "dist");
const html = await readFile(path.join(dist, "index.html"), "utf8");
const preloads = [
  ...html.matchAll(/<link\s+[^>]*rel=["']modulepreload["'][^>]*href=["']([^"']+)/gi),
].map((match) => path.basename(match[1]));
const scripts = [...html.matchAll(/<script\s+[^>]*type=["']module["'][^>]*src=["']([^"']+)/gi)].map(
  (match) => path.basename(match[1]),
);
const assets = await readdir(path.join(dist, "assets"));
const editorChunks = assets.filter((asset) => /^editor-.*\.js$/.test(asset));
// KaTeX rides with the editor chunk (math statically imports it) but must stay
// off the first paint exactly like the editor itself.
const katexChunks = assets.filter((asset) => /^katex-.*\.js$/.test(asset));

if (editorChunks.length === 0) {
  throw new Error("lazy-editor contract failed: the build produced no editor chunk");
}
const lazyOnly = [...editorChunks, ...katexChunks];
const eager = [...preloads, ...scripts].filter((asset) => lazyOnly.includes(asset));
if (eager.length > 0) {
  throw new Error(
    `lazy-editor contract failed: editor/katex chunk is loaded by index.html (${eager.join(", ")})`,
  );
}
// Per-language highlight.js grammars must stay their own lazy chunks — if this
// count hits zero, someone's import pattern folded them into the editor chunk
// (the regression the CM-era codeLanguages contract guarded).
const langChunks = assets.filter((asset) => /^(typescript|python|rust|bash)-.*\.js$/.test(asset));
if (langChunks.length === 0) {
  throw new Error("lazy-editor contract failed: no per-language syntax chunks were emitted");
}

console.log(
  `lazy-editor contract passed (${editorChunks.length} editor + ${katexChunks.length} katex chunks, none eager)`,
);
