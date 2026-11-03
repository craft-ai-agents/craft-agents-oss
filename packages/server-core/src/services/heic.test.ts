import { describe, expect, it } from 'bun:test'
import sharp from 'sharp'
import {
  isHeicMime,
  isHeicExtension,
  isHeicBuffer,
  decodeHeicToJpeg,
  decodeHeicWithImageIO,
  decodeHeicWithLibheif,
  ensureDecodableImage,
} from './heic'

// A 320x240 HEIC (ftyp brand "heix" / "mif1") produced by `sips -s format heic`.
// Small enough to embed; exercises the real decode path.
const HEIC_FIXTURE_BASE64 =
  'AAAAJGZ0eXBoZWl4AAAAAG1pZjFNaVByTWlIQW1pYWZoZWl4AAABhm1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAHBpY3QAAAAAAAAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAAADnBpdG0AAAAAAAEAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABodmMxAAAAAOZpcHJwAAAAxWlwY28AAAATY29scm5jbHgAAgACAAaAAAAADGNsbGkAywBAAAAAFGlzcGUAAAAAAAABQAAAAPAAAAAJaXJvdAAAAAAQcGl4aQAAAAADCgoKAAAAcWh2Y0MBAiAAAACwAAAAAAA88AD8/fr6AAALA6AAAQAYQAEMAf//AiAAAAMAsAAAAwAAAwA8FwJAoQABACJCAQECIAAAAwCwAAADAAADADygCggPE2IF7kWVTcCAgYAgogABAAlEAcBgnLIRFNkAAAAZaXBtYQAAAAAAAAABAAEGgQIDBYaEAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAAboAAAGRAAAAAW1kYXQAAAAAAAABoQAAAY0oAa+IPHdL06NM8nhNkn0g3ndTBr39mz8JdQjMh9tzUr99AlshR2yj+b/Nnlzx/vk63ypyhdfi27wRugQwkOlYcUOBAQZQWzIQlO1BMiuxWd2kmFoF4tk9LZK3t+T/HUtQ3nna/UPny16EP6+KYhG+K1x0fPC/KiI6N3UTNfwmXf+TywVgZ63YqASry4KAcM53k7ZjLtUGorJCPWRdrCHeLHb0Dm7zn5dpmEvWJ//qjJXCvJj62kRL1bHoev2AOKLxJN9IgOiCY3NNnweAL2Gga78wXVN4X894baneJpKVpHJFoiEOgEpgZ8L1EEL58Y9tXxH+3/YF5K2bfaBpX2YqQZ9RFiI8OvqqgE2DPI2teIyrSI4Egx448AZIMBGNypUhPdbNAR/ldRz56gPU96l94E1tmw/8n+NIlBu+lQw0nXYoXRa1Ty5atw06oArsmkn3XW4xhUcOkXFc8PYNZAFmx0nY6lvLeDFSkXxCbkBS8jvm/VKugWv7/CoVqy8YtPGASCzfWY2AAAADAAOm'

