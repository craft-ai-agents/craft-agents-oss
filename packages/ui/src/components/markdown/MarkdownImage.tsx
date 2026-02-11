import * as React from 'react'
import { usePlatform } from '../../context/PlatformContext'

/**
 * Module-level data URL cache — prevents redundant IPC calls during streaming
 * re-renders where react-markdown remounts components on every content update.
 * FIFO eviction when exceeding MAX_CACHE_SIZE entries.
 */
const dataUrlCache = new Map<string, string>()
const MAX_CACHE_SIZE = 50

/** In-flight dedup — reuse the same promise if a path is already loading */
const inFlightRequests = new Map<string, Promise<string>>()

function cacheSet(key: string, value: string) {
  if (dataUrlCache.size >= MAX_CACHE_SIZE) {
    // Evict oldest entry (first inserted)
    const firstKey = dataUrlCache.keys().next().value
    if (firstKey !== undefined) dataUrlCache.delete(firstKey)
  }
  dataUrlCache.set(key, value)
}

/** Check if src is a local file path (starts with /, ~/, or ./) */
function isLocalPath(src: string): boolean {
  return /^(?:\/|~\/|\.\/)/.test(src)
}

interface MarkdownImageProps {
  src?: string
  alt?: string
  /** Callback when the image is clicked — routes through link interceptor to ImagePreviewOverlay */
  onFileClick?: (path: string) => void
}

/**
 * MarkdownImage — Custom img component for react-markdown.
 *
 * Handles three URL types:
 * - `data:` / `http(s):` → render <img> directly
 * - Local file paths (`/`, `~/`, `./`) → async-load via IPC through PlatformContext
 * - Falls back to alt text when platform doesn't support file reading (web viewer)
 */
export function MarkdownImage({ src, alt, onFileClick }: MarkdownImageProps) {
  const { onReadFileAsDataUrl } = usePlatform()
  const [dataUrl, setDataUrl] = React.useState<string | null>(null)
  const [error, setError] = React.useState(false)
  const [loading, setLoading] = React.useState(false)

  // Determine the effective src: either a direct URL or a path needing IPC resolution
  const isLocal = src ? isLocalPath(src) : false
  const isDirectUrl = src ? (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://')) : false

  React.useEffect(() => {
    if (!src || !isLocal) return

    // Check cache first
    const cached = dataUrlCache.get(src)
    if (cached) {
      setDataUrl(cached)
      return
    }

    // Platform doesn't support file reading (web viewer)
    if (!onReadFileAsDataUrl) {
      setError(true)
      return
    }

    setLoading(true)
    setError(false)

    // Check for in-flight request to avoid duplicate IPC calls
    let promise = inFlightRequests.get(src)
    if (!promise) {
      promise = onReadFileAsDataUrl(src)
      inFlightRequests.set(src, promise)
      // Clean up in-flight entry when done
      promise.finally(() => inFlightRequests.delete(src))
    }

    const currentSrc = src
    promise
      .then((url) => {
        cacheSet(currentSrc, url)
        setDataUrl(url)
        setLoading(false)
      })
      .catch(() => {
        setError(true)
        setLoading(false)
      })
  }, [src, isLocal, onReadFileAsDataUrl])

  // No src — render nothing
  if (!src) return null

  // Error state — show filename in muted text
  if (error) {
    const filename = src.split('/').pop() || src
    return (
      <span className="text-muted-foreground italic text-sm">
        {alt || filename} (image not found)
      </span>
    )
  }

  // Loading state — skeleton placeholder
  if (isLocal && loading && !dataUrl) {
    return (
      <div className="animate-pulse bg-muted/30 rounded-lg my-2 w-full max-w-md h-48" />
    )
  }

  // Determine the final image URL to render
  const resolvedSrc = isDirectUrl ? src : isLocal ? dataUrl : src
  if (!resolvedSrc) {
    // Local path without platform support — degrade to alt text
    if (alt) return <span className="text-muted-foreground italic text-sm">{alt}</span>
    return null
  }

  const handleClick = () => {
    if (onFileClick && src) {
      onFileClick(src)
    }
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt || ''}
      onClick={handleClick}
      className="max-w-full rounded-md my-2 cursor-pointer hover:opacity-90 transition-opacity"
    />
  )
}
