/**
 * ThumbnailHoverPreview - Wraps a thumbnail element and shows a larger
 * popover preview on hover.
 *
 * Use cases
 * ─────────
 * - Session Files rail (`FileThumbnail` in SessionFilesSection.tsx):
 *   14x14 inline thumbnail expands to ~480px popover on hover.
 * - Working Directory rail (in LayoutShell.tsx): same component, same
 *   IPC, just rendered next to a slightly bigger thumb.
 *
 * Why fixed positioning
 * ─────────────────────
 * The right sidebar rail uses `overflow-y: auto` so absolute-positioned
 * descendants get clipped at the rail boundary. The popover would hit
 * the edge of the rail and disappear into the scrollbar. We render the
 * popover OUTSIDE the rail DOM tree (sibling of the anchor `<span>`)
 * and use `position: fixed` so it's free of any ancestor's overflow.
 * Coordinates are measured at hover start via `getBoundingClientRect()`
 * so they line up with the anchor regardless of the rail's scroll
 * position or sidebar collapse state.
 *
 * Caching
 * ───────
 * Module-level LRU (max 64 entries) keyed by `${path}|${previewSize}`.
 * Re-hovering the same file is instant; cycling through 64 distinct
 * files evicts the oldest. Cache survives row collapse/expand and
 * working-directory navigation — only full panel unmount flushes it.
 *
 * Performance
 * ───────────
 * - 150 ms hover debounce avoids firing the IPC on mouseover that
 *   immediately turns into a scroll past the thumbnail.
 * - 60 ms hide-on-leave delay keeps the popover open long enough to
 *   bridge a small movement from thumb → popover without flicker.
 * - Mouseenter on the popover itself cancels the hide-on-leave timer
 *   so the user can hover the larger image to inspect it without
 *   losing the popover on a stray micro-movement.
 *
 * Failure modes
 * ─────────────
 * - `readFilePreviewDataUrl` rejects (binary, no permission, very large
 *   file): renders a compact "Preview unavailable" placeholder with the
 *   filename, never throws to the host.
 * - File deleted/moved while popover open: next hover triggers a new
 *   fetch which will fail; gracefully handled.
 * - Symbol/directory passed in: caller should set `disabled=true` so
 *   the component renders the child unchanged.
 */

import * as React from 'react'
import { useState, useRef, useCallback, useEffect, memo } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { cn } from '@/lib/utils'

// ── Module-level LRU cache ───────────────────────────────────────────────
// Plain `Map` preserves insertion order, so `keys().next().value` is the
// oldest entry. We refresh the order on every `get` (LRU) and evict
// from the front when the cache is over the cap.
const PREVIEW_CACHE = new Map<string, string>()
const CACHE_MAX = 64

// ── Module-level pinned paths ────────────────────────────────────────────
// Clicking a thumbnail pins its popover open. Pins survive re-renders and
// working-directory navigation because they're stored in a module-level Set
// keyed by absolute file path. Cycling sessions or collapsing the rail and
// re-expanding it preserves the pin — only a full unmount of the module
// (i.e. a page navigation or hard refresh) clears the set.
const PINNED_FILES = new Set<string>()

// Regex matching video file extensions — used to detect when the IPC
// `readFilePreviewDataUrl` call would fail (it only handles images) and
// fall back to the Electron `thumbnail://` protocol which can extract
// a frame from video files via nativeImage.createThumbnailFromPath.
const VIDEO_EXT_RE = /\.(mp4|mov|webm|mkv|avi|m4v)$/i

function cacheGet(key: string): string | null {
  const value = PREVIEW_CACHE.get(key)
  if (value !== undefined) {
    PREVIEW_CACHE.delete(key)
    PREVIEW_CACHE.set(key, value)
    return value
  }
  return null
}

function cacheSet(key: string, value: string): void {
  if (PREVIEW_CACHE.has(key)) PREVIEW_CACHE.delete(key)
  PREVIEW_CACHE.set(key, value)
  while (PREVIEW_CACHE.size > CACHE_MAX) {
    const oldestKey = PREVIEW_CACHE.keys().next().value
    if (oldestKey !== undefined) PREVIEW_CACHE.delete(oldestKey)
  }
}

