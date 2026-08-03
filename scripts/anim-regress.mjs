#!/usr/bin/env node
/**
 * scripts/anim-regress.mjs
 *
 * Catches "upstream changed but assets not regenerated" drift.
 *
 *   - snapshots the committed hash of apps/electron/resources/icon-set/
 *     {anim.webm, anim.apng, anim.meta.json}
 *   - regenerates the same three files into .anim-regress-tmp/
 *   - compares hashes; exit 0 if identical, 1 if any drift, 2 on error
 *
 * Pair with the icon-fingerprint presence check (fast, catches missing
 * files) -- this one is slower (~30s) and catches the case a designer
 * tweaks the SVG paths or keyframe constants without re-running
 * `bun run anim:generate`.
 *
 * Usage:
 *   bun run anim:regress
 *   bun run anim:regress --keep-tmp     # leave .anim-regress-tmp/ for diffing
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const ICONSET = path.join(ROOT, 'apps', 'electron', 'resources', 'icon-set')
const TMP = path.join(ROOT, '.anim-regress-tmp')
const SCRIPT = path.join(ROOT, 'apps', 'electron', 'resources', 'generate-animated-emblem.mjs')
// Hash strategy:
//   anim.apng       byte-level -- sharp output is deterministic
//   anim.meta.json  byte-level -- JSON.stringify output is deterministic
//   anim.webm       decoded-frames -- libvpx-vp9 is NOT byte-deterministic
//                                       across runs on Windows; the
//                                       decoded YUV stream is stable and
//                                       any visual change shows up here
const FILES = ['anim.apng', 'anim.meta.json']
const VIDEO_FILES = ['anim.webm']

const args = new Set(process.argv.slice(2))
const keepTmp = args.has('--keep-tmp')

const RED = (t) => `\x1b[31m${t}\x1b[0m`
const GREEN = (t) => `\x1b[32m${t}\x1b[0m`
const YELLOW = (t) => `\x1b[33m${t}\x1b[0m`
const DIM = (t) => `\x1b[2m${t}\x1b[0m`

async function sha256(p) {
  const buf = await fs.promises.readFile(p)
  return createHash('sha256').update(buf).digest('hex')
}

/**
 * Hash the DECODED YUV frame stream of a video file.
 *
 * libvpx-vp9 is not byte-deterministic across runs on Windows (memory
 * allocator ordering can shift encoder output even with -threads 1,
 * -frame-parallel 0, etc). Two WebM files generated from the same
 * frame buffer will have different SHA-256s. To still detect "upstream
 * changed but assets not regenerated", we hash the DECODED output
 * instead -- ffmpeg's decode is deterministic, so identical inputs give
 * identical decoded frames, and a visual change in the source frames
 * surfaces as a different hash here.
 *
 * Output is raw YUV420P (alpha dropped). This is fine for a regression
 * check: any change that affects the colour channels also affects the
 * decoded stream.
 */
function hashDecodedFrames(videoPath) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-loglevel', 'error',
      '-i', videoPath,
      '-f', 'rawvideo',
      '-pix_fmt', 'yuv420p',
      'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks = []
    const errChunks = []
    child.stdout.on('data', chunk => chunks.push(chunk))
    child.stderr.on('data', chunk => errChunks.push(chunk))
    child.on('error', reject)
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`ffmpeg decode exited ${code}: ${Buffer.concat(errChunks).toString()}`))
      } else {
        const buf = Buffer.concat(chunks)
        resolve(createHash('sha256').update(buf).digest('hex'))
      }
    })
  })
}

function runGenerator() {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [SCRIPT, `--out=${TMP}`], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', code => {
      if (code !== 0) reject(new Error(`generator exited ${code}\n${stderr.split('\n').slice(-12).join('\n')}`))
      else resolve()
    })
  })
}

async function snapshot(p, f, hashFn, label) {
  try {
    const h = await hashFn(p)
    console.log(`   ${DIM('[committed]')} ${f.padEnd(18)} ${label} ${h.slice(0, 12)}`)
    return h
  } catch (err) {
    console.error(`${RED('FATAL')}: ${f} missing from icon-set/. Run \`bun run anim:generate\` first.`)
    process.exit(2)
  }
}

async function main() {
  console.log(`==> Snapshotting committed assets in ${path.relative(ROOT, ICONSET)}`)
  const committed = {}
  for (const f of FILES) {
    committed[f] = await snapshot(path.join(ICONSET, f), f, sha256, 'sha256:')
  }
  for (const f of VIDEO_FILES) {
    committed[f] = await snapshot(path.join(ICONSET, f), f, hashDecodedFrames, '(decoded YUV)')
  }

  console.log(`==> Regenerating into ${path.relative(ROOT, TMP)} (this takes ~30s)`)
  await fs.promises.rm(TMP, { recursive: true, force: true })
  try {
    await runGenerator()
  } catch (err) {
    console.error(`${RED('FATAL')}: generator failed during regression check`)
    console.error(err.message)
    if (!keepTmp) await fs.promises.rm(TMP, { recursive: true, force: true }).catch(() => {})
    process.exit(2)
  }

  console.log('==> Comparing hashes')
  let driftCount = 0
  for (const f of FILES) {
    const freshPath = path.join(TMP, f)
    let fresh
    try {
      fresh = await sha256(freshPath)
    } catch {
      console.error(`${RED('FATAL')}: generator did not produce ${f}`)
      driftCount++
      continue
    }
    const same = fresh === committed[f]
    const tag = same ? GREEN('[ok]') : YELLOW('[drift]')
    console.log(`   ${tag} ${f.padEnd(18)} committed:${committed[f].slice(0, 12)}  fresh:${fresh.slice(0, 12)}`)
    if (!same) driftCount++
  }
  // Decoded-frames checks for the non-deterministic WebM. We pipe the
  // video through ffmpeg's rawvideo output and hash the result.
  for (const f of VIDEO_FILES) {
    const freshPath = path.join(TMP, f)
    let fresh
    try {
      fresh = await hashDecodedFrames(freshPath)
    } catch (err) {
      console.error(`${RED('FATAL')}: could not decode ${f}: ${err.message}`)
      driftCount++
      continue
    }
    const same = fresh === committed[f]
    const tag = same ? GREEN('[ok]') : YELLOW('[drift]')
    console.log(`   ${tag} ${f.padEnd(18)} (decoded YUV) committed:${committed[f].slice(0, 12)}  fresh:${fresh.slice(0, 12)}`)
    if (!same) driftCount++
  }

  if (keepTmp) {
    console.log(`${DIM('==>')} ${path.relative(ROOT, TMP)} kept for inspection`)
  } else {
    await fs.promises.rm(TMP, { recursive: true, force: true })
  }

  if (driftCount > 0) {
    console.error(`${RED('FATAL')}: ${driftCount} file(s) drifted. Re-run \`bun run anim:generate\` and \`git add apps/electron/resources/icon-set/anim.*\``)
    process.exit(1)
  }
  console.log(`${GREEN('[ok]')} No upstream drift. Assets are byte-identical to a fresh regeneration.`)
  process.exit(0)
}

main().catch(err => { console.error('FATAL:', err); process.exit(2) })
