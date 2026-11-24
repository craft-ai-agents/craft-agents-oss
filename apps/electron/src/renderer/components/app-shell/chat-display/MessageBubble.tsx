import * as React from "react"
import { useTranslation } from "react-i18next"
import { CheckCircle2, CircleAlert, ExternalLink, Info, TriangleAlert } from "lucide-react"
import { Spinner, UserMessageBubble, type FileOpenHandler } from "@craft-agent/ui"
import { cn } from "@/lib/utils"
import { IconButton } from "@/components/ui/button"
import { Markdown, CollapsibleMarkdownProvider, StreamingMarkdown, type RenderMode } from "@/components/markdown"
import type { Message } from "../../../../shared/types"
import { ErrorMessage } from "./ErrorMessage"

/**
 * MessageBubble - Renders a single message based on its role
 *
 * Message Roles & Styles:
 * - user:      Right-aligned bubble (UserMessageBubble)
 * - assistant: Plain copy on the transcript, markdown rendered with clickable links
 * - error:     Inline error marker (destructive tint + 2px rule) with collapsible details
 * - status:    Live-line style row with the working spinner
 * - info:      One-line notice; compaction renders as a labelled divider
 * - warning:   Inline marker on the info tint
 *
 * Note: Tool messages are rendered by TurnCard, not MessageBubble
 */
export interface MessageBubbleProps {
  message: Message
  onOpenFile: FileOpenHandler
  onOpenUrl: (url: string) => void
  sessionId?: string
  /**
   * Markdown render mode for assistant messages
   * @default 'minimal'
   */
  renderMode?: RenderMode
  /**
   * Callback to pop out message into a separate window
   */
  onPopOut?: (message: Message) => void
  /** Compact mode - reduces padding for popover embedding */
  compactMode?: boolean
  /** Callback to resend the user message that preceded an error */
  onRetry?: () => void
}

/** Info-level notices: icon shape + role color per level (status never by color alone). */
const INFO_LEVELS = {
  info: { icon: Info, className: 'text-secondary', iconClassName: 'text-tertiary' },
  warning: { icon: TriangleAlert, className: 'text-info', iconClassName: 'text-info' },
  error: { icon: CircleAlert, className: 'text-destructive', iconClassName: 'text-destructive' },
  success: { icon: CheckCircle2, className: 'text-success', iconClassName: 'text-success' },
} as const

export function MessageBubble({
  message,
  onOpenFile,
  onOpenUrl,
  sessionId,
  renderMode = 'minimal',
  onPopOut,
  compactMode,
  onRetry,
}: MessageBubbleProps) {
  const { t } = useTranslation()

  // === USER MESSAGE: Right-aligned bubble with attachments above ===
  if (message.role === 'user') {
    return (
      <UserMessageBubble
        content={message.content}
        attachments={message.attachments}
        badges={message.badges}
        isPending={message.isPending}
        isQueued={message.isQueued}
        onUrlClick={onOpenUrl}
        onFileClick={onOpenFile}
        compactMode={compactMode}
      />
    )
  }

  // === ASSISTANT MESSAGE: plain copy with markdown rendering ===
  if (message.role === 'assistant') {
    return (
      <div className="group relative min-w-0 select-text break-words text-copy text-foreground">
        {/* Pop-out button - visible on hover */}
        {onPopOut && !message.isStreaming && (
          <IconButton
            aria-label={t("sidebarMenu.openInNewWindow")}
            tooltip
            size="sm"
            icon={<ExternalLink />}
            onClick={() => onPopOut(message)}
            data-touch-reveal="true"
            className="absolute right-0 top-0 opacity-0 transition-opacity duration-micro ease-out-subtle group-hover:opacity-100 group-hover:duration-instant focus-visible:opacity-100"
          />
        )}
        {/* Use StreamingMarkdown for block-level memoization during streaming */}
        {message.isStreaming ? (
          <StreamingMarkdown
            content={message.content}
            isStreaming={true}
            mode={renderMode}
            onUrlClick={onOpenUrl}
            onFileClick={onOpenFile}
          />
        ) : (
          <CollapsibleMarkdownProvider>
            <Markdown
              mode={renderMode}
              onUrlClick={onOpenUrl}
              onFileClick={onOpenFile}
              id={message.id}
              collapsible
            >
              {message.content}
            </Markdown>
          </CollapsibleMarkdownProvider>
        )}
      </div>
    )
  }

  // === ERROR MESSAGE: inline error marker with collapsible technical details ===
  if (message.role === 'error') {
    return <ErrorMessage message={message} onOpenUrl={onOpenUrl} sessionId={sessionId} onRetry={onRetry} />
  }

  // === STATUS MESSAGE: matches the live line (ProcessingIndicator) ===
  if (message.role === 'status') {
    return (
      <div className="flex min-h-7 min-w-0 items-center gap-2 text-label text-secondary">
        <span className="flex size-4 shrink-0 items-center justify-center">
          <Spinner className="text-caption text-accent" />
        </span>
        <span className="min-w-0 truncate">{message.content}</span>
      </div>
    )
  }

  // === INFO MESSAGE: Icon and color based on level ===
  if (message.role === 'info') {
    // Compaction complete message - render as horizontal rule with centered label
    // This persists after reload to show where context was compacted
    if (message.statusType === 'compaction_complete') {
      return (
        <div className="my-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-separator" />
          <span className="select-none text-label-sm text-tertiary">
            {t('chat.conversationCompacted')}
          </span>
          <div className="h-px flex-1 bg-separator" />
        </div>
      )
    }

    const config = INFO_LEVELS[message.infoLevel || 'info']
    const Icon = config.icon

    return (
      <div className={cn('flex min-h-7 min-w-0 select-none items-center gap-2 text-label', config.className)}>
        <span className="flex size-4 shrink-0 items-center justify-center">
          <Icon aria-hidden className={cn('size-3.5', config.iconClassName)} />
        </span>
        <span className="min-w-0">{message.content}</span>
      </div>
    )
  }

  // === WARNING MESSAGE: inline marker on the info tint ===
  if (message.role === 'warning') {
    return (
      <div className="flex min-w-0 select-none gap-2.5 rounded-md border-l-2 border-info bg-info-tint px-3 py-2.5">
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-info" />
        <div className="min-w-0 flex-1 break-words">
          <div className="text-label font-semibold text-info">{t('chat.warning')}</div>
          <p className="mt-0.5 text-label leading-5 text-foreground">{message.content}</p>
        </div>
      </div>
    )
  }

  return null
}

/**
 * MemoizedMessageBubble - Prevents re-renders of non-streaming messages
 *
 * During streaming, the entire message list gets updated on each delta.
 * This wrapper skips re-renders for messages that haven't changed,
 * significantly improving performance for long conversations.
 */
export const MemoizedMessageBubble = React.memo(MessageBubble, (prev, next) => {
  // Always re-render streaming messages (content is changing)
  if (prev.message.isStreaming || next.message.isStreaming) {
    return false
  }
  // Skip re-render if key props unchanged
  return (
    prev.message.id === next.message.id &&
    prev.message.content === next.message.content &&
    prev.message.role === next.message.role &&
    prev.sessionId === next.sessionId &&
    prev.compactMode === next.compactMode
  )
})
