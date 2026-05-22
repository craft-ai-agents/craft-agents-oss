/**
 * Encoding-aware zip extraction.
 *
 * fflate's unzipSync always decodes filenames as UTF-8. ZIP files created on
 * Chinese Windows systems typically use GBK encoding for filenames and do NOT
 * set the UTF-8 flag (bit 11 in the general purpose bit flag). This helper
 * checks the flag per entry and decodes with GBK when UTF-8 is not indicated.
 *
 * Uses fflate's inflateSync for raw DEFLATE decompression (zip method 8).
 * Supports stored (method 0) and deflate (method 8) entries only.
 */

import { inflateSync } from 'fflate'

function readU16LE(buf: Uint8Array, off: number): number {
  return buf[off] | (buf[off + 1] << 8)
}

function readU32LE(buf: Uint8Array, off: number): number {
  return ((buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0)
}

const utf8 = new TextDecoder('utf-8')
let gbk: TextDecoder | null = null
function getGbkDecoder(): TextDecoder {
  if (!gbk) gbk = new TextDecoder('gbk')
  return gbk
}

function decodeName(rawBytes: Uint8Array, isUtf8: boolean): string {
  if (isUtf8) return utf8.decode(rawBytes)
  try {
    return getGbkDecoder().decode(rawBytes)
  } catch {
    return utf8.decode(rawBytes)
  }
}

/**
 * Unzip zip bytes with encoding-aware filename decoding.
 *
 * For each entry, the UTF-8 flag (bit 11 of general purpose bit flag) is checked:
 * - Flag set   → UTF-8 filename decoding (standard, e.g. Mac/Linux zips)
 * - Flag unset → GBK decoding (common for Chinese Windows-created zips)
 *
 * Returns Record<filename, fileBytes>, same shape as fflate's Unzipped type.
 * Directory entries (trailing '/') are omitted.
 */
export function unzipSyncEncoding(zipBytes: Uint8Array): Record<string, Uint8Array> {
  const len = zipBytes.length

  // Find End of Central Directory record: signature PK\x05\x06
  let eocdPos = -1
  for (let i = len - 22; i >= Math.max(0, len - 65558); i--) {
    if (
      zipBytes[i] === 0x50 && zipBytes[i + 1] === 0x4B &&
      zipBytes[i + 2] === 0x05 && zipBytes[i + 3] === 0x06
    ) {
      eocdPos = i
      break
    }
  }
  if (eocdPos < 0) throw new Error('Invalid zip: EOCD signature not found')

  const numEntries = readU16LE(zipBytes, eocdPos + 8)
  const cdOffset   = readU32LE(zipBytes, eocdPos + 16)

  const result: Record<string, Uint8Array> = {}
  let pos = cdOffset

  for (let i = 0; i < numEntries; i++) {
    // Central Directory Entry signature: PK\x01\x02
    if (
      zipBytes[pos] !== 0x50 || zipBytes[pos + 1] !== 0x4B ||
      zipBytes[pos + 2] !== 0x01 || zipBytes[pos + 3] !== 0x02
    ) break

    const gpFlag         = readU16LE(zipBytes, pos + 8)
    const method         = readU16LE(zipBytes, pos + 10)
    const compressedSize = readU32LE(zipBytes, pos + 20)
    const fileNameLen    = readU16LE(zipBytes, pos + 28)
    const extraLen       = readU16LE(zipBytes, pos + 30)
    const commentLen     = readU16LE(zipBytes, pos + 32)
    const localOffset    = readU32LE(zipBytes, pos + 42)

    const rawName  = zipBytes.slice(pos + 46, pos + 46 + fileNameLen)
    const isUtf8   = (gpFlag & 0x800) !== 0
    const fileName = decodeName(rawName, isUtf8)

    pos += 46 + fileNameLen + extraLen + commentLen

    if (fileName.endsWith('/')) continue        // skip directories
    if (method !== 0 && method !== 8) continue  // skip unsupported methods

    // Locate file data via Local File Header: signature PK\x03\x04
    const lfhNameLen  = readU16LE(zipBytes, localOffset + 26)
    const lfhExtraLen = readU16LE(zipBytes, localOffset + 28)
    const dataStart   = localOffset + 30 + lfhNameLen + lfhExtraLen
    const compData    = zipBytes.slice(dataStart, dataStart + compressedSize)

    result[fileName] = method === 0 ? compData : inflateSync(compData)
  }

  return result
}
