import * as React from "react"
import { X, File, Image as ImageIcon } from "lucide-react"
import { Spinner } from "@/components/ui/loading-indicator"
import { cn } from "@/lib/utils"
import type { FileAttachment } from "../../../shared/types"

interface AttachmentPreviewProps {
  attachments: FileAttachment[]
  onRemove: (index: number) => void
  disabled?: boolean
  loadingCount?: number
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
export function AttachmentPreview({ attachments, onRemove, disabled, loadingCount = 0 }: AttachmentPreviewProps) {
  if (attachments.length === 0 && loadingCount === 0) return null

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
  attachment: FileAttachment
  onRemove: () => void
  disabled?: boolean
}

function AttachmentBubble({ attachment, onRemove, disabled }: AttachmentBubbleProps) {
  const isImage = attachment.type === 'image'
  const hasThumbnail = !!attachment.thumbnailBase64
  const hasImageBase64 = isImage && attachment.base64

  // For images, use full base64; for docs, use Quick Look thumbnail
  const imageSrc = hasImageBase64
    ? `data:${attachment.mimeType};base64,${attachment.base64}`
    : hasThumbnail
      ? `data:image/png;base64,${attachment.thumbnailBase64}`
      : null

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
              {getFileTypeLabel(attachment.type, attachment.mimeType, attachment.name)}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// Comprehensive MIME type to human-friendly label mapping
const MIME_TYPE_LABELS: Record<string, string> = {
  // Documents
  'application/pdf': 'PDF',
  'application/msword': 'Word',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'application/vnd.ms-excel': 'Excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
  'application/vnd.ms-powerpoint': 'PowerPoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint',
  'application/rtf': 'RTF',

  // Text & Markup
  'text/plain': 'Text',
  'text/markdown': 'Markdown',
  'text/html': 'HTML',
  'text/css': 'CSS',
  'text/csv': 'CSV',
  'text/xml': 'XML',
  'application/xml': 'XML',
  'application/json': 'JSON',
  'application/x-yaml': 'YAML',
  'text/yaml': 'YAML',

  // Code
  'text/javascript': 'JavaScript',
  'application/javascript': 'JavaScript',
  'text/typescript': 'TypeScript',
  'application/typescript': 'TypeScript',
  'text/x-python': 'Python',
  'text/x-java': 'Java',
  'text/x-c': 'C',
  'text/x-c++': 'C++',
  'text/x-csharp': 'C#',
  'text/x-go': 'Go',
  'text/x-rust': 'Rust',
  'text/x-swift': 'Swift',
  'text/x-kotlin': 'Kotlin',
  'text/x-ruby': 'Ruby',
  'text/x-php': 'PHP',
  'application/x-sh': 'Shell',
  'text/x-shellscript': 'Shell',

  // Images
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/gif': 'GIF',
  'image/webp': 'WebP',
  'image/svg+xml': 'SVG',
  'image/bmp': 'BMP',
  'image/tiff': 'TIFF',
  'image/heic': 'HEIC',
  'image/heif': 'HEIF',

  // Archives
  'application/zip': 'ZIP',
  'application/x-rar-compressed': 'RAR',
  'application/x-7z-compressed': '7-Zip',
  'application/gzip': 'GZIP',
  'application/x-tar': 'TAR',

  // Media
  'audio/mpeg': 'MP3',
  'audio/wav': 'WAV',
  'video/mp4': 'MP4',
  'video/quicktime': 'MOV',
}

// Extension fallback for when MIME type is generic (e.g., application/octet-stream)
const EXTENSION_LABELS: Record<string, string> = {
  // Code
  'js': 'JavaScript',
  'ts': 'TypeScript',
  'tsx': 'React TSX',
  'jsx': 'React JSX',
  'py': 'Python',
  'rb': 'Ruby',
  'go': 'Go',
  'rs': 'Rust',
  'swift': 'Swift',
  'kt': 'Kotlin',
  'java': 'Java',
  'c': 'C',
  'cpp': 'C++',
  'h': 'Header',
  'cs': 'C#',
  'php': 'PHP',
  'sh': 'Shell',
  'bash': 'Bash',
  'zsh': 'Zsh',

  // Config
  'json': 'JSON',
  'yaml': 'YAML',
  'yml': 'YAML',
  'toml': 'TOML',
  'xml': 'XML',
  'ini': 'Config',
  'env': 'Env',

  // Docs
  'md': 'Markdown',
  'txt': 'Text',
  'rtf': 'RTF',
  'pdf': 'PDF',
  'doc': 'Word',
  'docx': 'Word',
  'xls': 'Excel',
  'xlsx': 'Excel',
  'ppt': 'PowerPoint',
  'pptx': 'PowerPoint',
  'csv': 'CSV',
}

export function getFileTypeLabel(type: FileAttachment['type'], mimeType: string, fileName?: string): string {
  // 1. Check exact MIME type match
  if (MIME_TYPE_LABELS[mimeType]) {
    return MIME_TYPE_LABELS[mimeType]
  }

  // 2. Try to extract from filename extension
  if (fileName) {
    const ext = fileName.split('.').pop()?.toLowerCase()
    if (ext && EXTENSION_LABELS[ext]) {
      return EXTENSION_LABELS[ext]
    }
  }

  // 3. Fallback based on type category
  switch (type) {
    case 'pdf': return 'PDF'
    case 'office': return 'Document'
    case 'text': return 'Text'
    case 'image': return 'Image'
    default: return 'File'
  }
}

export interface FileTypeIconProps {
  type: 'image' | 'text' | 'pdf' | 'office' | 'unknown'
  mimeType: string
  className?: string
}

/**
 * File icon - ImageIcon for images, generic File icon with color tint for others
 */
export function FileTypeIcon({ type, mimeType, className }: FileTypeIconProps) {
  const baseClass = cn("h-4 w-4", className)

  // Images get dedicated icon
  if (type === 'image') {
    return <ImageIcon className={cn(baseClass, "text-accent")} />
  }

  // Everything else gets generic file icon with color tint
  const colorClass = getFileColor(type, mimeType)
  return <File className={cn(baseClass, colorClass)} />
}

function getFileColor(type: FileTypeIconProps['type'], mimeType: string): string {
  // Code files get success color
  if (isCodeFile(mimeType)) {
    return "text-success"
  }

  switch (type) {
    case 'pdf':
      return "text-destructive"
    case 'office':
      return "text-accent"
    case 'text':
      return "text-muted-foreground"
    default:
      return "text-muted-foreground"
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
