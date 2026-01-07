/**
 * UserMessageBubble - Shared user message component
 *
 * Displays user messages with right-aligned styling:
 * - Subtle background (5% foreground)
 * - Pill-shaped corners
 * - Max width 80%
 * - Markdown rendering for links and code
 * - Optional file attachments with thumbnails
 * - Pending/queued states (Electron only)
 */

import type { StoredAttachment } from '@craft-agent/core'
import { cn } from '../../lib/utils'
import { Markdown } from '../markdown'
import { FileTypeIcon, getFileTypeLabel } from './attachment-helpers'

export interface UserMessageBubbleProps {
  /** Message content (markdown supported) */
  content: string
  /** Additional className for the outer container */
  className?: string
  /** Callback when a URL is clicked */
  onUrlClick?: (url: string) => void
  /** Callback when a file path is clicked */
  onFileClick?: (path: string) => void
  /** Stored attachments (images, documents) */
  attachments?: StoredAttachment[]
  /** Whether the message is pending (shimmer animation) */
  isPending?: boolean
  /** Whether the message is queued (badge shown) */
  isQueued?: boolean
}

export function UserMessageBubble({
  content,
  className,
  onUrlClick,
  onFileClick,
  attachments,
  isPending,
  isQueued,
}: UserMessageBubbleProps) {
  const hasAttachments = attachments && attachments.length > 0

  return (
    <div className={cn("flex flex-col items-end gap-3 w-full", className)}>
      {/* Attachment preview row - stored attachments with thumbnails */}
      {hasAttachments && (
        <div className="flex gap-2 justify-end max-w-[80%] flex-wrap">
          {attachments!.map((att, i) => {
            const isImage = att.type === 'image'
            const hasThumbnail = !!att.thumbnailBase64

            return (
              <div
                key={att.id || i}
                className="shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
                onClick={() => att.storedPath && onFileClick?.(att.storedPath)}
                title={`Click to open ${att.name}`}
              >
                {isImage ? (
                  /* IMAGE: Square thumbnail only */
                  <div className="h-14 w-14 rounded-[8px] overflow-hidden bg-background shadow-minimal">
                    {hasThumbnail ? (
                      <img
                        src={`data:image/png;base64,${att.thumbnailBase64}`}
                        alt={att.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center">
                        <FileTypeIcon type={att.type} mimeType={att.mimeType} className="h-5 w-5" />
                      </div>
                    )}
                  </div>
                ) : (
                  /* DOCUMENT: Bubble with thumbnail/icon + 2-line text */
                  <div className="flex items-center gap-2.5 rounded-[8px] bg-foreground/5 pl-1.5 pr-3 py-1.5">
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
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Text content bubble */}
      <div
        className={cn(
          "max-w-[80%] bg-foreground/5 rounded-[16px] px-5 py-1.5 break-words min-w-0 select-text",
          isPending && "animate-shimmer"
        )}
      >
        <Markdown
          mode="minimal"
          onUrlClick={onUrlClick}
          onFileClick={onFileClick}
          className="text-sm [&_a]:underline [&_code]:bg-foreground/10"
        >
          {content}
        </Markdown>
      </div>

      {/* Queued badge */}
      {isQueued && (
        <span className="text-[10px] text-muted-foreground bg-foreground/5 px-2 py-0.5 rounded-full">
          queued
        </span>
      )}
    </div>
  )
}
