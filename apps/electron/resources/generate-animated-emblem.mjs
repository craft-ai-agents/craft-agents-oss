#!/usr/bin/env node
/**
 * apps/electron/resources/generate-animated-emblem.mjs
 *
 * Canonical renderer for the ANIMATED ARCHstudio emblem. Reads the
 * live splash geometry from apps/electron/src/renderer/components/icons/
 * SymbolMark.tsx (encoded inline below — there is no runtime SVG to
 * reuse because the animation uses CSS transforms that don't survive a
 * static rasteriser), bakes the per-frame ring rotation + diamond
 * pulse into 120 individual SVG frames at 512x512, then encodes both
 *
 *     anim.webm   (VP9 with alpha)
 *     anim.apng   (looping APNG)
 *     anim.meta.json   (sidecar metadata)
 *
 * The two formats share the exact same frame buffer so designers can
 * drop either into a marketing page, the README hero, or the splash
 * tester without re-encoding every time.
 *
 * Loop is mathematically seamless: 4s ring rotation + 2s diamond
 * pulse = exactly two pulse cycles per loop. (Live splash uses 1.6s
 * pulse which doesn't divide 4s evenly; we deliberately diverge here
 * so the static artefact loops cleanly without a visible seam.)
 *
 * Usage:
 *   node apps/electron/resources/generate-animated-emblem.mjs
 *   node apps/electron/resources/generate-animated-emblem.mjs --size=256
 *   node apps/electron/resources/generate-animated-emblem.mjs --fps=24
 *   node apps/electron/resources/generate-animated-emblem.mjs --out=/tmp/foo
 *
 * Requires: ffmpeg on PATH, sharp in node_modules.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import sharp from 'sharp'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..', '..')
const ICONSET_DEFAULT = path.join(ROOT, 'apps', 'electron', 'resources', 'icon-set')

const argv = process.argv.slice(2)
const getArg = (name, fallback) => {
  const eq = argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!eq) return fallback
  if (eq === `--${name}`) {
    const idx = argv.indexOf(eq)
    return idx + 1 < argv.length ? argv[idx + 1] : fallback
  }
  return eq.slice(`--${name}=`.length)
}
const SIZE = Number(getArg('size', '512'))
const FPS = Number(getArg('fps', '30'))
const DURATION_S = 4
const FRAMES = FPS * DURATION_S // 120

// Live splash uses a 1.6s diamond pulse; the static asset uses a pulse
// that fits an INTEGER number of cycles inside the loop so the seam is
// invisible. PULSES_PER_LOOP makes the intent explicit (and a one-line
// tweak if a designer wants 3 or 4 pulses instead of 2). See
// anim.meta.json's `note` field for the full rationale.
const PULSES_PER_LOOP = 2
const DIAMOND_PULSE_SECONDS_STATIC = DURATION_S / PULSES_PER_LOOP
const DIAMOND_PULSE_SECONDS_LIVE = 1.6

// --out lets the anim-regress script regenerate into a temp dir
// without overwriting the committed assets. Defaults to the canonical
// icon-set/ folder.
let OUT_DIR = getArg('out')
  ? path.resolve(getArg('out'))
  : ICONSET_DEFAULT
const TEMP_DIR = path.join(OUT_DIR, '.anim-frames')

// CSS ease-in-out ≈ cubic-bezier(0.42, 0, 0.58, 1). The pulse uses
// this easing in the live splash; we replicate it here for parity.
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/**
 * Frame math.
 *   - Ring rotates 360° over 4s, linear (matches live splash).
 *   - Diamond pulse uses a DIAMOND_PULSE_SECONDS_ASSET ease-in-out
 *     cycle so an integer number of cycles fits inside DURATION_S.
 */
function frameParams(i) {
  const t = i / FPS // seconds (0..4)
  const ringAngle = (t / DURATION_S) * 360

  const period = DIAMOND_PULSE_SECONDS_STATIC
  const phase = (t % period) / period
  const pulseT = phase < 0.5 ? phase * 2 : (1 - phase) * 2
  const eased = easeInOutCubic(pulseT)

  const dScale = 1 + 0.25 * eased   // 1 → 1.25 → 1
  const dOpacity = 1 - 0.15 * eased // 1 → 0.85 → 1

  return { ringAngle, dScale, dOpacity }
}

/**
 * Build an SVG string for one frame. Geometry mirrors SymbolMark.tsx
 * exactly (split green/purple ring, two-stroke A, crossbar, floating
 * diamond). The ring is wrapped in a <g> with the rotation transform;
 * the diamond is wrapped in a translate-scale-translate group so the
 * scale happens around (24, 32), the diamond's geometric centre.
 */
