/**
 * AttachmentGrid — Shared component for rendering message attachments
 * with inline image previews and a click-to-zoom lightbox.
 *
 * Mirrors the attachment rendering logic from UserMessageBubble so both
 * user and assistant bubbles share the same visual treatment:
 *   - Single image → 240px cap (media tile)
 *   - 2+ images → 96x96 grid
 *   - Documents → compact pill layout
 *   - Click-to-zoom lightbox with backdrop/Escape/Open-in-app
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react'
import type { StoredAttachment } from '@craft-agent/core'
import { cn } from '../../lib/utils'
import { FileTypeIcon, getFileTypeLabel } from './attachment-helpers'
import { useTranslation } from 'react-i18next'

export interface AttachmentGridProps {
  /** Attachments to render */
  attachments: StoredAttachment[]
  /** Async fallback: load image data URL via IPC when thumbnailBase64/resizedBase64 absent */
  loadImageFallback?: (storedPath: string) => Promise<string | null>
  /** Callback when a file path is clicked (used by lightbox "Open in app") */
  onFileClick?: (path: string) => void
  /** Dim the attachment row (used for pending/queued states) */
  dimmed?: boolean
  /** Maximum width container class */
  containerClassName?: string
}

export function AttachmentGrid({
  attachments,
  loadImageFallback,
  onFileClick,
  dimmed = false,
  containerClassName = 'max-w-[80%]',
}: AttachmentGridProps) {
  const { t } = useTranslation()

  const images = attachments.filter((a) => a.type === 'image') as StoredAttachment[]
  const imageCount = images.length
  const isSingleImage = imageCount === 1

  // Track zoomed image by its index in the `images` array (not the full attachments),
  // so prev/next navigation is a simple index increment/decrement.
  const [zoomedIndex, setZoomedIndex] = useState<number | null>(null)
  const zoomedImage = zoomedIndex !== null ? images[zoomedIndex] ?? null : null

  // Fallback image data URLs loaded via loadImageFallback callback.
  // undefined → not yet requested, string → loaded, null → failed.
  const [loadedFallbacks, setLoadedFallbacks] = useState<Record<string, string | null>>({})
  const loadImageFallbackRef = useRef(loadImageFallback)
  loadImageFallbackRef.current = loadImageFallback

  // Load fallback data for images without base64 data
  useEffect(() => {
    const fb = loadImageFallbackRef.current
    if (!fb || attachments.length === 0) return
    let cancelled = false
    const pending: Promise<void>[] = []

    // Prune loadedFallbacks to entries still in the current attachments
    const keepSet = new Set(attachments.map((a) => a.storedPath).filter(Boolean) as string[])
    setLoadedFallbacks((prev) => {
      let changed = false
      const filtered: Record<string, string | null> = {}
      for (const [key, value] of Object.entries(prev)) {
        if (keepSet.has(key)) {
          filtered[key] = value
        } else {
          changed = true
        }
      }
      return changed ? filtered : prev
    })

    for (const att of attachments) {
      if (att.type !== 'image') continue
      if (att.resizedBase64 || att.thumbnailBase64) continue
      if (!att.storedPath) continue
      if (att.storedPath in loadedFallbacks) continue

      const p = fb(att.storedPath)
        .then((url) => {
          if (cancelled) return
          setLoadedFallbacks((prev) => ({ ...prev, [att.storedPath]: url }))
        })
        .catch(() => {
          if (cancelled) return
          setLoadedFallbacks((prev) => ({ ...prev, [att.storedPath]: null }))
        })
      pending.push(p)
    }

    return () => { cancelled = true }
  }, [attachments])

  // Close the lightbox on Escape, navigate on Left/Right
  useEffect(() => {
    if (zoomedIndex === null) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setZoomedIndex(null)
      } else if (e.key === 'ArrowLeft' && zoomedIndex > 0) {
        setZoomedIndex(zoomedIndex - 1)
      } else if (e.key === 'ArrowRight' && zoomedIndex < imageCount - 1) {
        setZoomedIndex(zoomedIndex + 1)
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [zoomedIndex, imageCount])

  return (
    <>
      <div
        className={cn(
          'flex gap-2 flex-wrap',
          containerClassName,
          dimmed && 'opacity-60 saturate-[.75]',
        )}
      >
        {attachments.map((att, i) => {
          const isImage = att.type === 'image'

          // Document attachments — compact pill layout
          if (!isImage) {
            const hasThumbnail = !!att.thumbnailBase64
            return (
              <div
                key={att.id || i}
                className="shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
                onClick={() => att.storedPath && onFileClick?.(att.storedPath)}
                title={t('chat.clickToOpen', { name: att.name })}
              >
                <div className="flex items-center gap-2.5 rounded-[8px] bg-user-message-bubble pl-1.5 pr-3 py-1.5">
                  <div className="h-11 w-8 rounded-[6px] overflow-hidden bg-background shadow-minimal flex items-center justify-center shrink-0">
                    {hasThumbnail ? (
                      <img
                        src={`data:image/png;base64,${att.thumbnailBase64}`}
                        alt={att.name}
                        className="h-full w-full object-cover object-top"
                      />
                    ) : (
                      <FileTypeIcon type={att.type} mimeType={att.mimeType} className="h-5 w-5" />
                    )}
                  </div>
                  <div className="flex flex-col min-w-0 max-w-[120px]">
                    <span className="text-xs font-medium line-clamp-2 break-all" title={att.name}>
                      {att.name}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {getFileTypeLabel(att.type, att.mimeType, att.name)}
                    </span>
                  </div>
                </div>
              </div>
            )
          }

          // Image attachment — inline preview with click-to-zoom
          // and async fallback loading when no base64 data is embedded.
          const b64Source = att.resizedBase64 ?? att.thumbnailBase64
          const fallbackUrl = loadedFallbacks[att.storedPath]
          const fallbackLoading = isImage && !b64Source && !!att.storedPath &&
            !!loadImageFallback && !(att.storedPath in loadedFallbacks)
          const mimeForDataUrl = att.mimeType || 'image/png'
          const dataUrl = b64Source
            ? `data:${mimeForDataUrl};base64,${b64Source}`
            : fallbackUrl || null
          const isPreviewable = !!dataUrl

          return (
            <div
              key={att.id || i}
              className={cn(
                'shrink-0 overflow-hidden bg-background shadow-minimal',
                isPreviewable && 'cursor-pointer hover:opacity-90 active:opacity-80 transition-opacity',
                isSingleImage
                  ? 'h-auto max-h-[240px] max-w-[240px] rounded-[12px]'
                  : 'h-24 w-24 rounded-[8px]',
              )}
              title={att.name}
              {...(isPreviewable
                ? {
                    role: 'button',
                    tabIndex: 0,
                    onClick: () => setZoomedIndex(images.indexOf(att)),
                    onKeyDown: (e: React.KeyboardEvent) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setZoomedIndex(images.indexOf(att))
                      }
                    },
                  }
                : {})}
            >
              {dataUrl ? (
                <img
                  src={dataUrl}
                  alt={att.name}
                  className={cn(
                    'h-full w-full',
                    isSingleImage ? 'object-contain' : 'object-cover',
                  )}
                  loading="lazy"
                />
              ) : fallbackLoading ? (
                <div className="h-full w-full flex items-center justify-center animate-spin text-foreground/40">
                  <Loader2 className="h-5 w-5" />
                </div>
              ) : (
                <div className="h-full w-full flex items-center justify-center">
                  <FileTypeIcon type={att.type} mimeType={att.mimeType} className="h-8 w-8" />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Image lightbox — portal to document.body */}
      {zoomedIndex !== null && zoomedImage && typeof document !== 'undefined' &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={zoomedImage.name}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-scrim/70 backdrop-blur-sm p-8"
            onClick={() => setZoomedIndex(null)}
          >
            {/* Prev chevron — visible only when there's a previous image */}
            {zoomedIndex > 0 && (
              <button
                type="button"
                aria-label={t('chat.prevImage', 'Previous image')}
                className="absolute left-4 top-1/2 -translate-y-1/2 h-10 w-10 flex items-center justify-center rounded-full bg-black/30 hover:bg-black/50 text-white backdrop-blur-sm transition-colors z-10"
                onClick={(e) => {
                  e.stopPropagation()
                  setZoomedIndex(zoomedIndex - 1)
                }}
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
            )}

            {/* Next chevron — visible only when there's a next image */}
            {zoomedIndex < imageCount - 1 && (
              <button
                type="button"
                aria-label={t('chat.nextImage', 'Next image')}
                className="absolute right-4 top-1/2 -translate-y-1/2 h-10 w-10 flex items-center justify-center rounded-full bg-black/30 hover:bg-black/50 text-white backdrop-blur-sm transition-colors z-10"
                onClick={(e) => {
                  e.stopPropagation()
                  setZoomedIndex(zoomedIndex + 1)
                }}
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            )}

            {/* Position indicator (e.g. "2 / 5") — visible only for 2+ images */}
            {imageCount > 1 && (
              <div className="absolute top-6 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/30 backdrop-blur-sm text-white text-xs font-medium z-10 select-none">
                {zoomedIndex + 1} / {imageCount}
              </div>
            )}

            {(() => {
              const lightboxSrc = zoomedImage.resizedBase64 ?? zoomedImage.thumbnailBase64
              const lightboxDataUrl = lightboxSrc
                ? `data:${zoomedImage.mimeType || 'image/png'};base64,${lightboxSrc}`
                : null
              return lightboxDataUrl ? (
                <img
                  src={lightboxDataUrl}
                  alt={zoomedImage.name}
                  className="max-w-full max-h-full object-contain shadow-2xl rounded-md select-none"
                  onClick={(e) => e.stopPropagation()}
                  draggable={false}
                />
              ) : (
                <div className="text-white/70 text-sm">No preview available</div>
              )
            })()}
            <div className="absolute top-6 right-6 flex gap-3">
              {zoomedImage.storedPath && (
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-[6px] bg-white/10 hover:bg-white/20 text-white text-sm font-medium backdrop-blur-md transition-colors"
                  onClick={(e) => {
                    e.stopPropagation()
                    onFileClick?.(zoomedImage.storedPath!)
                  }}
                >
                  {t('chat.openInApp', 'Open in app')}
                </button>
              )}
              <button
                type="button"
                aria-label={t('chat.closeLightbox', 'Close')}
                className="h-8 w-8 flex items-center justify-center rounded-[6px] bg-white/10 hover:bg-white/20 text-white backdrop-blur-md transition-colors"
                onClick={() => setZoomedIndex(null)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
