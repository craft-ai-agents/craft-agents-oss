/**
 * Thumbnail Protocol Handler
 *
 * Registers a custom `thumbnail://` protocol that serves thumbnail images
 * for files in the session sidebar. The browser handles all async loading
 * natively via <img src="thumbnail://encoded-path" />.
 *
 * Thumbnail generation strategy (cross-platform):
 * - macOS/Windows: nativeImage.createThumbnailFromPath() — uses OS-level
 *   thumbnail cache (Quick Look / Shell API). Fast (~5ms cached), handles
 *   images, PDFs, Office docs automatically.
 * - Linux: nativeImage.createFromPath() + resize() — uses Chromium's Skia
 *   engine. Works for images only. No PDF/Office support.
 *
 * Caching:
 * - In-memory LRU map keyed on `path + mtime`. Cache miss triggers generation.
 * - Entries auto-invalidate when file mtime changes (e.g. after file watcher fires).
 * - Capped at MAX_CACHE_ENTRIES to bound memory usage.
 */

import { protocol, nativeImage } from 'electron'
import { stat } from 'fs/promises'
import { isAbsolute } from 'path'
import { mainLog } from './logger'

/** Default thumbnail output size in pixels (width and height).
 *  The `?size=N` query parameter overrides this; clamped to 16–1024.
 *  The hover-preview popover requests `?size=1024` for video frames
 *  so they don't look pixelated at popover dimensions (~400px). */
const THUMBNAIL_SIZE = 64

/** Minimum size the `?size=` query parameter can request. */
const THUMB_SIZE_MIN = 16
/** Maximum size — arbitrary cap to bound memory per frame-grab. 1024px
 *  is generous for a popover; larger values add RAM pressure without
 *  visible benefit on typical screens. */
const THUMB_SIZE_MAX = 1024

/** Maximum entries in the in-memory LRU cache */
const MAX_CACHE_ENTRIES = 200

/** File extensions that support thumbnail generation */
const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'ico', 'heic', 'heif',
])

/** Extensions that only work via OS thumbnail API (macOS/Windows) */
const OS_THUMBNAIL_EXTENSIONS = new Set([
  'pdf', 'svg', 'psd', 'ai',
])

/** Video extensions — OS thumbnail API on macOS/Windows extracts the first
 *  frame automatically; Linux has no video support and falls through. */
const VIDEO_EXTENSIONS = new Set([
  'mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v',
])

/** All extensions we can potentially thumbnail */
const ALL_PREVIEWABLE = new Set([...IMAGE_EXTENSIONS, ...OS_THUMBNAIL_EXTENSIONS, ...VIDEO_EXTENSIONS])

// In-memory LRU cache: `path|size` -> { mtime, data }
// Size is part of the key so requests for the same file at different
// resolutions (e.g. 64px default in the WD tree, 1024px in the hover
// popover) don't return the wrong-sized cached data.
const cache = new Map<string, { mtime: number; data: Buffer }>()

/**
 * Evict oldest entries when cache exceeds max size.
 * Map iterates in insertion order, so first entries are oldest.
 */
function evictIfNeeded(): void {
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value
    if (oldestKey) cache.delete(oldestKey)
  }
}

/**
 * Check if the current platform supports OS-level thumbnail generation.
 * nativeImage.createThumbnailFromPath() is only available on macOS and Windows.
 */
const supportsOSThumbnails = process.platform === 'darwin' || process.platform === 'win32'

/**
 * Generate a thumbnail buffer for the given file path.
 * Returns a PNG buffer or null if generation fails/unsupported.
 */
