#!/usr/bin/env node
/**
 * apps/electron/resources/generate-icon-set.mjs
 *
 * Canonical renderer for the ARCHstudio app icon. Reads
 * apps/electron/resources/icon.svg and rasterises it into a complete
 * multi-size asset set under apps/electron/resources/icon-set/, then
 * assembles a Windows ICO and a macOS ICNS so the Win- / macOS- /
 * PNG-triplet and the splash-screen symbol all draw from the same SVG.
 *
 * Output layout (apps/electron/resources/icon-set/):
 *     icon.svg            canonical vector source
 *     icon-16.png         16x16 PNG
 *     icon-24.png         24x24 PNG
 *     icon-32.png         32x32 PNG
 *     icon-48.png         48x48 PNG
 *     icon-64.png         64x64 PNG
 *     icon-128.png        128x128 PNG
 *     icon-256.png        256x256 PNG
 *     icon-512.png        512x512 PNG   (Icns ic09)
 *     icon-1024.png       1024x1024 PNG (Icns ic10, canonical icon.png)
 *     icon-2048.png       2048x2048 PNG (large export, not in ICO/ICNS)
 *     icon.png            canonical 1024 export
 *     icon.ico            multi-size Windows ICO (16/24/32/48/64/128/256, PNG-encoded)
 *     icon.icns           multi-size macOS ICNS (16/32/64/128/256/512/1024)
 *     diag/*.png          per-run visual sanity renders
 *
 * Sync: by default the script copies icon.svg, icon.png, icon.ico and
 * icon.icns into apps/electron/resources/ so electron-builder picks
 * them up. We COPY (not symlink) because electron-builder snapshots
 * the resources folder at build time and Windows + electron-builder
 * both resolve symlinks inconsistently across package -- a copy is a
 * frozen-snapshot artefact by definition.
 *
 * Usage:
 *   node apps/electron/resources/generate-icon-set.mjs
 *   node apps/electron/resources/generate-icon-set.mjs --no-sync
 *   node apps/electron/resources/generate-icon-set.mjs --out=./out
 *   node apps/electron/resources/generate-icon-set.mjs --out ./out --no-sync
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..', '..')
const RESOURCES = path.join(ROOT, 'apps', 'electron', 'resources')
const ICONSET = path.join(RESOURCES, 'icon-set')
const SVG_SRC = path.join(RESOURCES, 'icon.svg')

const PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024, 2048]
// Windows ICO caps at 256 (uint8 width byte -- 0 = 256). Vista+ reads
// PNG-encoded entries cleanly for every size below that.
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
// macOS ICNS standard tags. icp = lowercase 'p' = PNG-encoded; ic07-10
// cover the modern (Big Sur+) ladder.
const ICNS_TAGS = [
  { size: 16,   tag: 'icp4' },
  { size: 32,   tag: 'icp5' },
  { size: 64,   tag: 'icp6' },
  { size: 128,  tag: 'ic07' },
  { size: 256,  tag: 'ic08' },
  { size: 512,  tag: 'ic09' },
  { size: 1024, tag: 'ic10' },
]

// Argv parsing -- supports --out=PATH and --out PATH.
const argv = process.argv.slice(2)
const noSync = argv.includes('--no-sync')
let OUT_DIR = ICONSET
{
  const eqIdx = argv.findIndex(a => a === '--out' || a.startsWith('--out='))
  if (eqIdx >= 0) {
    const arg = argv[eqIdx]
    if (arg === '--out' && eqIdx + 1 < argv.length) {
      OUT_DIR = path.resolve(argv[eqIdx + 1])
    } else if (arg.startsWith('--out=')) {
      OUT_DIR = path.resolve(arg.slice('--out='.length))
    }
  }
}

async function checkReadable(file) {
  try {
    await fs.promises.access(file, fs.constants.R_OK)
    return true
  } catch {
    return false
  }
}

function rel(p) { return path.relative(ROOT, p) }

async function rasterize(svg, size) {
  // density: 384 -> librsvg rasterises the SVG at ~2x first, sharp
  // downscales with Lanczos for crisp facets at every output size.
  return sharp(svg, { density: 384 })
    .resize(size, size, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9 })
    .toBuffer()
}

/**
 * Build a multi-entry Windows ICO. ICONDIRHEADER (6 bytes) +
 * ICONDIRENTRY (16 bytes per entry) + PNG-encoded payloads. The
 * width and height fields are uint8, so 256 is encoded as 0 (the
 * standard convention).
 */
