import * as React from "react"
import { X, Image as ImageIcon, AlertCircle } from "lucide-react"
import { Spinner, FileTypeIcon, getFileTypeLabel } from "@craft-agent/ui"
import { cn } from "@/lib/utils"
import type { FileAttachment } from "../../../shared/types"

// Re-export for backward compatibility
export { FileTypeIcon, getFileTypeLabel }

/**
 * Extended attachment type with upload state for background uploading.
 * Compatible with base FileAttachment (uploadState defaults to 'uploaded').
 */
export type AttachmentWithUploadState = FileAttachment & {
  uploadState?: 'pending' | 'uploading' | 'uploaded' | 'error'
  uploadError?: string
}

interface AttachmentPreviewProps {
  attachments: AttachmentWithUploadState[]
  onRemove: (index: number) => void
  disabled?: boolean
  loadingCount?: number
  /** @deprecated Use per-attachment uploadState instead. Kept for backward compatibility. */
  isUploading?: boolean
}

/**
 * AttachmentPreview - ChatGPT-style attachment preview strip
 *
 * Shows attached files as small bubbles above the textarea:
 * - Image thumbnails for image files (48x48px)
 * - Icon + filename for text/PDF/code files
 * - X button on hover to remove
 * - Horizontally scrollable when many files
 * - Loading placeholders while files are being read
 */
export function AttachmentPreview({ attachments, onRemove, disabled, loadingCount = 0, isUploading = false }: AttachmentPreviewProps) {
  if (attachments.length === 0 && loadingCount === 0) return null

  return (
    <div className="flex gap-2 px-4 py-3 border-b border-border/50 overflow-x-auto">
      {attachments.map((attachment, index) => (
        <AttachmentBubble
          key={`${attachment.path}-${index}`}
          attachment={attachment}
          onRemove={() => onRemove(index)}
          disabled={disabled}
          isUploading={isUploading}
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
    <div className="h-16 w-16 rounded-[8px] bg-background shadow-minimal flex items-center justify-center shrink-0">
      <Spinner className="text-muted-foreground" />
    </div>
  )
}

interface AttachmentBubbleProps {
  attachment: AttachmentWithUploadState
  onRemove: () => void
  disabled?: boolean
  /** @deprecated Use attachment.uploadState instead */
  isUploading?: boolean
}

function AttachmentBubble({ attachment, onRemove, disabled, isUploading: globalIsUploading }: AttachmentBubbleProps) {
  const isImage = attachment.type === 'image'
  const hasThumbnail = !!attachment.thumbnailBase64
  const hasImageBase64 = isImage && attachment.base64

  // Check per-attachment upload state (fall back to global for backward compat)
  const uploadState = attachment.uploadState ?? (globalIsUploading ? 'uploading' : 'uploaded')
  const isAttachmentUploading = uploadState === 'uploading' || uploadState === 'pending'
  const hasUploadError = uploadState === 'error'

  // For images, use full base64; for docs, use Quick Look thumbnail
  const imageSrc = hasImageBase64
    ? `data:${attachment.mimeType};base64,${attachment.base64}`
    : hasThumbnail
      ? `data:image/png;base64,${attachment.thumbnailBase64}`
      : null

  return (
    <div className="relative group shrink-0 select-none">
      {/* Remove button - appears on hover (always visible for errors so user can remove) */}
      {!disabled && (!isAttachmentUploading || hasUploadError) && (
        <button
          onClick={onRemove}
          className={cn(
            "absolute -top-1.5 -right-1.5 z-10",
            "h-5 w-5 rounded-full",
            "bg-muted-foreground/90 text-background",
            "flex items-center justify-center",
            "opacity-0 group-hover:opacity-100 transition-opacity",
            "hover:bg-muted-foreground",
            hasUploadError && "opacity-100" // Always show remove for errors
          )}
        >
          <X className="h-3 w-3" />
        </button>
      )}

      {/* Upload spinner overlay */}
      {isAttachmentUploading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-[8px] bg-background/70">
          <Spinner className="text-muted-foreground" />
        </div>
      )}

      {/* Error overlay */}
      {hasUploadError && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center rounded-[8px] bg-destructive/10 border border-destructive/30"
          title={attachment.uploadError || 'Upload failed'}
        >
          <AlertCircle className="h-5 w-5 text-destructive" />
        </div>
      )}

      {isImage ? (
        /* IMAGE: Square thumbnail only */
        <div className="h-16 w-16 rounded-[8px] overflow-hidden bg-background shadow-minimal">
          {imageSrc ? (
            <img src={imageSrc} alt={attachment.name} className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full flex items-center justify-center">
              <ImageIcon className="h-5 w-5 text-muted-foreground" />
            </div>
          )}
        </div>
      ) : (
        /* DOCUMENT: Bubble with thumbnail/icon + 2-line text */
        <div className="h-16 flex items-center gap-2.5 rounded-[8px] bg-foreground/5 pl-1.5 pr-3">
          {/* A4-like preview */}
          <div className="h-12 w-9 rounded-[6px] overflow-hidden bg-background shadow-minimal flex items-center justify-center shrink-0">
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
          {/* 2-line filename + type */}
          <div className="flex flex-col min-w-0 max-w-[120px]">
            <span className="text-xs font-medium line-clamp-2 break-all" title={attachment.name}>
              {attachment.name}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {hasUploadError ? 'Upload failed' : getFileTypeLabel(attachment.type, attachment.mimeType, attachment.name)}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