async function generateThumbnail(filePath: string, ext: string, size: number = THUMBNAIL_SIZE): Promise<Buffer | null> {
  // Strategy 1: OS-level thumbnail (macOS/Windows) — handles images + PDFs + more
  if (supportsOSThumbnails) {
    try {
      const thumbnail = await nativeImage.createThumbnailFromPath(filePath, {
        width: size,
        height: size,
      })
      if (!thumbnail.isEmpty()) {
        return thumbnail.toPNG()
      }
    } catch {
      // OS thumbnail failed — fall through to Skia-based fallback for images
    }
  }

  // Strategy 2: Skia-based resize (all platforms) — images only.
  // Videos are handled by Strategy 1 on macOS/Windows; on Linux they
  // return null here (Skia can't decode video frames).
  if (IMAGE_EXTENSIONS.has(ext)) {
    try {
      const img = nativeImage.createFromPath(filePath)
      if (img.isEmpty()) return null
      const resized = img.resize({ width: size, height: size })
      return resized.toPNG()
    } catch {
      return null
    }
  }

  // Unsupported file type on this platform
  return null
}

/**
 * Register the thumbnail:// custom protocol scheme.
 * MUST be called before app.whenReady() — Electron requires scheme
 * registration during the earliest phase of app initialization.
 */
export function registerThumbnailScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'thumbnail',
      privileges: {
        // Allow the renderer to fetch from this scheme
        supportFetchAPI: true,
        // Standard scheme allows normal URL parsing (host, path, etc.)
        standard: true,
        // Allow cross-origin access from the renderer
        corsEnabled: true,
        // Stream support for efficient response delivery
        stream: true,
      },
    },
  ])
}

/**
 * Register the thumbnail:// protocol handler.
 * Must be called after app.whenReady() — the handler processes
 * incoming requests and returns thumbnail image responses.
 *
 * URL format: thumbnail://thumb/<encodeURIComponent(absolutePath)>
 * Examples:
 *   macOS:   thumbnail://thumb/%2FUsers%2Ffoo%2Fimage.png
 *   Windows: thumbnail://thumb/C%3A%5CUsers%5Cfoo%5Cimage.png
 */
export function registerThumbnailHandler(): void {
  protocol.handle('thumbnail', async (request) => {
    try {
      // Parse the file path + optional size from the URL
      // Format: thumbnail://thumb/<encoded-path>?size=N
      // URL.pathname includes a leading /, so we strip it before decoding
      const url = new URL(request.url)
      const filePath = decodeURIComponent(url.pathname.slice(1))

      // Resolve requested size from ?size= query param (default: THUMBNAIL_SIZE)
      const sizeParam = url.searchParams.get('size')
      const requestedSize = sizeParam
        ? Math.max(THUMB_SIZE_MIN, Math.min(THUMB_SIZE_MAX, parseInt(sizeParam, 10) || THUMBNAIL_SIZE))
        : THUMBNAIL_SIZE

      // Basic validation: must be an absolute path (works on all platforms)
      if (!filePath || !isAbsolute(filePath)) {
        return new Response(null, { status: 400 })
      }

      // Check file extension is previewable
      const ext = filePath.split('.').pop()?.toLowerCase() || ''
      if (!ALL_PREVIEWABLE.has(ext)) {
        return new Response(null, { status: 404 })
      }

      // Get file mtime for cache validation
      let mtime: number
      try {
        const fileStat = await stat(filePath)
        mtime = fileStat.mtimeMs
      } catch {
        // File doesn't exist or is inaccessible
        return new Response(null, { status: 404 })
      }

      // Build the compound cache key before the lookup — same `path|size`
      // format used by the store below so a lookup never misses because of
      // a key format mismatch.
      const cacheKey = filePath + '|' + requestedSize

      // Check cache — hit if (path, size, mtime) all match.
      const cached = cache.get(cacheKey)
      if (cached && cached.mtime === mtime) {
        return new Response(new Uint8Array(cached.data), {
          headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'max-age=3600',
          },
        })
      }

      // Cache miss — generate thumbnail at requested size
      const data = await generateThumbnail(filePath, ext, requestedSize)
      if (!data) {
        return new Response(null, { status: 404 })
      }

      // Store in cache (move to end for LRU behavior via delete+set).
      cache.delete(cacheKey)
      cache.set(cacheKey, { mtime, data })
      evictIfNeeded()

      return new Response(new Uint8Array(data), {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'max-age=3600',
        },
      })
    } catch (error) {
      mainLog.error('Thumbnail protocol error:', error)
      return new Response(null, { status: 500 })
    }
  })

  mainLog.info('Registered thumbnail:// protocol handler')
}