function buildIco(pngBySize) {
  const sizes = Object.keys(pngBySize).map(Number).sort((a, b) => a - b)
  const numEntries = sizes.length
  const headerLen = 6 + 16 * numEntries
  const dirEntries = []
  const dataChunks = []
  let cursor = headerLen
  for (const s of sizes) {
    const png = pngBySize[s]
    dirEntries.push({
      widthByte: s >= 256 ? 0 : s,
      heightByte: s >= 256 ? 0 : s,
      colorCount: 0,
      reserved: 0,
      planes: 1,
      bitCount: 32,
      sizeInBytes: png.length,
      offset: cursor,
    })
    dataChunks.push(png)
    cursor += png.length
  }
  const total = headerLen + dataChunks.reduce((n, c) => n + c.length, 0)
  const buf = Buffer.alloc(total)
  buf.writeUInt16LE(0, 0)
  buf.writeUInt16LE(1, 2)
  buf.writeUInt16LE(numEntries, 4)
  let p = 6
  for (const e of dirEntries) {
    buf.writeUInt8(e.widthByte, p + 0)
    buf.writeUInt8(e.heightByte, p + 1)
    buf.writeUInt8(e.colorCount, p + 2)
    buf.writeUInt8(e.reserved, p + 3)
    buf.writeUInt16LE(e.planes, p + 4)
    buf.writeUInt16LE(e.bitCount, p + 6)
    buf.writeUInt32LE(e.sizeInBytes, p + 8)
    buf.writeUInt32LE(e.offset, p + 12)
    p += 16
  }
  let q = headerLen
  for (const chunk of dataChunks) {
    chunk.copy(buf, q)
    q += chunk.length
  }
  return buf
}

/**
 * Build an Apple ICNS container. Each entry is a 4-byte ASCII tag +
 * 4-byte BE uint32 length + PNG payload. The length field counts
 * the 8-byte entry header + the payload.
 */
function buildIcns(pngByTag) {
  const chunks = []
  let bodyLen = 0
  for (const { tag, png } of pngByTag) {
    const entryLen = 8 + png.length
    const header = Buffer.alloc(8)
    header.write(tag, 0, 4, 'ascii')
    header.writeUInt32BE(entryLen, 4)
    chunks.push(header, png)
    bodyLen += entryLen
  }
  const total = 8 + bodyLen
  const out = Buffer.alloc(total)
  out.write('icns', 0, 4, 'ascii')
  out.writeUInt32BE(total, 4)
  let p = 8
  for (const chunk of chunks) {
    chunk.copy(out, p)
    p += chunk.length
  }
  return out
}

/**
 * Re-read every output from disk and assert the on-disk contents
 * match what we wrote. Catches truncation, mismatched dimensions,
 * missing entries in ICO/ICNS, etc.
 */
async function verify() {
  console.log('==> Sanity-checking outputs...')
  const expected = {
    16: 'icon-16.png', 24: 'icon-24.png', 32: 'icon-32.png', 48: 'icon-48.png',
    64: 'icon-64.png', 128: 'icon-128.png', 256: 'icon-256.png', 512: 'icon-512.png',
    1024: 'icon-1024.png', 2048: 'icon-2048.png',
  }
  for (const [size, name] of Object.entries(expected)) {
    const meta = await sharp(path.join(OUT_DIR, name)).metadata()
    if (meta.width !== Number(size) || meta.height !== Number(size)) {
      throw new Error(`${name}: expected ${size}x${size}, got ${meta.width}x${meta.height}`)
    }
  }
  console.log(`   ${Object.keys(expected).length} PNGs at expected dimensions OK`)

  const icoBuf = await fs.promises.readFile(path.join(OUT_DIR, 'icon.ico'))
  if (icoBuf.readUInt16LE(0) !== 0 || icoBuf.readUInt16LE(2) !== 1 ||
      icoBuf.readUInt16LE(4) !== ICO_SIZES.length) {
    throw new Error('icon.ico header invalid (expected reserved=0, type=1, count=' +
      ICO_SIZES.length + ')')
  }
  let icoOff = 6
  for (const s of ICO_SIZES) {
    const expectedWidth = s >= 256 ? 0 : s
    const actualWidth = icoBuf.readUInt8(icoOff)
    if (actualWidth !== expectedWidth) {
      throw new Error(`icon.ico entry ${s}: width=${actualWidth}, expected ${expectedWidth}`)
    }
    icoOff += 16
  }
  console.log(`   icon.ico: ${ICO_SIZES.length} entries, header + widths OK`)

  const icnsBuf = await fs.promises.readFile(path.join(OUT_DIR, 'icon.icns'))
  if (icnsBuf.slice(0, 4).toString('ascii') !== 'icns') {
    throw new Error('icon.icns magic != icns')
  }
  let p = 8
  let entries = 0
  while (p < icnsBuf.length) {
    const entrySize = icnsBuf.readUInt32BE(p + 4)
    p += entrySize
    entries++
    if (entrySize < 8 || entrySize > icnsBuf.length) {
      throw new Error(`icon.icns entry #${entries} bad size: ${entrySize}`)
    }
  }
  if (entries !== ICNS_TAGS.length) {
    throw new Error(`icon.icns entry count ${entries} expected ${ICNS_TAGS.length}`)
  }
  console.log(`   icon.icns: ${entries} entries, magic OK`)

  const canonical = await sharp(path.join(OUT_DIR, 'icon.png')).metadata()
  if (canonical.width !== 1024 || canonical.height !== 1024) {
    throw new Error(`icon.png: expected 1024x1024, got ${canonical.width}x${canonical.height}`)
  }
  console.log(`   icon.png (canonical): 1024x1024 OK`)
  console.log('==> Sanity check passed.')
}

