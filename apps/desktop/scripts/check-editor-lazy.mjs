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

if (editorChunks.length === 0) {
  throw new Error("lazy-editor contract failed: the build produced no editor chunk");
}
const eagerEditor = [...preloads, ...scripts].filter((asset) => editorChunks.includes(asset));
if (eagerEditor.length > 0) {
  throw new Error(
    `lazy-editor contract failed: editor chunk is loaded by index.html (${eagerEditor.join(", ")})`,
  );
}

console.log(
  `lazy-editor contract passed (${editorChunks.length} editor ${editorChunks.length === 1 ? "chunk" : "chunks"}, none eager)`,
);
