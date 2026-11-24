import * as React from "react"
import { useTranslation } from "react-i18next"
import { X, Image as ImageIcon } from "lucide-react"
import { Spinner, FileTypeIcon, getFileTypeLabel } from "@craft-agent/ui"
import { cn } from "@/lib/utils"
import type { FileAttachment } from "../../../shared/types"

// Re-export for backward compatibility
export { FileTypeIcon, getFileTypeLabel }

interface AttachmentPreviewProps {
  attachments: FileAttachment[]
  onRemove: (index: number) => void
  disabled?: boolean
  loadingCount?: number
}

/**
 * AttachmentPreview - ChatGPT-style attachment preview strip
 *
 * Shows attached files as small tiles above the text (inside the composer card):
 * - Image thumbnails for image files (64x64px)
 * - Icon + filename for text/PDF/code files
 * - X button on hover to remove
 * - Horizontally scrollable when many files
 * - Loading placeholders while files are being read
 */
export function AttachmentPreview({ attachments, onRemove, disabled, loadingCount = 0 }: AttachmentPreviewProps) {
  if (attachments.length === 0 && loadingCount === 0) return null

  return (
    // Tiles start on the draft text's edge (the composer's card pad), like the toolbar's first glyph
    <div className="flex gap-2 overflow-x-auto px-card-pad pt-2.5 pb-0.5">
      {attachments.map((attachment, index) => (
        <AttachmentBubble
          key={`${attachment.path}-${index}`}
          attachment={attachment}
          onRemove={() => onRemove(index)}
          disabled={disabled}
        />
      ))}
      {/* Loading placeholders */}
      {Array.from({ length: loadingCount }).map((_, i) => (
        <LoadingBubble key={`loading-${i}`} />
      ))}
    </div>
  )
}

function LoadingBubble() {
  return (
    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-sunken shadow-elev-0">
      <Spinner className="text-tertiary" />
    </div>
  )
}

interface AttachmentBubbleProps {
  attachment: FileAttachment
  onRemove: () => void
  disabled?: boolean
}

// Image MIME types Chromium can decode in an <img>. HEIC/HEIF/TIFF are absent —
// an inline data URL for those renders as a broken image, so we fall back to the
// PNG thumbnail the main process generates for them instead.
const CHROMIUM_IMAGE_MIME = /^image\/(png|jpeg|gif|webp|svg\+xml|bmp|x-icon|avif)$/i

function AttachmentBubble({ attachment, onRemove, disabled }: AttachmentBubbleProps) {
  const { t } = useTranslation()
  const isImage = attachment.type === 'image'
  const hasThumbnail = !!attachment.thumbnailBase64
  const canInlineImage = !!(isImage && attachment.base64 && CHROMIUM_IMAGE_MIME.test(attachment.mimeType))

  // Inline the full base64 when Chromium can render it; otherwise prefer the PNG
  // thumbnail (e.g. HEIC/HEIF), and fall back to the file-type icon when neither exists.
  const imageSrc = canInlineImage
    ? `data:${attachment.mimeType};base64,${attachment.base64}`
    : hasThumbnail
      ? `data:image/png;base64,${attachment.thumbnailBase64}`
      : null

  return (
    <div className="group relative shrink-0 select-none pt-1.5 pr-1.5">
      {/* Remove button - appears on hover (always visible on touch via data-touch-reveal) */}
      {!disabled && (
        <button
          // Inside the composer <form>: never a submit button
          type="button"
          onClick={onRemove}
          aria-label={`${t('common.remove')}: ${attachment.name}`}
          data-touch-reveal="true"
          className={cn(
            "absolute top-0 right-0 z-10",
            // 20px dot, 24px hit area (36px on touch layouts)
            "h-5 w-5 rounded-full before:absolute before:-inset-0.5 before:content-[''] @max-mobile/shell:before:-inset-2",
            "bg-floating text-secondary shadow-elev-1",
            "flex items-center justify-center",
            "opacity-0 transition-opacity group-hover:opacity-100 group-hover:duration-instant group-focus-within:opacity-100",
            "hover:text-foreground"
          )}
        >
          <X className="h-3 w-3" />
        </button>
      )}

      {isImage ? (
        /* IMAGE: Square thumbnail only */
        <div className="h-16 w-16 overflow-hidden rounded-lg bg-sunken shadow-elev-0">
          {imageSrc ? (
            <img src={imageSrc} alt={attachment.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <ImageIcon className="h-5 w-5 text-tertiary" />
            </div>
          )}
        </div>
      ) : (
        /* DOCUMENT: Tile with thumbnail/icon + 2-line text */
        <div className="flex h-16 items-center gap-2.5 rounded-lg bg-sunken pl-1.5 pr-3 shadow-elev-0">
          {/* A4-like preview */}
          <div className="flex h-12 w-9 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-raised shadow-elev-0">
            {hasThumbnail ? (
              <img
                src={`data:image/png;base64,${attachment.thumbnailBase64}`}
                alt={attachment.name}
                className="h-full w-full object-cover object-top"
              />
            ) : (
              <FileTypeIcon type={attachment.type} mimeType={attachment.mimeType} className="h-5 w-5" />
            )}
          </div>
          {/* One-line filename that keeps its extension ("q3-planning-no….md"; wrapping broke names
              mid-word), then the type */}
          <div className="flex min-w-0 max-w-[132px] flex-col">
            <FileName name={attachment.name} />
            <span className="text-caption font-normal text-tertiary">
              {getFileTypeLabel(attachment.type, attachment.mimeType, attachment.name)}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

/** A filename on one line: the stem truncates, the extension stays visible. */
function FileName({ name }: { name: string }) {
  const dot = name.lastIndexOf('.')
  const hasExtension = dot > 0 && name.length - dot <= 8
  const stem = hasExtension ? name.slice(0, dot) : name
  const extension = hasExtension ? name.slice(dot) : ''
  return (
    <span className="flex min-w-0 text-label-sm font-medium text-foreground" title={name}>
      <span className="truncate">{stem}</span>
      {extension && <span className="shrink-0">{extension}</span>}
    </span>
  )
}
