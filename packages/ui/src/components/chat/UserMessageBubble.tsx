/**
 * UserMessageBubble - Shared user message component
 *
 * Displays user messages with right-aligned styling:
 * - Subtle background (5% foreground)
 * - Pill-shaped corners
 * - Max width 80%
 * - Markdown rendering for links and code
 * - Optional file attachments with thumbnails
 * - Content badges for @mentions (sources, skills)
 * - Pending/queued states (Electron only)
 */

import type { ReactNode } from 'react'
import type { StoredAttachment, ContentBadge } from '@craft-agent/core'
import { FileText, File, Folder, Copy, Check } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Markdown } from '../markdown'
import { FileTypeIcon, getFileTypeLabel } from './attachment-helpers'
import { Tooltip, TooltipContent, TooltipTrigger } from '../tooltip'

// Fallback text icons for badges without iconDataUrl
// Using simple characters since SVG rendering may not work in all contexts
const SKILL_ICON_TEXT = '✦'
const SOURCE_ICON_TEXT = '⊕'
const CONTEXT_ICON_TEXT = '⚙'
const COMMAND_ICON_TEXT = '/'

/**
 * Check if a badge is an edit_request badge (identified by XML tag in rawText)
 */
function isEditRequestBadge(badge: ContentBadge): boolean {
  return badge.type === 'context' && !!badge.rawText?.includes('<edit_request>')
}

/**
 * EditRequestBadge - Standalone badge rendered above the user message bubble
 * Taller and with larger corner radius than inline badges for visual distinction
 */
function EditRequestBadge({ badge }: { badge: ContentBadge }) {
  const displayLabel = badge.collapsedLabel || badge.label
  return (
    <span className="inline-flex items-center h-[28px] px-2.5 rounded-[8px] bg-background shadow-minimal text-[13px] text-muted-foreground">
      {displayLabel}
    </span>
  )
}

/**
 * UltrathinkBadge - Indicates the message was sent with ultrathink enabled
 * Styled with gradient to match the input area ultrathink badge
 */
function UltrathinkBadge() {
  return (
    <span
      className="inline-flex items-center h-[28px] px-2.5 rounded-[8px] shadow-tinted bg-gradient-to-r from-blue-600/10 via-purple-600/10 to-pink-600/10 text-xs font-medium"
      style={{ '--shadow-color': '147, 51, 234' } as React.CSSProperties}
    >
      <span className="bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
        Ultrathink
      </span>
    </span>
  )
}

/**
 * Get the appropriate icon text based on badge type
 * Note: file and folder types use lucide icons instead (see BadgeIcon)
 */
function getBadgeIconText(type: string): string {
  switch (type) {
    case 'skill': return SKILL_ICON_TEXT
    case 'source': return SOURCE_ICON_TEXT
    case 'context': return CONTEXT_ICON_TEXT
    default: return SOURCE_ICON_TEXT
  }
}

/**
 * Render the appropriate icon for a badge based on its type
 */
function BadgeIcon({ type, iconDataUrl }: { type: string; iconDataUrl?: string }) {
  // Use custom icon if provided
  if (iconDataUrl) {
    return (
      <img
        src={iconDataUrl}
        alt=""
        className="h-[12px] w-[12px] rounded-[2px] shrink-0"
      />
    )
  }

  // File and folder use lucide icons (matching input field style)
  if (type === 'file') {
    return <File className="h-[12px] w-[12px] shrink-0 text-foreground/50" strokeWidth={1.75} />
  }
  if (type === 'folder') {
    return <Folder className="h-[12px] w-[12px] shrink-0 text-foreground/50" strokeWidth={1.75} />
  }

  // Other types use text fallback
  return (
    <span className="h-[12px] w-[12px] rounded-[2px] bg-foreground/5 flex items-center justify-center text-foreground/50 shrink-0 text-[8px]">
      {getBadgeIconText(type)}
    </span>
  )
}

/**
 * InlineBadge - Renders a single content badge inline with text
 * Styled to match the input field badges (bg-background with shadow)
 */