// ── Component ─────────────────────────────────────────────────────────────

export interface HoverPreviewFile {
  /** Absolute filesystem path; used as the IPC input. */
  path: string
  /** Display label rendered in the popover caption. Falls back to basename(path). */
  name?: string
  /** Optional MIME type; reserved for future image-type-aware rendering. */
  mimeType?: string
}

export interface ThumbnailHoverPreviewProps {
  file: HoverPreviewFile
  /** The thumbnail element (small, 14-32px). Wrapped by an anchor span. */
  children: React.ReactElement
  /** Hover delay before opening (ms). Default 150. */
  delay?: number
  /** Max preview dimension (px) passed to readFilePreviewDataUrl. Default 1024. */
  previewSize?: number
  /** Disable the popover entirely (e.g. for non-image files). */
  disabled?: boolean
  className?: string
}

interface PreviewPosition {
  /** Vertical center of the popover in viewport pixels (clamped to viewport). */
  top: number
  /** Distance from viewport's right edge to the popover's left edge, in px. */
  left: number
}

/**
 * Convert a path into a displayable filename. Falls back to the full
 * path string when there's nothing to split on.
 */
function deriveDisplayName(file: HoverPreviewFile): string {
  if (file.name) return file.name
  // path is OS-agnostic — split on both separators, then take the tail.
  const parts = file.path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? file.path
}

