/**
 * HEIC/HEIF support.
 *
 * iOS emits HEIC for photos and screenshots, but nothing in our image stack can
 * read it natively: Chromium has no HEIC codec for <img> previews, Electron's
 * nativeImage returns an empty image, and sharp's prebuilt binaries ship without
 * libheif (decoding it needs a source-built libvips). So we transcode HEIC/HEIF
 * to an upright sRGB JPEG at ingestion; every downstream consumer (model upload,
 * thumbnailing, preview) then works with plain JPEG.
 *
 * On macOS the decoder is ImageIO, the one Photos and Preview use, through
 * `sips`. Elsewhere, or when sips fails, it is the pure-JS `heic-convert`
 * (libheif + libde265 in wasm), which gets iPhone files visibly wrong: it drops
 * the color profile (Display P3 values read as sRGB look washed out), shifts
 * saturated colors, and can decode blocks of an image in the wrong colors.
 */

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { promisify } from 'node:util'
import { createLogger } from '@craft-agent/shared/utils'

const log = createLogger('heic')
const execFileAsync = promisify(execFile)

/** ImageIO's command-line tool, part of every macOS install. */
const SIPS_PATH = '/usr/bin/sips'
const SRGB_PROFILE_PATH = '/System/Library/ColorSync/Profiles/sRGB Profile.icc'
/** Per sips step; both steps together take about half a second for a 48 MP photo. */
const SIPS_TIMEOUT_MS = 30_000

/** MIME types that identify HEIC/HEIF still images and sequences. */
const HEIC_MIME_TYPES = new Set([
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
])

/** File extensions that identify HEIC/HEIF images. */
const HEIC_EXTENSIONS = new Set(['.heic', '.heif'])

/**
 * ISO-BMFF `ftyp` brands used by HEIC/HEIF files. iOS screenshots report a
 * `heic`/`heix` major brand with a `mif1` compatible brand; matching the whole
 * known set covers single-image and sequence variants from any encoder.
 */
const HEIC_FTYP_BRANDS = new Set([
  'heic', 'heix', 'heim', 'heis',
  'hevc', 'hevx', 'hevm', 'hevs',
  'mif1', 'msf1', 'miaf', 'heif',
])

export function isHeicMime(mimeType?: string | null): boolean {
  return !!mimeType && HEIC_MIME_TYPES.has(mimeType.toLowerCase())
}

export function isHeicExtension(path: string): boolean {
  return HEIC_EXTENSIONS.has(extname(path).toLowerCase())
}

/**
 * Detect HEIC/HEIF by ISO-BMFF magic bytes: a `ftyp` box (bytes 4..8) whose
 * major brand (bytes 8..12) is a known HEIC/HEIF brand. The brand set includes
 * the generic container brands (mif1/msf1), so the major brand alone identifies
 * every real-world HEIC. Content sniffing is the only signal for drag/paste
 * buffers, which carry no path and sometimes a wrong or empty MIME type.
 */
export function isHeicBuffer(buffer: Buffer): boolean {
  if (buffer.length < 12) return false
  if (buffer.toString('latin1', 4, 8) !== 'ftyp') return false
  return HEIC_FTYP_BRANDS.has(buffer.toString('latin1', 8, 12).trim())
}

/**
 * Decode the primary image of a HEIC/HEIF buffer to an upright sRGB JPEG
 * (`quality` 0–1): ImageIO on macOS, `heic-convert` elsewhere or when sips fails.
 */
export async function decodeHeicToJpeg(buffer: Buffer, quality = 0.92): Promise<Buffer> {
  if (process.platform === 'darwin') {
    try {
      return await decodeHeicWithImageIO(buffer, quality)
    } catch (error) {
      // execFile's message repeats the whole command line; sips's first stderr line is the reason
      const reason = (error as { stderr?: string }).stderr?.trim().split('\n')[0]
        || (error instanceof Error ? error.message : String(error))
      log.warn(`sips could not decode the HEIC image (${reason}), using heic-convert`)
    }
  }
  return decodeHeicWithLibheif(buffer, quality)
}

/**
 * macOS only. Two sips steps, because sips keeps a photo's rotation as an EXIF
 * tag in a JPEG with the pixels as stored, and nativeImage and the model ignore
 * that tag. A BMP has no such tag, so sips turns the pixels upright for it, and
 * `--matchTo` converts them from the file's profile (an iPhone's Display P3) to
 * sRGB, what every consumer assumes for an untagged image. Then BMP → JPEG.
 */
export async function decodeHeicWithImageIO(buffer: Buffer, quality = 0.92): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'craft-heic-'))
  try {
    const heic = join(dir, 'image.heic')
    const bmp = join(dir, 'image.bmp')
    const jpeg = join(dir, 'image.jpg')
    await writeFile(heic, buffer)
    await sips(['--matchTo', SRGB_PROFILE_PATH, '-s', 'format', 'bmp', heic, '--out', bmp])
    await sips(['-s', 'format', 'jpeg', '-s', 'formatOptions', String(Math.round(quality * 100)), bmp, '--out', jpeg])
    return await readFile(jpeg)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function sips(args: string[]): Promise<void> {
  await execFileAsync(SIPS_PATH, args, { timeout: SIPS_TIMEOUT_MS })
}

/** The pure-JS decoder, on any platform. Upright, but with the limits above. */
export async function decodeHeicWithLibheif(buffer: Buffer, quality = 0.92): Promise<Buffer> {
  const convert = (await import('heic-convert')).default
  const out = await convert({ buffer, format: 'JPEG', quality })
  return Buffer.from(out)
}

/**
 * Normalize an image-processor input so downstream decoders (sharp /
 * nativeImage) can read it: HEIC/HEIF inputs are transcoded to a JPEG buffer,
 * everything else is returned untouched. Accepts a Buffer or a file path.
 */
export async function ensureDecodableImage(input: Buffer | string): Promise<Buffer | string> {
  if (typeof input === 'string') {
    if (!isHeicExtension(input)) return input
    return decodeHeicToJpeg(await readFile(input))
  }
  if (!isHeicBuffer(input)) return input
  return decodeHeicToJpeg(input)
}