function InlineBadge({ badge }: { badge: ContentBadge }) {
  // For file/folder badges, show the path as tooltip and enable pointer cursor
  const isFileBadge = badge.type === 'file' || badge.type === 'folder'

  const badgeContent = (
    <span
      className={cn(
        "mention-badge inline-flex items-center gap-1 h-[22px] px-1.5 mx-0.5 rounded-[5px] bg-background shadow-minimal text-[12px] align-middle transition-colors",
        "hover:bg-foreground/5",
        isFileBadge && "cursor-pointer"
      )}
      style={{ verticalAlign: 'middle', transform: 'translateY(-1px)' }}
    >
      <BadgeIcon type={badge.type} iconDataUrl={badge.iconDataUrl} />
      <span className="truncate max-w-[200px]">{badge.label}</span>
    </span>
  )

  // Wrap file/folder badges with Tooltip
  if (isFileBadge && badge.filePath) {
    return (
      <Tooltip delayDuration={400}>
        <TooltipTrigger asChild>
          {badgeContent}
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>
          {badge.filePath}
        </TooltipContent>
      </Tooltip>
    )
  }

  return badgeContent
}

/**
 * CommandBadge - Renders a slash command badge inline with text
 * Styled similarly to InlineBadge but indicates a SDK command (e.g., /compact)
 */
function CommandBadge({ badge }: { badge: ContentBadge }) {
  return (
    <span
      className="inline-flex items-center gap-1 h-[22px] px-1.5 mx-0.5 rounded-[5px] bg-background shadow-minimal text-[12px] align-middle"
      style={{ verticalAlign: 'middle', transform: 'translateY(-1px)' }}
    >
      <span className="h-[12px] w-[12px] rounded-[2px] bg-foreground/5 flex items-center justify-center text-foreground/50 shrink-0 text-[10px] font-medium">
        {COMMAND_ICON_TEXT}
      </span>
      <span className="truncate max-w-[200px]">{badge.label}</span>
    </span>
  )
}

/**
 * ContextBadge - Renders a context badge that collapses hidden content
 * Shows collapsed label and hides the raw content from display
 * Note: edit_request badges are handled separately by EditRequestBadge
 */
function ContextBadge({ badge }: { badge: ContentBadge }) {
  const displayLabel = badge.collapsedLabel || badge.label

  return (
    <span
      className="inline-flex items-center gap-1 h-[22px] px-1.5 mr-1 rounded-[5px] bg-background shadow-minimal text-[12px] align-middle"
      style={{ verticalAlign: 'middle', transform: 'translateY(-1px)' }}
      title="Context badge"
    >
      <span className="h-[12px] w-[12px] rounded-[2px] bg-foreground/5 flex items-center justify-center text-foreground/50 shrink-0 text-[8px]">
        {CONTEXT_ICON_TEXT}
      </span>
      <span className="truncate max-w-[200px] text-muted-foreground">{displayLabel}</span>
    </span>
  )
}

/**
 * InlineFileBadge - Smaller file badge for inline display within text
 * Styled to match other inline badges (22px height) but clickable
 * Used for plan execution messages where the file path appears inline
 */
function InlineFileBadge({
  badge,
  onFileClick
}: {
  badge: ContentBadge
  onFileClick?: (path: string) => void
}) {
  return (
    <button
      onClick={() => badge.filePath && onFileClick?.(badge.filePath)}
      className="inline-flex items-center gap-1 h-[22px] px-1.5 mx-0.5 rounded-[5px] bg-background shadow-minimal text-[12px] align-middle hover:bg-foreground/5 transition-colors cursor-pointer"
      style={{ verticalAlign: 'middle', transform: 'translateY(-1px)' }}
      title={badge.filePath}
    >
      <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className="truncate max-w-[200px]">{badge.label}</span>
    </button>
  )
}

/**
 * Render content with badges inserted at their positions.
 * Text segments between badges are rendered as Markdown.
 *
 * Context badges (type='context') are special:
 * - They completely hide the marked content range
 * - They show a collapsed badge with the collapsedLabel
 * - Used for EditPopover metadata that shouldn't be visible to users
 *
 * File badges (type='file') render inline as clickable badges:
 * - Used for plan execution messages where file path appears inline with text
 */