// A 64x32 HEIC stored sideways like an iPhone photo: `irot` 270° (from EXIF orientation 6), a
// Display P3 profile, 4:2:0. Upright it is 32x64, a red 8x8 marker at the top-left on a fill that
// is sRGB (40,160,120), stored as the P3 values (80,158,121). Made with sharp, then
// `sips --matchTo "Display P3.icc" -s format heic`.
const ROTATED_P3_HEIC_BASE64 =
  'AAAAJGZ0eXBoZWljAAAAAG1pZjFNaVBybWlhZk1pSEJoZWljAAAD1G1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAHBpY3QAAAAAAAAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAAADnBpdG0AAAAAAAEAAAA4aWluZgAAAAAAAgAAABVpbmZlAgAAAAABAABodmMxAAAAABVpbmZlAgAAAQACAABFeGlmAAAAABppcmVmAAAAAAAAAA5jZHNjAAIAAQABAAAC92lwcnAAAALWaXBjbwAAAiRjb2xycHJvZgAAAhhhcHBsBAAAAG1udHJSR0IgWFlaIAfmAAEAAQAAAAAAAGFjc3BBUFBMAAAAAEFQUEwAAAAAAAAAAAAAAAAAAAAAAAD21gABAAAAANMtYXBwbAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACmRlc2MAAAD8AAAAMGNwcnQAAAEsAAAAUHd0cHQAAAF8AAAAFHJYWVoAAAGQAAAAFGdYWVoAAAGkAAAAFGJYWVoAAAG4AAAAFHJUUkMAAAHMAAAAIGNoYWQAAAHsAAAALGJUUkMAAAHMAAAAIGdUUkMAAAHMAAAAIG1sdWMAAAAAAAAAAQAAAAxlblVTAAAAFAAAABwARABpAHMAcABsAGEAeQAgAFAAM21sdWMAAAAAAAAAAQAAAAxlblVTAAAANAAAABwAQwBvAHAAeQByAGkAZwBoAHQAIABBAHAAcABsAGUAIABJAG4AYwAuACwAIAAyADAAMgAyWFlaIAAAAAAAAPbVAAEAAAAA0yxYWVogAAAAAAAAg98AAD2/////u1hZWiAAAAAAAABKvwAAsTcAAAq5WFlaIAAAAAAAACg4AAARCwAAyLlwYXJhAAAAAAADAAAAAmZmAADypwAADVkAABPQAAAKW3NmMzIAAAAAAAEMQgAABd7///MmAAAHkwAA/ZD///ui///9owAAA9wAAMBuAAAADGNsbGkAywBAAAAAFGlzcGUAAAAAAAAAQAAAACAAAAAJaXJvdAMAAAAQcGl4aQAAAAADCAgIAAAAcWh2Y0MBA3AAAACwAAAAAAAe8AD8/fj4AAALA6AAAQAXQAEMAf//A3AAAAMAsAAAAwAAAwAecCShAAEAI0IBAQNwAAADALAAAAMAAAMAHqAUIEHBjCOIe5FlU3AgIGAIogABAAlEAcBghLIRFNkAAAAZaXBtYQAAAAAAAAABAAEGgQIDBYaEAAAALGlsb2MAAAAARAAAAgABAAAAAQAABLoAAAByAAIAAAABAAAECAAAALIAAAABbWRhdAAAAAAAAAE0AAAABkV4aWYAAE1NACoAAAAIAAUBEgADAAAAAQAGAAABGgAFAAAAAQAAAEoBGwAFAAAAAQAAAFIBKAADAAAAAQACAACHaQAEAAAAAQAAAFoAAAAAAAAAfwAAAAUAAAB/AAAABQAGkAAABwAAAAQwMjEwkQEABwAAAAQBAgMAoAAABwAAAAQwMTAwoAEAAwAAAAH//wAAoAIABAAAAAEAAABAoAMABAAAAAEAAAAgAAAAAAAAAG4oAa+j1IA71T58v/4f//iO77ryUSR0yYxwW5PmBypdTfo1zpr87/hNqC0z/MC/etrYZrXaXtjCcsrhL07jl96w00d8EPp/8JsKA97mVkOh11nSmuc53vtwiJPQTAcOtPhpWm9OLz/y6q/u1ZL8hw=='

const heicBuffer = Buffer.from(HEIC_FIXTURE_BASE64, 'base64')
const rotatedP3Heic = Buffer.from(ROTATED_P3_HEIC_BASE64, 'base64')
const SRGB_FILL = [40, 160, 120]
const isMac = process.platform === 'darwin'
// 1x1 PNG.
const pngBuffer = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5n2WQAAAAASUVORK5CYII=',
  'base64',
)

/** A decoded image's size, EXIF orientation, ICC profile and RGB values. */
async function inspect(jpeg: Buffer) {
  const meta = await sharp(jpeg).metadata()
  const { data, info } = await sharp(jpeg).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const rgb = (x: number, y: number) => {
    const i = (y * info.width + x) * 3
    return [data[i]!, data[i + 1]!, data[i + 2]!]
  }
  return { width: info.width, height: info.height, orientation: meta.orientation, icc: meta.icc, rgb }
}

const isRed = ([r, g, b]: number[]) => r! > 200 && g! < 80 && b! < 80
/** The largest difference between two colors, per channel. */
const colorDelta = (a: number[], b: number[]) => Math.max(...a.map((value, i) => Math.abs(value - b[i]!)))

/** The rotated fixture came out upright, with no orientation tag left for a reader to apply again. */
async function expectUpright(jpeg: Buffer) {
  const image = await inspect(jpeg)
  expect([image.width, image.height]).toEqual([32, 64])
  expect(image.orientation).toBeUndefined()
  expect(isRed(image.rgb(2, 2))).toBe(true)
  expect(isRed(image.rgb(29, 2))).toBe(false)
  expect(isRed(image.rgb(2, 61))).toBe(false)
}

