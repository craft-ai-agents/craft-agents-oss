/**
 * Tar Extractor — minimal tar.gz extraction for sound pack installation.
 *
 * Uses Node.js built-in zlib for decompression and a simple tar parser.
 * No external dependencies required.
 */

import { createWriteStream, mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createUnzip } from 'node:zlib'
import { Readable } from 'node:stream'
import { createHash } from 'node:crypto'

/**
 * Extract a tar.gz archive to a target directory, optionally from a subdirectory.
 *
 * GitHub tarballs have a top-level directory like `repo-name-tag/`,
 * so we strip that prefix and optionally filter to a subdirectory.
 */
export async function extractTarball(
  data: ArrayBuffer,
  targetDir: string,
  packName: string,
  sourcePath: string = '.',
): Promise<void> {
  const destDir = join(targetDir, packName)
  mkdirSync(destDir, { recursive: true })

  // Decompress gzip
  const gzStream = createUnzip()
  const readable = Readable.from(Buffer.from(data))
  const decompressed = readable.pipe(gzStream)

  // Parse tar entries
  const files = await parseTar(decompressed)

  for (const file of files) {
    // Normalize path: strip the top-level directory (repo-tag prefix)
    const normalizedPath = stripPrefix(file.path)

    // If sourcePath is specified (e.g., "acolyte_de"), only extract from that subdirectory
    let relativePath = normalizedPath
    if (sourcePath && sourcePath !== '.') {
      if (!normalizedPath.startsWith(sourcePath + '/')) continue
      relativePath = normalizedPath.slice(sourcePath.length + 1)
    }

    if (!relativePath || file.type === 'directory') {
      const dir = join(destDir, relativePath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      continue
    }

    const filePath = join(destDir, relativePath)
    const fileDir = dirname(filePath)
    if (!existsSync(fileDir)) mkdirSync(fileDir, { recursive: true })

    writeFileSync(filePath, file.data)
  }
}

/**
 * Strip the first path component (the repo-tag prefix from GitHub archives).
 */
function stripPrefix(p: string): string {
  const idx = p.indexOf('/')
  return idx >= 0 ? p.slice(idx + 1) : p
}

interface TarEntry {
  path: string
  type: 'file' | 'directory' | 'link' | 'other'
  data: Buffer
  size: number
}

/**
 * Minimal tar parser — reads POSIX (ustar) and GNU tar formats.
 * Handles regular files and directories.
 */
async function parseTar(stream: Readable): Promise<TarEntry[]> {
  const chunks: Buffer[] = []

  return new Promise((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => chunks.push(chunk))
    stream.on('end', () => {
      try {
        const buffer = Buffer.concat(chunks)
        const entries: TarEntry[] = []
        let offset = 0

        while (offset + 512 <= buffer.length) {
          // Read header block (512 bytes)
          const header = buffer.subarray(offset, offset + 512)

          // Check for end-of-archive (two zero blocks)
          if (header.every(b => b === 0)) break

          // Parse name (null-terminated string, 100 bytes)
          const name = readString(header, 0, 100)
          // Parse size (octal string, 12 bytes at offset 124)
          const sizeStr = readString(header, 124, 12)
          const size = sizeStr ? parseInt(sizeStr, 8) : 0
          // Parse type flag (1 byte at offset 156)
          const typeFlag = header[156]

          // Parse prefix (155 bytes at offset 345) for ustar long names
          const prefix = readString(header, 345, 155)
          const fullPath = prefix ? `${prefix}/${name}` : name

          // Skip header block
          offset += 512

          // Read data blocks (rounded up to 512-byte boundary)
          const dataBlocks = Math.ceil(size / 512)
          const data = buffer.subarray(offset, offset + size)

          let type: TarEntry['type']
          if (typeFlag === 0 || typeFlag === 0x30) { // Regular file
            type = 'file'
          } else if (typeFlag === 0x35) { // Directory
            type = 'directory'
          } else if (typeFlag === 0x31 || typeFlag === 0x32) { // Link
            type = 'link'
          } else {
            type = 'other'
          }

          if (type === 'file' && size > 0) {
            entries.push({
              path: fullPath,
              type,
              data: Buffer.from(data),
              size,
            })
          } else if (type === 'directory') {
            entries.push({
              path: fullPath,
              type,
              data: Buffer.alloc(0),
              size: 0,
            })
          }

          offset += dataBlocks * 512
        }

        resolve(entries)
      } catch (err) {
        reject(err)
      }
    })
    stream.on('error', reject)
  })
}

function readString(buffer: Buffer, start: number, length: number): string {
  const slice = buffer.subarray(start, start + length)
  // Find null terminator
  const nullIdx = slice.indexOf(0)
  const end = nullIdx >= 0 ? nullIdx : length
  return slice.subarray(0, end).toString('utf-8').trim()
}