function renderContentWithBadges(
  content: string,
  badges: ContentBadge[],
  onUrlClick?: (url: string) => void,
  onFileClick?: (path: string) => void
): ReactNode {
  if (badges.length === 0) {
    return (
      <Markdown
        mode="minimal"
        onUrlClick={onUrlClick}
        onFileClick={onFileClick}
        className="text-sm [&_a]:underline [&_code]:bg-foreground/10"
      >
        {content}
      </Markdown>
    )
  }

  // Sort badges by start position
  const sortedBadges = [...badges].sort((a, b) => a.start - b.start)

  const elements: ReactNode[] = []
  let lastEnd = 0

  sortedBadges.forEach((badge, i) => {
    // Add text before this badge
    if (badge.start > lastEnd) {
      const textBefore = content.slice(lastEnd, badge.start)
      if (textBefore.trim()) {
        elements.push(
          <span key={`text-${i}`} className="whitespace-pre-wrap">
            {textBefore}
          </span>
        )
      }
    }

    // Context badges hide content and show collapsed label
    // Command badges show SDK commands like /compact
    // File badges show clickable file references inline
    // Source/skill badges show inline with the original text
    // Note: edit_request badges are filtered out and rendered above the bubble separately
    if (badge.type === 'context') {
      elements.push(<ContextBadge key={`badge-${i}`} badge={badge} />)
    } else if (badge.type === 'command') {
      elements.push(<CommandBadge key={`badge-${i}`} badge={badge} />)
    } else {
      // file, folder, source, skill 都使用 InlineBadge（支持 Tooltip）
      elements.push(<InlineBadge key={`badge-${i}`} badge={badge} />)
    }

    lastEnd = badge.end
  })

  // Add remaining text after last badge
  if (lastEnd < content.length) {
    const textAfter = content.slice(lastEnd)
    if (textAfter.trim()) {
      elements.push(
        <span key="text-end" className="whitespace-pre-wrap">
          {textAfter}
        </span>
      )
    }
  }

  // Use <p> to match Markdown's block-level line-height behavior
  return <p className="text-sm">{elements}</p>
}

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
  /** Content badges for inline display (sources, skills) */
  badges?: ContentBadge[]
  /** Whether the message is pending (shimmer animation) */
  isPending?: boolean
  /** Whether the message is queued (badge shown) */
  isQueued?: boolean
  /** Whether the message was sent with ultrathink enabled */
  ultrathink?: boolean
}

export function UserMessageBubble({
  content,
  className,
  onUrlClick,
  onFileClick,
  attachments,
  badges,
  isPending,
  isQueued,
  ultrathink,
}: UserMessageBubbleProps) {
  const hasAttachments = attachments && attachments.length > 0

  // Separate edit_request badges (rendered above bubble) from other badges (rendered inline)
  const editRequestBadges = badges?.filter(isEditRequestBadge) ?? []
  const inlineBadges = badges?.filter(b => !isEditRequestBadge(b)) ?? []
  const hasEditRequestBadges = editRequestBadges.length > 0
  const hasInlineBadges = inlineBadges.length > 0

  // Strip edit_request content from the displayed text
  // Each badge has start/end positions marking where to remove content
  let displayContent = content
  if (hasEditRequestBadges) {
    // Sort badges by start position descending so we can remove from end to start
    // (this preserves positions for earlier removals)
    const sortedBadges = [...editRequestBadges].sort((a, b) => b.start - a.start)
    for (const badge of sortedBadges) {
      displayContent = displayContent.slice(0, badge.start) + displayContent.slice(badge.end)
    }
    displayContent = displayContent.trim()
  }

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

      {/* Badges row - ultrathink and edit request badges above text bubble */}
      {(ultrathink || hasEditRequestBadges) && (
        <div className="flex gap-2 justify-end max-w-[80%] flex-wrap">
          {ultrathink && <UltrathinkBadge />}
          {editRequestBadges.map((badge, i) => (
            <EditRequestBadge key={`edit-badge-${i}`} badge={badge} />
          ))}
        </div>
      )}

      {/* Text content bubble */}
      <div
        className={cn(
          "max-w-[80%] bg-foreground/5 rounded-[16px] px-5 py-3.5 break-words min-w-0 select-text [&_p]:m-0",
          isPending && "animate-shimmer"
        )}
      >
        {hasInlineBadges
          ? renderContentWithBadges(displayContent, inlineBadges, onUrlClick, onFileClick)
          : (
            <Markdown
              mode="minimal"
              onUrlClick={onUrlClick}
              onFileClick={onFileClick}
              className="text-sm [&_a]:underline [&_code]:bg-foreground/10"
            >
              {displayContent}
            </Markdown>
          )
        }
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
