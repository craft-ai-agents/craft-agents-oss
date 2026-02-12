import * as React from 'react'
import { FileText, FileImage, FileVideo, FileAudio, FileArchive, File, ExternalLink } from 'lucide-react'
import { cn } from '../../lib/utils'
import { usePlatform } from '../../context/PlatformContext'

// ============================================================================
// MarkdownFileCard — renders file_download metadata as a visual card.
//
// When API tools download binary files (PDFs, images, archives, etc.), the
// result is a JSON object like:
//   { type: "file_download", path: "/...", filename: "report.pdf", mimeType: "application/pdf", size: 12345, sizeHuman: "12.3 KB" }
//
// Instead of showing raw JSON, this component renders a card with:
// - File type icon (based on mimeType)
// - Filename and size
// - Click-to-open action via PlatformContext
// ============================================================================

export interface FileDownloadMeta {
  type: 'file_download'
  path: string
  filename: string
  mimeType: string | null
  size: number
  sizeHuman: string
}

/**
 * Check if a parsed JSON object is a file_download result from api-tools.
 */
export function isFileDownload(value: unknown): value is FileDownloadMeta {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return (
    obj.type === 'file_download' &&
    typeof obj.path === 'string' &&
    typeof obj.filename === 'string' &&
    typeof obj.sizeHuman === 'string'
  )
}

/**
 * Get an icon component based on MIME type.
 */
function getFileIcon(mimeType: string | null): React.ReactNode {
  if (!mimeType) return <File className="w-6 h-6" />

  if (mimeType === 'application/pdf') return <FileText className="w-6 h-6" />
  if (mimeType.startsWith('image/')) return <FileImage className="w-6 h-6" />
  if (mimeType.startsWith('video/')) return <FileVideo className="w-6 h-6" />
  if (mimeType.startsWith('audio/')) return <FileAudio className="w-6 h-6" />
  if (
    mimeType === 'application/zip' ||
    mimeType === 'application/gzip' ||
    mimeType === 'application/x-tar' ||
    mimeType === 'application/x-7z-compressed' ||
    mimeType === 'application/x-rar-compressed'
  ) {
    return <FileArchive className="w-6 h-6" />
  }
  if (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml'
  ) {
    return <FileText className="w-6 h-6" />
  }

  return <File className="w-6 h-6" />
}

/**
 * Get a human-readable label for the file type.
 */
function getFileTypeLabel(mimeType: string | null, filename: string): string {
  if (mimeType === 'application/pdf') return 'PDF Document'
  if (mimeType?.startsWith('image/')) return 'Image'
  if (mimeType?.startsWith('video/')) return 'Video'
  if (mimeType?.startsWith('audio/')) return 'Audio'
  if (mimeType === 'application/zip') return 'ZIP Archive'

  // Derive from extension
  const ext = filename.split('.').pop()?.toLowerCase()
  if (ext === 'docx') return 'Word Document'
  if (ext === 'xlsx') return 'Excel Spreadsheet'
  if (ext === 'pptx') return 'PowerPoint Presentation'
  if (ext === 'csv') return 'CSV File'

  return 'File'
}

interface MarkdownFileCardProps {
  meta: FileDownloadMeta
  className?: string
}

export function MarkdownFileCard({ meta, className }: MarkdownFileCardProps) {
  const platform = usePlatform()

  const handleOpen = React.useCallback(() => {
    platform.onOpenFile?.(meta.path)
  }, [platform, meta.path])

  const handleReveal = React.useCallback(() => {
    platform.onRevealInFinder?.(meta.path)
  }, [platform, meta.path])

  const icon = getFileIcon(meta.mimeType)
  const typeLabel = getFileTypeLabel(meta.mimeType, meta.filename)

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 py-3 rounded-[8px] border',
        'bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer group',
        className
      )}
      onClick={handleOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleOpen() }}
    >
      {/* File icon */}
      <div className="flex-shrink-0 text-muted-foreground">
        {icon}
      </div>

      {/* File info */}
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{meta.filename}</div>
        <div className="text-xs text-muted-foreground">
          {typeLabel} &middot; {meta.sizeHuman}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {platform.onRevealInFinder && (
          <button
            onClick={(e) => { e.stopPropagation(); handleReveal() }}
            className={cn(
              'p-1.5 rounded-[6px] transition-all select-none',
              'text-muted-foreground/50 hover:text-foreground hover:bg-muted',
              'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring'
            )}
            title="Show in Finder"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
