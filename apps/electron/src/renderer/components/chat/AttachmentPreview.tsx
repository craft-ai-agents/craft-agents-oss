import * as React from "react"
import { X, FileText, FileCode, Image as ImageIcon, File } from "lucide-react"
import { cn } from "@/lib/utils"
import type { FileAttachment } from "../../../shared/types"

interface AttachmentPreviewProps {
  attachments: FileAttachment[]
  onRemove: (index: number) => void
  disabled?: boolean
}

/**
 * AttachmentPreview - ChatGPT-style attachment preview strip
 *
 * Shows attached files as small bubbles above the textarea:
 * - Image thumbnails for image files (48x48px)
 * - Icon + filename for text/PDF/code files
 * - X button on hover to remove
 * - Horizontally scrollable when many files
 */
export function AttachmentPreview({ attachments, onRemove, disabled }: AttachmentPreviewProps) {
  if (attachments.length === 0) return null

  return (
    <div className="flex gap-2 px-4 py-3 border-b border-border/50 overflow-x-auto">
      {attachments.map((attachment, index) => (
        <AttachmentBubble
          key={`${attachment.path}-${index}`}
          attachment={attachment}
          onRemove={() => onRemove(index)}
          disabled={disabled}
        />
      ))}
    </div>
  )
}

interface AttachmentBubbleProps {
  attachment: FileAttachment
  onRemove: () => void
  disabled?: boolean
}

function AttachmentBubble({ attachment, onRemove, disabled }: AttachmentBubbleProps) {
  const isImage = attachment.type === 'image' && attachment.base64

  return (
    <div className="relative group shrink-0">
      {/* Remove button - appears on hover */}
      {!disabled && (
        <button
          onClick={onRemove}
          className={cn(
            "absolute -top-1.5 -right-1.5 z-10",
            "h-5 w-5 rounded-full",
            "bg-muted-foreground/90 text-background",
            "flex items-center justify-center",
            "opacity-0 group-hover:opacity-100 transition-opacity",
            "hover:bg-muted-foreground"
          )}
        >
          <X className="h-3 w-3" />
        </button>
      )}

      {isImage ? (
        /* Image Preview: Thumbnail with rounded corners */
        <div className="h-14 w-14 rounded-lg overflow-hidden border bg-muted">
          <img
            src={`data:${attachment.mimeType};base64,${attachment.base64}`}
            alt={attachment.name}
            className="h-full w-full object-cover"
          />
        </div>
      ) : (
        /* File Preview: Icon + filename in a pill */
        <div className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2 max-w-[180px]">
          <FileTypeIcon type={attachment.type} mimeType={attachment.mimeType} />
          <span className="text-xs truncate text-muted-foreground" title={attachment.name}>
            {attachment.name}
          </span>
        </div>
      )}
    </div>
  )
}

export interface FileTypeIconProps {
  type: 'image' | 'text' | 'pdf' | 'office' | 'unknown'
  mimeType: string
  className?: string
}

export function FileTypeIcon({ type, mimeType, className }: FileTypeIconProps) {
  const iconClass = cn("h-4 w-4 text-muted-foreground", className)

  // Code files
  if (isCodeFile(mimeType)) {
    return <FileCode className={iconClass} />
  }

  switch (type) {
    case 'image':
      return <ImageIcon className={iconClass} />
    case 'pdf':
      return <FileText className={cn(iconClass, "text-red-500")} />
    case 'office':
      return <FileText className={cn(iconClass, "text-blue-500")} />
    case 'text':
      return <FileText className={iconClass} />
    default:
      return <File className={iconClass} />
  }
}

function isCodeFile(mimeType: string): boolean {
  const codeTypes = [
    'application/javascript',
    'application/typescript',
    'application/json',
    'text/javascript',
    'text/typescript',
    'text/x-python',
    'text/x-java',
    'text/css',
    'text/html',
    'text/xml',
    'application/xml',
    'text/yaml',
  ]
  return codeTypes.includes(mimeType) || mimeType.startsWith('text/x-')
}