async function main() {
  if (!(await checkReadable(SVG_SRC))) {
    console.error(`FATAL: source SVG not readable: ${SVG_SRC}`)
    process.exit(1)
  }
  await fs.promises.mkdir(OUT_DIR, { recursive: true })
  await fs.promises.mkdir(path.join(OUT_DIR, 'diag'), { recursive: true })

  console.log(`==> Reading SVG: ${rel(SVG_SRC)}`)
  const svg = await fs.promises.readFile(SVG_SRC)
  const svgOut = path.join(OUT_DIR, 'icon.svg')
  await fs.promises.writeFile(svgOut, svg)
  console.log(`   copied -> ${rel(svgOut)}`)

  console.log('==> Rasterising to PNGs...')
  const pngBySize = {}
  for (const size of PNG_SIZES) {
    const png = await rasterize(svg, size)
    pngBySize[size] = png
    const pngPath = path.join(OUT_DIR, `icon-${size}.png`)
    await fs.promises.writeFile(pngPath, png)
    console.log(`   ${String(size).padStart(4)}x${String(size).padEnd(4)}  ${png.length} bytes  ${rel(pngPath)}`)
  }

  const canonicalPng = path.join(OUT_DIR, 'icon.png')
  await fs.promises.copyFile(path.join(OUT_DIR, 'icon-1024.png'), canonicalPng)
  console.log(`==> Canonical icon.png = 1024 export  ${rel(canonicalPng)}`)

  for (const size of [512, 1024]) {
    await fs.promises.copyFile(
      path.join(OUT_DIR, `icon-${size}.png`),
      path.join(OUT_DIR, 'diag', `icon-${size}.png`)
    )
  }
  console.log(`==> Diag copies -> ${rel(path.join(OUT_DIR, 'diag'))}`)

  console.log('==> Assembling Windows ICO...')
  const icoBuf = buildIco(Object.fromEntries(ICO_SIZES.map(s => [s, pngBySize[s]])))
  const icoPath = path.join(OUT_DIR, 'icon.ico')
  await fs.promises.writeFile(icoPath, icoBuf)
  console.log(`   ${ICO_SIZES.length} entries (${ICO_SIZES.join(', ')}) -> ${rel(icoPath)} (${icoBuf.length} bytes)`)

  console.log('==> Assembling macOS ICNS...')
  const icnsBuf = buildIcns(ICNS_TAGS.map(({ size, tag }) => ({ tag, png: pngBySize[size] })))
  const icnsPath = path.join(OUT_DIR, 'icon.icns')
  await fs.promises.writeFile(icnsPath, icnsBuf)
  console.log(`   ${ICNS_TAGS.length} entries (${ICNS_TAGS.map(t => `${t.tag}=${t.size}`).join(', ')}) -> ${rel(icnsPath)} (${icnsBuf.length} bytes)`)

  await verify()

  if (!noSync) {
    console.log('==> Syncing canonical assets into resources/...')
    for (const name of ['icon.svg', 'icon.png', 'icon.ico', 'icon.icns']) {
      await fs.promises.copyFile(path.join(OUT_DIR, name), path.join(RESOURCES, name))
      console.log(`   ${name} -> ${rel(path.join(RESOURCES, name))}`)
    }
    await fs.promises.copyFile(
      path.join(OUT_DIR, 'icon-512.png'),
      path.join(RESOURCES, 'source.png')
    )
    console.log(`   source.png (back-compat alias) -> ${rel(path.join(RESOURCES, 'source.png'))}`)
  } else {
    console.log('==> --no-sync: skipping resources/ sync.')
  }

  console.log('==> Done. Hash summary:')
  const crypto = await import('node:crypto')
  for (const size of PNG_SIZES) {
    const h = crypto.createHash('sha256').update(pngBySize[size]).digest('hex').slice(0, 12)
    console.log(`   icon-${String(size).padStart(4)}.png  sha256:${h}  ${pngBySize[size].length}b`)
  }
  const icoH = crypto.createHash('sha256').update(icoBuf).digest('hex').slice(0, 12)
  const icnsH = crypto.createHash('sha256').update(icnsBuf).digest('hex').slice(0, 12)
  console.log(`   icon.ico            sha256:${icoH}  ${icoBuf.length}b`)
  console.log(`   icon.icns           sha256:${icnsH}  ${icnsBuf.length}b`)
}

main().catch(err => { console.error('FATAL:', err); process.exit(1) })