describe('isHeicMime', () => {
  it('matches HEIC/HEIF mime types case-insensitively', () => {
    expect(isHeicMime('image/heic')).toBe(true)
    expect(isHeicMime('image/heif')).toBe(true)
    expect(isHeicMime('IMAGE/HEIC-SEQUENCE')).toBe(true)
  })
  it('rejects other mime types and nullish input', () => {
    expect(isHeicMime('image/png')).toBe(false)
    expect(isHeicMime('image/jpeg')).toBe(false)
    expect(isHeicMime(undefined)).toBe(false)
    expect(isHeicMime(null)).toBe(false)
  })
})

describe('isHeicExtension', () => {
  it('matches .heic/.heif paths case-insensitively', () => {
    expect(isHeicExtension('/a/b/IMG_0001.HEIC')).toBe(true)
    expect(isHeicExtension('photo.heif')).toBe(true)
  })
  it('rejects other extensions', () => {
    expect(isHeicExtension('photo.jpg')).toBe(false)
    expect(isHeicExtension('photo')).toBe(false)
  })
})

describe('isHeicBuffer', () => {
  it('detects a real HEIC file by ftyp brand', () => {
    expect(isHeicBuffer(heicBuffer)).toBe(true)
  })
  it('rejects non-HEIC and truncated buffers', () => {
    expect(isHeicBuffer(pngBuffer)).toBe(false)
    expect(isHeicBuffer(Buffer.from([0, 0, 0]))).toBe(false)
  })
})

describe('decodeHeicToJpeg', () => {
  it('decodes a HEIC buffer to a valid JPEG', async () => {
    const jpeg = await decodeHeicToJpeg(heicBuffer)
    // JPEG SOI/EOI markers.
    expect(jpeg[0]).toBe(0xff)
    expect(jpeg[1]).toBe(0xd8)
    expect(jpeg[jpeg.length - 2]).toBe(0xff)
    expect(jpeg[jpeg.length - 1]).toBe(0xd9)
  })

  it.skipIf(!isMac)('decodes with ImageIO on macOS', async () => {
    const image = await inspect(await decodeHeicToJpeg(rotatedP3Heic))
    expect(colorDelta(image.rgb(16, 40), SRGB_FILL)).toBeLessThanOrEqual(5)
  })

  it('rejects input that is not an image, after trying both decoders', async () => {
    const notAnImage = Buffer.concat([Buffer.from('\0\0\0\x18ftypheic\0\0\0\0mif1heic', 'latin1'), Buffer.alloc(64, 7)])
    await expect(decodeHeicToJpeg(notAnImage)).rejects.toThrow()
  })
})

describe('decodeHeicWithImageIO', () => {
  it.skipIf(!isMac)('turns a rotated photo upright', async () => {
    await expectUpright(await decodeHeicWithImageIO(rotatedP3Heic))
  })

  it.skipIf(!isMac)('converts Display P3 to untagged sRGB, the space every consumer assumes', async () => {
    const image = await inspect(await decodeHeicWithImageIO(rotatedP3Heic))
    expect(image.icc).toBeUndefined()
    expect(colorDelta(image.rgb(16, 40), SRGB_FILL)).toBeLessThanOrEqual(5)
  })
})

describe('decodeHeicWithLibheif', () => {
  it('turns a rotated photo upright', async () => {
    await expectUpright(await decodeHeicWithLibheif(rotatedP3Heic))
  })
})

describe('ensureDecodableImage', () => {
  it('transcodes a HEIC buffer to JPEG', async () => {
    const out = await ensureDecodableImage(heicBuffer)
    expect(Buffer.isBuffer(out)).toBe(true)
    const buf = out as Buffer
    expect(buf[0]).toBe(0xff)
    expect(buf[1]).toBe(0xd8)
  })
  it('passes non-HEIC buffers through unchanged', async () => {
    const out = await ensureDecodableImage(pngBuffer)
    expect(out).toBe(pngBuffer)
  })
  it('passes non-HEIC paths through unchanged', async () => {
    const out = await ensureDecodableImage('/tmp/photo.png')
    expect(out).toBe('/tmp/photo.png')
  })
})