const ThumbnailHoverPreview = memo(function ThumbnailHoverPreview({
  file,
  children,
  delay = 150,
  previewSize = 1024,
  disabled = false,
  className,
}: ThumbnailHoverPreviewProps) {
  const anchorRef = useRef<HTMLSpanElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)

  const [open, setOpen] = useState(false)
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [position, setPosition] = useState<PreviewPosition | null>(null)

  const enterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Generation counter — a fetch captures the generation at call time and
  // only commits its result if the generation is still current after the
  // IPC resolves. Without this, a stale fetch from a previous `file.path`
  // could write its data URL into the new file's popover (the cleaner
  // 'cancelledRef' approach doesn't work: cleanup sets it true, the next
  // effect run sets it false again before the stale resolve lands).
  const generationRef = useRef(0)

  const cacheKey = `${file.path}|${previewSize}`

  // Pinned state — initialised from the module-level set so pin survives
  // row collapse/expand and working-directory navigation within the same
  // session.
  const [pinned, setPinned] = useState(() => PINNED_FILES.has(file.path))

  // Reset state + bump generation on file change OR unmount so any
  // in-flight IPC settles harmlessly into the void if its generation
  // has moved on. Without the cleanup bump, an unmount while the IPC
  // is in flight would still pass the genAtCall check on resolve and
  // call setState on the (just-unmounted) instance — React 18 swallows
  // it silently, but it's wasted work and conceptually wrong.
  useEffect(() => {
    generationRef.current += 1
    setOpen(false)
    setSrc(null)
    setFailed(false)
    setPosition(null)
    setPinned(PINNED_FILES.has(file.path))
    return () => {
      generationRef.current += 1
      if (enterTimerRef.current) clearTimeout(enterTimerRef.current)
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current)
    }
  }, [file.path, previewSize])

  const loadPreview = useCallback(async () => {
    const cached = cacheGet(cacheKey)
    if (cached) {
      setSrc(cached)
      setFailed(false)
      return
    }

    // Video files: readFilePreviewDataUrl fails (imageProcessor only handles
    // images). Use the Electron thumbnail:// protocol which extracts a frame
    // via nativeImage.createThumbnailFromPath (macOS/Windows). The URL is
    // deterministic, no async IO needed — the browser loads it on-demand.
    // The ?size= parameter requests a larger frame than the 64px default
    // so the popover preview isn't pixelated.
    if (VIDEO_EXT_RE.test(file.path)) {
      const url = 'thumbnail://thumb/' + encodeURIComponent(file.path) + '?size=' + Math.max(previewSize, 256)
      setFailed(false)
      cacheSet(cacheKey, url)
      setSrc(url)
      return
    }

    if (typeof window === 'undefined' || !window.electronAPI?.readFilePreviewDataUrl) {
      setFailed(true)
      return
    }
    // Capture generation BEFORE awaiting so a file.path swap mid-flight
    // invalidates the result.
    const genAtCall = generationRef.current
    try {
      const url = await window.electronAPI.readFilePreviewDataUrl(file.path, previewSize)
      if (generationRef.current !== genAtCall) return
      if (!url) {
        setFailed(true)
        return
      }
      cacheSet(cacheKey, url)
      setSrc(url)
    } catch {
      if (generationRef.current === genAtCall) setFailed(true)
    }
  }, [cacheKey, file.path, previewSize])

  const handleEnter = useCallback(() => {
    if (disabled) return
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current)
      leaveTimerRef.current = null
    }
    enterTimerRef.current = setTimeout(() => {
      // Measure anchor position at the moment we open so the popover
      // lines up with the row even if the user scrolled while debounced.
      const anchor = anchorRef.current
      if (anchor) {
        const rect = anchor.getBoundingClientRect()
        const vertical = rect.top + rect.height / 2
        // Clamp into viewport so the popover doesn't fly off the top
        // or bottom when the anchor sits near an edge.
        const top = Math.max(
          80,
          Math.min(vertical, window.innerHeight - 80),
        )
        // Popover extends LEFT into the main content area (sidebar lives
        // on the right edge). `left = rect.left - 12` puts the popover's
        // left edge 12px to the left of the anchor's left edge.
        setPosition({ top, left: Math.max(8, rect.left - 12) })
      }
      setOpen(true)
      void loadPreview()
    }, delay)
  }, [disabled, loadPreview, delay])

  const handleLeave = useCallback(() => {
    if (enterTimerRef.current) {
      clearTimeout(enterTimerRef.current)
      enterTimerRef.current = null
    }
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current)
    leaveTimerRef.current = setTimeout(() => {
      setOpen(false)
    }, 60)
  }, [])

  const handlePopoverEnter = useCallback(() => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current)
      leaveTimerRef.current = null
    }
  }, [])

  // ── Pin / unpin ───────────────────────────────────────────────────────
  const handleAnchorClick = useCallback((e: React.MouseEvent) => {
    if (disabled) return
    e.stopPropagation()
    setPinned((prev) => {
      const next = !prev
      if (next) {
        PINNED_FILES.add(file.path)
        // Ensure the popover is open and positioned when pinning
        const anchor = anchorRef.current
        if (anchor && !open) {
          const rect = anchor.getBoundingClientRect()
          const vertical = rect.top + rect.height / 2
          const top = Math.max(80, Math.min(vertical, window.innerHeight - 80))
          setPosition({ top, left: Math.max(8, rect.left - 12) })
        }
        setOpen(true)
        void loadPreview()
      } else {
        PINNED_FILES.delete(file.path)
        setOpen(false)
      }
      return next
    })
  }, [disabled, file.path, open, loadPreview])

  const handleUnpin = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    PINNED_FILES.delete(file.path)
    setPinned(false)
    setOpen(false)
  }, [file.path])

  // Click-outside detection for pinned popovers
  useEffect(() => {
    if (!pinned) return
    const handleDocClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        PINNED_FILES.delete(file.path)
        setPinned(false)
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleDocClick)
    return () => document.removeEventListener('mousedown', handleDocClick)
  }, [pinned, file.path])

  // Escape while pinned closes the popover
  useEffect(() => {
    if (!pinned) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        PINNED_FILES.delete(file.path)
        setPinned(false)
        setOpen(false)
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [pinned, file.path])

  // ── Re-measure anchor position on scroll/resize ─────────────────────
  //
  // While open, listen for window scroll + resize and re-compute position
  // via requestAnimationFrame throttling so the popover follows its anchor
  // when the user scrolls the right rail or resizes the window.
  // Without this, the popover drifts away from the thumbnail immediately
  // on any scroll — the original measurement is only taken at hover-start.
  const rAFRef = useRef<number | null>(null)
  const pendingUpdateRef = useRef(false)

  const reAnchor = useCallback(() => {
    if (pendingUpdateRef.current) return
    pendingUpdateRef.current = true
    rAFRef.current = requestAnimationFrame(() => {
      pendingUpdateRef.current = false
      const anchor = anchorRef.current
      if (anchor) {
        const rect = anchor.getBoundingClientRect()
        const vertical = rect.top + rect.height / 2
        setPosition({
          top: Math.max(80, Math.min(vertical, window.innerHeight - 80)),
          left: Math.max(8, rect.left - 12),
        })
      }
    })
  }, [])

  useEffect(() => {
    if (!open) return
    window.addEventListener('scroll', reAnchor, { passive: true, capture: true })
    window.addEventListener('resize', reAnchor, { passive: true })
    return () => {
      window.removeEventListener('scroll', reAnchor, { capture: true })
      window.removeEventListener('resize', reAnchor)
      if (rAFRef.current !== null) {
        cancelAnimationFrame(rAFRef.current)
        rAFRef.current = null
      }
      pendingUpdateRef.current = false
    }
  }, [open, reAnchor])

  // When pinned, override the leave timer so the popover stays open
  const effectiveHandleLeave = useCallback(() => {
    if (pinned) return
    if (enterTimerRef.current) {
      clearTimeout(enterTimerRef.current)
      enterTimerRef.current = null
    }
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current)
    leaveTimerRef.current = setTimeout(() => {
      setOpen(false)
    }, 60)
  }, [pinned])

  if (disabled) return children

  return (
    <>
      <span
        ref={anchorRef}
        className={cn('thumbnail-hover-preview__anchor', className)}
        onMouseEnter={handleEnter}
        onMouseLeave={effectiveHandleLeave}
        onClick={handleAnchorClick}
      >
        {children}
      </span>
      <AnimatePresence>
        {open && position && (
          <motion.div
            key={`thumb-popover-${cacheKey}`}
            // `y: '-50%'` keeps the vertical centering translate AS PART
            // OF motion's transform, so motion owns the full transform
            // property. We deliberately do NOT set `transform` in our CSS
            // class (`.thumbnail-hover-preview__popover`) — setting both
            // there and here would have the late inline style stomp the
            // CSS translate, and post-animation motion's settled value
            // would lose the centered positioning. Result: popover
            // extends leftward from the anchor, vertically centered.
            initial={{ opacity: 0, scale: 0.96, x: 4, y: '-50%' }}
            animate={{ opacity: 1, scale: 1, x: 0, y: '-50%' }}
            exit={{ opacity: 0, scale: 0.96, x: 4, y: '-50%' }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="thumbnail-hover-preview__popover"
            style={{
              position: 'fixed',
              top: position.top,
              right: typeof window !== 'undefined'
                ? window.innerWidth - position.left
                : 0,
            }}
            ref={popoverRef}
            onMouseEnter={handlePopoverEnter}
            onMouseLeave={effectiveHandleLeave}
            data-testid="thumbnail-hover-preview-popover"
            data-pinned={pinned ? 'true' : 'false'}
          >
            {pinned && (
              <button
                type="button"
                aria-label="Unpin preview"
                className="thumbnail-hover-preview__pin-close"
                onClick={handleUnpin}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                </svg>
              </button>
            )}
            <div
              className="thumbnail-hover-preview__frame"
              data-loading={!src && !failed ? 'true' : 'false'}
              data-failed={failed ? 'true' : 'false'}
            >
              {!src && !failed ? (
                <div className="thumbnail-hover-preview__spinner" aria-hidden="true">
                  <span className="thumbnail-hover-preview__dot" />
                </div>
              ) : failed ? (
                <div className="thumbnail-hover-preview__error">
                  <span>Preview unavailable</span>
                </div>
              ) : (
                <img
                  src={src ?? undefined}
                  alt={deriveDisplayName(file)}
                  draggable={false}
                  className="thumbnail-hover-preview__img"
                />
              )}
            </div>
            <div className="thumbnail-hover-preview__caption">
              <span className="thumbnail-hover-preview__name">{deriveDisplayName(file)}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
})

export { ThumbnailHoverPreview }