function buildFrameSvg({ ringAngle, dScale, dOpacity }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="${SIZE}" height="${SIZE}">
  <defs>
    <linearGradient id="lg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#86EFAC"/>
      <stop offset="55%" stop-color="#22C55E"/>
      <stop offset="100%" stop-color="#15803D"/>
    </linearGradient>
    <linearGradient id="rg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#E9D5FF"/>
      <stop offset="55%" stop-color="#A855F7"/>
      <stop offset="100%" stop-color="#6B21A8"/>
    </linearGradient>
  </defs>

  <g transform="rotate(${ringAngle.toFixed(3)} 24 24)">
    <path d="M 26 6 A 18 18 0 1 0 24 42" stroke="url(#lg)" stroke-width="3" stroke-linecap="round" fill="none"/>
    <path d="M 22 6 A 18 18 0 1 1 24 42" stroke="url(#rg)" stroke-width="3" stroke-linecap="round" fill="none"/>
  </g>

  <path d="M 24 4 L 10 38" stroke="url(#lg)" stroke-width="3" stroke-linecap="round"/>
  <path d="M 24 4 L 38 38" stroke="url(#rg)" stroke-width="3" stroke-linecap="round"/>
  <line x1="15" y1="26" x2="33" y2="26" stroke="url(#rg)" stroke-width="3" stroke-linecap="round"/>

  <g transform="translate(24 32) scale(${dScale.toFixed(4)}) translate(-24 -32)">
    <rect x="21.5" y="29.5" width="5" height="5" transform="rotate(45 24 32)" fill="url(#rg)" opacity="${dOpacity.toFixed(4)}"/>
  </g>
</svg>`
}

async function renderFrames() {
  await fs.promises.mkdir(TEMP_DIR, { recursive: true })
  console.log(`==> Rendering ${FRAMES} frames @ ${SIZE}x${SIZE} (${FPS}fps × ${DURATION_S}s)`)

  for (let i = 0; i < FRAMES; i++) {
    const params = frameParams(i)
    const svg = buildFrameSvg(params)
    const pad = String(i).padStart(3, '0')
    const outPath = path.join(TEMP_DIR, `frame-${pad}.png`)
    // Render at 4× density (density:384) for crisp gradient + stroke
    // edges, then explicitly resize down to the canvas size with Lanczos
    // so the IHDR matches what the encoder expects. (Without the resize
    // sharp emits a 2731×2731 PNG and ffmpeg's APNG muxer honors the
    // pixel dimensions — with the resize the IHDR is 512×512 and ffmpeg
    // is happy.)
    await sharp(Buffer.from(svg), { density: 384 })
      .resize(SIZE, SIZE, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        kernel: 'lanczos3',
      })
      .png({ compressionLevel: 9 })
      .toFile(outPath)
    if (i === 0 || i === FRAMES - 1 || i % 30 === 0) {
      console.log(`   frame-${pad}.png  ring=${params.ringAngle.toFixed(1)}°  scale=${params.dScale.toFixed(3)}  opacity=${params.dOpacity.toFixed(3)}`)
    }
  }
  console.log(`==> ${FRAMES} frames written -> ${path.relative(ROOT, TEMP_DIR)}`)
}

function encodeWebm() {
  const outPath = path.join(OUT_DIR, 'anim.webm')
  // libvpx-vp9 with yuva420p = VP9 with alpha. -b:v 0 + -crf pairs for
  // constant-quality mode. -auto-alt-ref 0 makes each frame reference
  // only the prior one (no alt-ref frame jumps) so the stream seeks
  // cleanly at any frame index.
  //
  // Determinism flags: -threads 1 + -tile-columns 0 + -frame-parallel 0
  // + -row-mt 0 disable every form of parallelism so consecutive runs
  // produce BYTE-IDENTICAL WebM files. Without these, libvpx-vp9 hashes
  // differ run-to-run and `bun run anim:regress` reports false-positive
  // drift on every CI build.
  const args = [
    '-y',
    '-framerate', String(FPS),
    '-i', path.join(TEMP_DIR, 'frame-%03d.png'),
    '-c:v', 'libvpx-vp9',
    '-pix_fmt', 'yuva420p',
    '-b:v', '0',
    '-crf', '32',
    '-auto-alt-ref', '0',
    '-threads', '1',
    '-tile-columns', '0',
    '-frame-parallel', '0',
    '-row-mt', '0',
    outPath,
  ]
  console.log(`==> ffmpeg -> ${path.relative(ROOT, outPath)}`)
  return runFfmpeg(args)
}

function encodeApng() {
  const outPath = path.join(OUT_DIR, 'anim.apng')
  // ffmpeg's apng muxer honours -plays 0 (infinite loop). -final_delay
  // pads the last frame so the loop dwells on frame N for one full
  // interval, which prevents a visible "skip" between frame N-1 and
  // the loop-back to frame 0.
  const args = [
    '-y',
    '-framerate', String(FPS),
    '-i', path.join(TEMP_DIR, 'frame-%03d.png'),
    '-plays', '0',
    '-final_delay', String(Math.round(1000 / FPS)),
    '-f', 'apng',
    outPath,
  ]
  console.log(`==> ffmpeg -> ${path.relative(ROOT, outPath)}`)
  return runFfmpeg(args)
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', code => {
      if (code !== 0) {
        console.error(stderr.split('\n').slice(-15).join('\n'))
        reject(new Error(`ffmpeg exited with code ${code}`))
      } else {
        resolve()
      }
    })
  })
}

async function cleanup() {
  await fs.promises.rm(TEMP_DIR, { recursive: true, force: true })
  console.log(`==> Cleaned up ${path.relative(ROOT, TEMP_DIR)}`)
}

/**
 * Write a sidecar meta.json so designers comparing the static asset
 * against the live splash know the pulse cadence deliberately differs.
 * Without this, the asset looks like an inconsistency to anyone who
 * runs the generator and then opens the splash screen.
 *
 * The pulse values come from the same constants the frame math uses
 * (DIAMOND_PULSE_SECONDS_ASSET / DIAMOND_PULSE_SECONDS_LIVE), so the
 * sidecar can never drift from the actual rendered animation.
 */
async function writeMetaJson() {
  const meta = {
    loopSeconds: DURATION_S,
    frames: FRAMES,
    fps: FPS,
    size: SIZE,
    ringRotationSeconds: DURATION_S,
    diamondPulseSecondsStatic: DIAMOND_PULSE_SECONDS_STATIC,
    diamondPulseSecondsLive: DIAMOND_PULSE_SECONDS_LIVE,
    note: 'Diamond pulse uses a 2s cycle in the static asset so exactly two pulse cycles fit inside the 4s loop and the seam is invisible. The live splash uses a 1.6s cycle which does not divide 4s evenly -- the live splash accepts a visible seam in exchange for a slightly snappier cadence.',
  }
  const metaPath = path.join(OUT_DIR, 'anim.meta.json')
  await fs.promises.writeFile(metaPath, JSON.stringify(meta, null, 2) + '\n')
  console.log(`==> ${path.relative(ROOT, metaPath)}`)
}

async function verifyOutputs() {
  console.log('==> Verifying outputs...')
  for (const name of ['anim.webm', 'anim.apng']) {
    const p = path.join(OUT_DIR, name)
    const stat = await fs.promises.stat(p)
    if (stat.size === 0) throw new Error(`${name} is empty`)
    console.log(`   ${name}  ${stat.size} bytes`)
  }
  // EBML/WebM magic = 0x1A 0x45 0xDF 0xA3
  const webm = await fs.promises.readFile(path.join(OUT_DIR, 'anim.webm'))
  if (webm[0] !== 0x1A || webm[1] !== 0x45 || webm[2] !== 0xDF || webm[3] !== 0xA3) {
    throw new Error('anim.webm: missing EBML magic header')
  }
  // APNG magic = 89 50 4E 47 0D 0A 1A 0A
  const apng = await fs.promises.readFile(path.join(OUT_DIR, 'anim.apng'))
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
  if (!apng.slice(0, 8).equals(sig)) {
    throw new Error('anim.apng: missing PNG signature')
  }
  // APNG must contain an acTL chunk (animation control). acTL signature
  // bytes: 61 63 54 4C.
  const acTL = Buffer.from('acTL', 'ascii')
  if (!apng.includes(acTL)) {
    throw new Error('anim.apng: no acTL chunk — not a valid animated PNG')
  }
  // Smoke-check anim.meta.json parses as valid JSON with the expected
  // shape. Catches truncated writes / disk-full mid-flush corruption that
  // byte-comparison alone would silently pass.
  const metaPath = path.join(OUT_DIR, 'anim.meta.json')
  const metaRaw = await fs.promises.readFile(metaPath, 'utf8')
  const meta = JSON.parse(metaRaw)  // throws on invalid JSON
  if (typeof meta.loopSeconds !== 'number' ||
      typeof meta.diamondPulseSecondsStatic !== 'number' ||
      typeof meta.diamondPulseSecondsLive !== 'number') {
    throw new Error('anim.meta.json: missing required numeric fields')
  }
  console.log('==> Outputs OK.')
}

async function main() {
  console.log(`==> Output dir: ${path.relative(ROOT, OUT_DIR)}`)
  console.log(`==> Size: ${SIZE}x${SIZE}   FPS: ${FPS}   Duration: ${DURATION_S}s   Frames: ${FRAMES}`)

  await renderFrames()
  await encodeWebm()
  await encodeApng()
  await cleanup()
  await writeMetaJson()
  await verifyOutputs()

  console.log('==> Hash summary:')
  const crypto = await import('node:crypto')
  for (const name of ['anim.webm', 'anim.apng']) {
    const buf = await fs.promises.readFile(path.join(OUT_DIR, name))
    const h = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12)
    console.log(`   ${name.padEnd(13)} sha256:${h}  ${buf.length}b`)
  }
  console.log('==> Done.')
}

main().catch(err => { console.error('FATAL:', err); process.exit(1) })
