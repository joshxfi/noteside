// Generates the macOS app-icon master (1024×1024) for Noteside.
//
// The mark is the canonical brand lockup — a serif "N" with the plum block
// cursor beside it (NOT the "NI" favicon) — set on the warm-paper tile. The
// cursor must stay plum (brand rule), so the tile is paper, never plum.
//
// Geometry respects the macOS icon grid: a centered 824pt continuous-corner
// "squircle" on a 1024pt canvas (≈100pt transparent margin), so it sits at the
// same visual weight as native Tahoe icons in the Dock rather than full-bleed.
//
//   swift apps/desktop/scripts/gen-app-icon.swift
//   → writes apps/desktop/src-tauri/app-icon.png
//
// Then regenerate the bundle icons:
//   pnpm --filter @noteside/desktop tauri icon src-tauri/app-icon.png
import AppKit

let CANVAS: CGFloat = 1024
let BODY: CGFloat = 824 // macOS icon-grid front layer
let center = CGPoint(x: CANVAS / 2, y: CANVAS / 2)

func rgb(_ hex: UInt32) -> CGColor {
  CGColor(
    srgbRed: CGFloat((hex >> 16) & 0xff) / 255,
    green: CGFloat((hex >> 8) & 0xff) / 255,
    blue: CGFloat(hex & 0xff) / 255,
    alpha: 1)
}
let paper = rgb(0xf9f5ed)
let ink = rgb(0x3b2f27)
let plum = rgb(0xa05e7e)
let rule = rgb(0xe0d8ce)

// Continuous-corner squircle (superellipse, n≈5) — the macOS icon silhouette.
func squircle(center c: CGPoint, half a: CGFloat, n: CGFloat = 5) -> CGPath {
  let p = CGMutablePath()
  let steps = 720
  for i in 0...steps {
    let t = CGFloat(i) / CGFloat(steps) * 2 * .pi
    let ct = cos(t), st = sin(t)
    let x = a * copysign(pow(abs(ct), 2 / n), ct)
    let y = a * copysign(pow(abs(st), 2 / n), st)
    let pt = CGPoint(x: c.x + x, y: c.y + y)
    if i == 0 { p.move(to: pt) } else { p.addLine(to: pt) }
  }
  p.closeSubpath()
  return p
}

let cs = CGColorSpace(name: CGColorSpace.sRGB)!
let ctx = CGContext(
  data: nil, width: Int(CANVAS), height: Int(CANVAS), bitsPerComponent: 8,
  bytesPerRow: 0, space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
ctx.setAllowsAntialiasing(true)
ctx.interpolationQuality = .high

// ── tile ──────────────────────────────────────────────────────────────
let body = squircle(center: center, half: BODY / 2)
ctx.addPath(body)
ctx.setFillColor(paper)
ctx.fillPath()
// hairline ring so the cream tile reads on light backgrounds
ctx.addPath(squircle(center: center, half: BODY / 2 - 3))
ctx.setStrokeColor(rule)
ctx.setLineWidth(4)
ctx.strokePath()

// ── mark: serif "N" + plum cursor ──────────────────────────────────────
// Proportions ported from the brand guide's 128pt tile (N=74, cursor 12×54,
// gap 5), scaled to the tile so the mark keeps its built-in clear space.
let fontSize = 0.578 * BODY
let cursorW = 0.094 * BODY
let cursorH = 0.422 * BODY
let gap = 0.039 * BODY

let base = NSFont.systemFont(ofSize: fontSize, weight: .semibold)
let serif = NSFont(descriptor: base.fontDescriptor.withDesign(.serif) ?? base.fontDescriptor,
  size: fontSize)!
let ctFont = serif as CTFont
var ch: [UniChar] = Array("N".utf16)
var glyph = [CGGlyph](repeating: 0, count: 1)
CTFontGetGlyphsForCharacters(ctFont, &ch, &glyph, 1)
let nPath = CTFontCreatePathForGlyph(ctFont, glyph[0], nil)!
let nBox = nPath.boundingBoxOfPath

let groupW = nBox.width + gap + cursorW
let startX = center.x - groupW / 2

// place the N: left edge at startX, optical center on the tile center
var tf = CGAffineTransform(translationX: startX - nBox.minX, y: center.y - nBox.midY)
let placedN = nPath.copy(using: &tf)!
ctx.addPath(placedN)
ctx.setFillColor(ink)
ctx.fillPath()

// the cursor block, vertically centered beside the N
let cursorRect = CGRect(
  x: startX + nBox.width + gap, y: center.y - cursorH / 2, width: cursorW, height: cursorH)
ctx.addPath(CGPath(
  roundedRect: cursorRect, cornerWidth: cursorW * 0.12, cornerHeight: cursorW * 0.12,
  transform: nil))
ctx.setFillColor(plum)
ctx.fillPath()

// ── write PNG ───────────────────────────────────────────────────────────
let img = ctx.makeImage()!
let rep = NSBitmapImageRep(cgImage: img)
let png = rep.representation(using: .png, properties: [:])!
let out = URL(fileURLWithPath: "apps/desktop/src-tauri/app-icon.png")
try! png.write(to: out)
print("wrote \(out.path) (\(Int(CANVAS))×\(Int(CANVAS)))")
