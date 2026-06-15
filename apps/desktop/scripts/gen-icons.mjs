// Generates placeholder app icons (paper background + plum block cursor) with
// zero dependencies, so `tauri dev` works out of the box. For full
// cross-platform bundling (.icns/.ico), run:  pnpm tauri icon src-tauri/app-icon.png
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function png(size) {
  const w = size,
    h = size;
  const paper = [244, 239, 230, 255];
  const accent = [168, 86, 120, 255]; // plum
  const raw = Buffer.alloc(h * (1 + w * 4));
  const bw = Math.max(2, Math.round(w * 0.16)),
    bh = Math.round(h * 0.42);
  const bx0 = Math.round((w - bw) / 2),
    by0 = Math.round((h - bh) / 2);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const inBlock = x >= bx0 && x < bx0 + bw && y >= by0 && y < by0 + bh;
      const c = inBlock ? accent : paper;
      raw[o++] = c[0];
      raw[o++] = c[1];
      raw[o++] = c[2];
      raw[o++] = c[3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const iconsDir = new URL("../src-tauri/icons/", import.meta.url);
mkdirSync(iconsDir, { recursive: true });
const write = (name, size) => writeFileSync(new URL(name, iconsDir), png(size));
write("32x32.png", 32);
write("128x128.png", 128);
write("128x128@2x.png", 256);
write("icon.png", 512);
// Source for `tauri icon` to generate the full cross-platform set.
writeFileSync(new URL("../app-icon.png", iconsDir), png(1024));
console.log("✓ generated placeholder icons in src-tauri/icons/");
