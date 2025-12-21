import * as React from "react"
import { useEffect } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  Info,
} from "lucide-react"
import { motion, AnimatePresence } from "motion/react"

import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { Markdown, CollapsibleMarkdownProvider, StreamingMarkdown, type RenderMode } from "@/components/markdown"
import { AnimatedCollapsibleContent } from "@/components/ui/collapsible"
import { FileTypeIcon, getFileTypeLabel } from "./AttachmentPreview"
import { Spinner } from "@/components/ui/loading-indicator"
import { useFocusZone } from "@/hooks/keyboard"
import type { Session, Message, FileAttachment, StoredAttachment, PermissionRequest } from "../../../shared/types"
import { SetupAuthBanner, type BannerState } from "./SetupAuthBanner"
import { TurnCard } from "./TurnCard"
import { groupMessagesByTurn, type Turn, type AssistantTurn, type UserTurn, type SystemTurn } from "./turn-utils"
import { InputContainer, type StructuredInputState, type StructuredResponse, type PermissionResponse } from "./input"

/** Agent setup state for showing setup indicator in input area */
interface AgentSetupState {
  /** Banner state matching SetupAuthBanner */
  state: BannerState
  agentName?: string
  /** Optional reason/message to display */
  reason?: string
  /** Action callback (activate, retry, authenticate) */
  onAction: () => void
}

interface ChatDisplayProps {
  session: Session | null
  onSendMessage: (message: string, attachments?: FileAttachment[]) => void
  onOpenFile: (path: string) => void
  onOpenUrl: (url: string) => void
  // Model selection
  currentModel: string
  onModelChange: (model: string) => void
  /** Ref for the textarea, used for external focus control */
  textareaRef?: React.RefObject<HTMLTextAreaElement>
  /** When true, disables input (e.g., when agent needs activation) */
  disabled?: boolean
  /** Pending permission request for this session */
  pendingPermission?: PermissionRequest
  /** Callback to respond to permission request */
  onRespondToPermission?: (sessionId: string, requestId: string, allowed: boolean, alwaysAllow: boolean) => void
  /** Agent setup state - when present, shows setup indicator in input area */
  agentSetupState?: AgentSetupState
  // Advanced options
  /** Enable ultrathink mode for extended reasoning */
  ultrathinkEnabled?: boolean
  onUltrathinkChange?: (enabled: boolean) => void
  /** Skip all permission prompts automatically */
  skipPermissions?: boolean
  onSkipPermissionsChange?: (enabled: boolean) => void
  /** Enable plan mode for complex tasks */
  planModeEnabled?: boolean
  onPlanModeChange?: (enabled: boolean) => void
  // Input value preservation (controlled from parent)
  /** Current input value - preserved across mode switches and conversation changes */
  inputValue?: string
  /** Callback when input value changes */
  onInputChange?: (value: string) => void
}

/**
 * Processing status messages - cycles through these randomly
 * Inspired by Claude Code's playful status messages
 */
const PROCESSING_MESSAGES = [
  'Thinking...',
  'Pondering...',
  'Contemplating...',
  'Reasoning...',
  'Processing...',
  'Computing...',
  'Considering...',
  'Reflecting...',
  'Deliberating...',
  'Cogitating...',
  'Ruminating...',
  'Musing...',
  'Working on it...',
  'On it...',
  'Crunching...',
  'Brewing...',
  'Connecting dots...',
  'Mulling it over...',
  'Deep in thought...',
  'Hmm...',
  'Let me see...',
  'One moment...',
  'Hold on...',
  'Bear with me...',
  'Just a sec...',
  'Hang tight...',
  'Getting there...',
  'Almost...',
  'Working...',
  'Busy busy...',
  'Whirring...',
  'Churning...',
  'Percolating...',
  'Simmering...',
  'Cooking...',
  'Baking...',
  'Stirring...',
  'Spinning up...',
  'Warming up...',
  'Revving...',
  'Buzzing...',
  'Humming...',
  'Ticking...',
  'Clicking...',
  'Whizzing...',
  'Zooming...',
  'Zipping...',
  'Chugging...',
  'Trucking...',
  'Rolling...',
]

/**
 * Format elapsed time: "45s" under a minute, "1:02" for 1+ minutes
 */
function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

interface ProcessingIndicatorProps {
  /** Start timestamp (persists across remounts) */
  startTime?: number
}

/**
 * ProcessingIndicator - Shows cycling status messages with elapsed time
 * Matches TurnCard header layout for visual continuity
 */
function ProcessingIndicator({ startTime }: ProcessingIndicatorProps) {
  const [elapsed, setElapsed] = React.useState(0)
  const [messageIndex, setMessageIndex] = React.useState(() =>
    Math.floor(Math.random() * PROCESSING_MESSAGES.length)
  )

  // Update elapsed time every second using provided startTime
  React.useEffect(() => {
    const start = startTime || Date.now()
    // Set initial elapsed immediately
    setElapsed(Math.floor((Date.now() - start) / 1000))

    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [startTime])

  // Cycle through messages every 10 seconds
  React.useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex(prev => {
        // Pick a random different message
        let next = Math.floor(Math.random() * PROCESSING_MESSAGES.length)
        while (next === prev && PROCESSING_MESSAGES.length > 1) {
          next = Math.floor(Math.random() * PROCESSING_MESSAGES.length)
        }
        return next
      })
    }, 10000)
    return () => clearInterval(interval)
  }, [])

  const currentMessage = PROCESSING_MESSAGES[messageIndex]

  return (
    <div className="flex items-center gap-2 px-3 py-1 -mb-1 text-[13px] text-muted-foreground">
      {/* Spinner in same location as TurnCard chevron */}
      <div className="w-3 h-3 flex items-center justify-center shrink-0">
        <Spinner className="text-[10px]" />
      </div>
      {/* Label with crossfade animation + layout animation for smooth repositioning */}
      <motion.span className="relative h-5 flex items-center" layout>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={currentMessage}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: 'easeInOut' }}
            layout
          >
            {currentMessage}
          </motion.span>
        </AnimatePresence>
        {elapsed >= 1 && (
          <motion.span
            className="text-muted-foreground/60 ml-1"
            layout
            transition={{ duration: 0.4, ease: 'easeInOut' }}
          >
            {formatElapsed(elapsed)}
          </motion.span>
        )}
      </motion.span>
    </div>
  )
}

/**
 * ChatDisplay - Main chat interface for a selected session
 *
 * Structure:
 * - Session Header: Avatar + workspace name
 * - Messages Area: Scrollable list of MessageBubble components
 * - Input Area: Textarea + Send button
 *
 * Shows empty state when no session is selected
 */
export function ChatDisplay({
  session,
  onSendMessage,
  onOpenFile,
  onOpenUrl,
  currentModel,
  onModelChange,
  textareaRef: externalTextareaRef,
  disabled = false,
  pendingPermission,
  onRespondToPermission,
  agentSetupState,
  // Advanced options
  ultrathinkEnabled = false,
  onUltrathinkChange,
  skipPermissions = false,
  onSkipPermissionsChange,
  planModeEnabled = false,
  onPlanModeChange,
  // Input value preservation
  inputValue,
  onInputChange,
}: ChatDisplayProps) {
  // Input is only disabled when explicitly disabled (e.g., agent needs activation)
  // User can type during streaming - submitting will stop the stream and send
  const isInputDisabled = disabled
  const messagesEndRef = React.useRef<HTMLDivElement>(null)
  const scrollViewportRef = React.useRef<HTMLDivElement>(null)
  const prevSessionIdRef = React.useRef<string | null>(null)
  const isAtBottomRef = React.useRef(true)
  const internalTextareaRef = React.useRef<HTMLTextAreaElement>(null)
  const textareaRef = externalTextareaRef || internalTextareaRef
  // Performance: Track pending scroll to avoid redundant scrollIntoView calls
  const pendingScrollRef = React.useRef<number | null>(null)

  // Register as focus zone - when zone gains focus, focus the textarea
  const { zoneRef, isFocused } = useFocusZone({
    zoneId: 'chat',
    focusFirst: () => {
      textareaRef.current?.focus()
    },
  })

  // Focus textarea when zone gains focus
  useEffect(() => {
    if (isFocused && session) {
      textareaRef.current?.focus()
    }
  }, [isFocused, session])

  // Pop-out handler - opens message in a new preview window
  const handlePopOut = React.useCallback((message: Message) => {
    if (!session) return
    window.electronAPI.openPreview(session.id, message.id, message.content)
  }, [session])

  // Track scroll position to determine if user is at bottom
  // Threshold of 50px allows for small scroll variations
  const handleScroll = React.useCallback(() => {
    const viewport = scrollViewportRef.current
    if (!viewport) return
    const { scrollTop, scrollHeight, clientHeight } = viewport
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight
    isAtBottomRef.current = distanceFromBottom < 50
  }, [])

  // Set up scroll event listener
  React.useEffect(() => {
    const viewport = scrollViewportRef.current
    if (!viewport) return
    viewport.addEventListener('scroll', handleScroll)
    return () => viewport.removeEventListener('scroll', handleScroll)
  }, [handleScroll])

  // Auto-scroll to bottom
  // - Session switch: scroll immediately (no animation delay)
  // - Streaming updates: use requestAnimationFrame to batch (performance)
  React.useEffect(() => {
    const isSessionSwitch = prevSessionIdRef.current !== session?.id
    prevSessionIdRef.current = session?.id ?? null

    // Always scroll on session switch, otherwise only if user is at bottom
    if (isSessionSwitch || isAtBottomRef.current) {
      // Cancel any pending scroll
      if (pendingScrollRef.current !== null) {
        cancelAnimationFrame(pendingScrollRef.current)
        pendingScrollRef.current = null
      }

      if (isSessionSwitch) {
        // Session switch: scroll immediately (synchronous) to avoid visible jump
        messagesEndRef.current?.scrollIntoView({ behavior: 'instant' })
      } else {
        // Streaming updates: batch with requestAnimationFrame for performance
        pendingScrollRef.current = requestAnimationFrame(() => {
          pendingScrollRef.current = null
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
        })
      }
    }

    // Cleanup on unmount
    return () => {
      if (pendingScrollRef.current !== null) {
        cancelAnimationFrame(pendingScrollRef.current)
      }
    }
  }, [session?.id, session?.messages])

  // Handle message submission from InputContainer
  const handleSubmit = async (message: string, attachments?: FileAttachment[]) => {
    // If currently processing, stop the stream first
    if (session?.isProcessing) {
      try {
        await window.electronAPI.cancelProcessing(session.id)
        await new Promise(resolve => setTimeout(resolve, 100))
      } catch (error) {
        console.error('[ChatDisplay] Failed to cancel before send:', error)
      }
    }

    onSendMessage(message, attachments)
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  // Handle stop request from InputContainer
  const handleStop = () => {
    if (!session?.isProcessing) return
    window.electronAPI.cancelProcessing(session.id).catch(error => {
      console.error('[ChatDisplay] Failed to cancel processing:', error)
    })
  }

  // Handle structured input responses (permissions, clarifications, plan reviews)
  const handleStructuredResponse = (response: StructuredResponse) => {
    if (response.type === 'permission' && pendingPermission && onRespondToPermission) {
      const permResponse = response as PermissionResponse
      onRespondToPermission(
        pendingPermission.sessionId,
        pendingPermission.requestId,
        permResponse.allowed,
        permResponse.alwaysAllow
      )
    }
    // TODO: Handle clarification and plan_review responses
  }

  // Build structured input state from pending permission
  const structuredInput: StructuredInputState | undefined = pendingPermission
    ? { type: 'permission', data: pendingPermission }
    : undefined

  // Memoize turn grouping - avoids O(n) iteration on every render/keystroke
  const turns = React.useMemo(
    () => session ? groupMessagesByTurn(session.messages) : [],
    [session?.messages]
  )

  return (
    <div ref={zoneRef} className="flex h-full flex-col min-w-0" data-focus-zone="chat">
      {session ? (
        <div className="flex flex-1 flex-col min-h-0 min-w-0">
          {/* === MESSAGES AREA: Scrollable list of message bubbles === */}
          {/* Top fade gradient - overlays top of scroll area (pr-2 avoids scrollbar) */}
          <div className="h-8 mb-[-2rem] relative z-10 bg-gradient-to-b from-background to-transparent pointer-events-none pr-2" />
          <ScrollArea className="flex-1 min-w-0" viewportRef={scrollViewportRef}>
            <div className="max-w-[960px] mx-auto px-5 py-8 space-y-2.5 min-w-0">
              {session.messages.length === 0 ? (
                /* Empty State: Welcome message for new sessions */
                <div className="flex flex-col items-center justify-center h-64 text-muted-foreground px-8">
                  <p className="text-sm font-medium">
                    {session.agentName ? `Chat with ${session.agentName}` : `Welcome to ${session.workspaceName}`}
                  </p>
                  <p className="text-xs mt-1 text-center">Start a conversation by typing a message below.</p>
                </div>
              ) : (
                /* Turn-based Message Display - memoized to avoid re-grouping on every render */
                (() => {
                  return turns.map((turn) => {
                    // User turns - render with MemoizedMessageBubble
                    // Extra top margin creates visual separation after AI responses
                    if (turn.type === 'user') {
                      return (
                        <div key={`user-${turn.message.id}`} className="pt-3">
                          <MemoizedMessageBubble
                            message={turn.message}
                            onOpenFile={onOpenFile}
                            onOpenUrl={onOpenUrl}
                          />
                        </div>
                      )
                    }

                    // System turns (error, status, info, warning) - render with MemoizedMessageBubble
                    if (turn.type === 'system') {
                      return (
                        <MemoizedMessageBubble
                          key={`system-${turn.message.id}`}
                          message={turn.message}
                          onOpenFile={onOpenFile}
                          onOpenUrl={onOpenUrl}
                        />
                      )
                    }

                    // Assistant turns - render with TurnCard (buffered streaming)
                    return (
                      <TurnCard
                        key={`turn-${turn.turnId}`}
                        activities={turn.activities}
                        response={turn.response}
                        intent={turn.intent}
                        isStreaming={turn.isStreaming}
                        isComplete={turn.isComplete}
                        onOpenFile={onOpenFile}
                        onOpenUrl={onOpenUrl}
                        onPopOut={(text) => {
                          if (session) {
                            window.electronAPI.openPreview(session.id, turn.turnId, text)
                          }
                        }}
                      />
                    )
                  })
                })()
              )}
              {/* Processing Indicator - always visible while processing */}
              {session.isProcessing && (() => {
                // Find the last user message timestamp for accurate elapsed time
                const lastUserMsg = [...session.messages].reverse().find(m => m.role === 'user')
                return <ProcessingIndicator startTime={lastUserMsg?.timestamp} />
              })()}
              {/* Scroll Anchor: For auto-scroll to bottom */}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          {/* Bottom fade gradient - overlays bottom of scroll area (pr-2 avoids scrollbar) */}
          <div className="h-8 -mt-8 relative z-10 bg-gradient-to-t from-background to-transparent pointer-events-none pr-2" />

          {/* === INPUT CONTAINER: FreeForm or Structured Input === */}
          <div className="max-w-[960px] mx-auto w-full px-4 pb-4 mt-1">
            {/* Agent Setup Banner - shown instead of input when agent needs setup */}
            {agentSetupState && agentSetupState.state !== 'hidden' && !pendingPermission ? (
              <SetupAuthBanner
                state={agentSetupState.state}
                agentName={agentSetupState.agentName}
                reason={agentSetupState.reason}
                onAction={agentSetupState.onAction}
                variant="inputAreaCover"
              />
            ) : (
              <InputContainer
                placeholder={`Message ${session.agentName || session.workspaceName || 'Chat'}...`}
                disabled={isInputDisabled}
                isProcessing={session.isProcessing}
                onSubmit={handleSubmit}
                onStop={handleStop}
                textareaRef={textareaRef}
                currentModel={currentModel}
                onModelChange={onModelChange}
                ultrathinkEnabled={ultrathinkEnabled}
                onUltrathinkChange={onUltrathinkChange}
                skipPermissions={skipPermissions}
                onSkipPermissionsChange={onSkipPermissionsChange}
                planModeEnabled={planModeEnabled}
                onPlanModeChange={onPlanModeChange}
                structuredInput={structuredInput}
                onStructuredResponse={handleStructuredResponse}
                inputValue={inputValue}
                onInputChange={onInputChange}
              />
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * MessageBubble - Renders a single message based on its role
 *
 * Message Roles & Styles:
 * - user:      Right-aligned, blue (bg-primary), white text
 * - assistant: Left-aligned, gray (bg-muted), markdown rendered with clickable links
 * - error:     Left-aligned, red border/bg, warning icon + error message
 * - status:    Centered pill badge with pulsing dot (e.g., "Thinking...")
 *
 * Note: Tool messages are rendered by TurnCard, not MessageBubble
 */
interface MessageBubbleProps {
  message: Message
  onOpenFile: (path: string) => void
  onOpenUrl: (url: string) => void
  /**
   * Markdown render mode for assistant messages
   * @default 'minimal'
   */
  renderMode?: RenderMode
  /**
   * Callback to pop out message into a separate window
   */
  onPopOut?: (message: Message) => void
}

/**
 * ErrorMessage - Separate component for error messages to allow useState hook
 */
function ErrorMessage({ message }: { message: Message }) {
  const hasDetails = (message.errorDetails && message.errorDetails.length > 0) || message.errorOriginal
  const [detailsOpen, setDetailsOpen] = React.useState(false)

  return (
    <div className="flex justify-start">
      <div className="max-w-[80%] bg-destructive/10 rounded-[8px] pl-5 pr-4 pt-2 pb-2.5 break-words">
        <div className="text-xs text-destructive/50 mb-0.5 font-semibold">
          {message.errorTitle || 'Error'}
        </div>
        <p className="text-sm text-destructive">{message.content}</p>

        {/* Collapsible Details Toggle */}
        {hasDetails && (
          <div className="mt-2">
            <button
              onClick={() => setDetailsOpen(!detailsOpen)}
              className="flex items-center gap-1 text-xs text-destructive/70 hover:text-destructive transition-colors"
            >
              {detailsOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              <span>{detailsOpen ? 'Hide' : 'Show'} technical details</span>
            </button>

            <AnimatedCollapsibleContent isOpen={detailsOpen} className="overflow-hidden">
              <div className="mt-2 pt-2 border-t border-destructive/20 text-xs text-destructive/60 font-mono space-y-0.5">
                {message.errorDetails?.map((detail, i) => (
                  <div key={i}>{detail}</div>
                ))}
                {message.errorOriginal && !message.errorDetails?.some(d => d.includes('Raw error:')) && (
                  <div className="mt-1">Raw: {message.errorOriginal.slice(0, 200)}{message.errorOriginal.length > 200 ? '...' : ''}</div>
                )}
              </div>
            </AnimatedCollapsibleContent>
          </div>
        )}
      </div>
    </div>
  )
}

function MessageBubble({
  message,
  onOpenFile,
  onOpenUrl,
  renderMode = 'minimal',
  onPopOut,
}: MessageBubbleProps) {
  // === USER MESSAGE: Right-aligned blue bubble with attachments above ===
  if (message.role === 'user') {
    const hasAttachments = message.attachments && message.attachments.length > 0

    return (
      <div className="flex flex-col items-end gap-1">
        {/* Attachment preview row - stored attachments with thumbnails */}
        {hasAttachments && (
          <div className="flex gap-2 justify-end max-w-[80%] flex-wrap">
            {message.attachments!.map((att, i) => {
              const isImage = att.type === 'image'
              const hasThumbnail = !!att.thumbnailBase64

              return (
                <div
                  key={att.id || i}
                  className="shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => att.storedPath && onOpenFile(att.storedPath)}
                  title={`Click to open ${att.name}`}
                >
                  {isImage ? (
                    /* IMAGE: Square thumbnail only */
                    <div className="h-14 w-14 rounded-lg overflow-hidden border bg-muted">
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
                    <div className="flex items-center gap-2.5 rounded-xl border bg-muted/50 pl-1.5 pr-3 py-1.5">
                      <div className="h-11 w-11 rounded-lg overflow-hidden bg-muted flex items-center justify-center shrink-0">
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
        <div className="max-w-[80%] bg-foreground/5 rounded-[16px] px-4 py-1 break-words min-w-0">
          <Markdown
            mode="minimal"
            onUrlClick={onOpenUrl}
            onFileClick={onOpenFile}
            className="text-sm [&_a]:underline [&_code]:bg-foreground/10"
          >
            {message.content}
          </Markdown>
        </div>
      </div>
    )
  }

  // === ASSISTANT MESSAGE: Left-aligned gray bubble with markdown rendering ===
  if (message.role === 'assistant') {
    return (
      <div className="flex justify-start group">
        <div className="relative max-w-[90%] bg-white shadow-minimal rounded-[8px] pl-6 pr-4 py-3 break-words min-w-0">
          {/* Pop-out button - visible on hover */}
          {onPopOut && !message.isStreaming && (
            <button
              onClick={() => onPopOut(message)}
              className="absolute top-2 right-2 p-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-foreground/5"
              title="Open in new window"
            >
              <ExternalLink className="w-4 h-4 text-muted-foreground hover:text-foreground" />
            </button>
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
                className="text-sm"
                collapsible
              >
                {message.content}
              </Markdown>
            </CollapsibleMarkdownProvider>
          )}
        </div>
      </div>
    )
  }

  // === ERROR MESSAGE: Red bordered bubble with warning icon and collapsible details ===
  if (message.role === 'error') {
    return <ErrorMessage message={message} />
  }

  // === STATUS MESSAGE: Matches ProcessingIndicator layout for visual consistency ===
  if (message.role === 'status') {
    return (
      <div className="flex items-center gap-2 px-3 py-1 -mb-1 text-[13px] text-muted-foreground">
        {/* Spinner in same location as TurnCard chevron */}
        <div className="w-3 h-3 flex items-center justify-center shrink-0">
          <Spinner className="text-[10px]" />
        </div>
        <span>{message.content}</span>
      </div>
    )
  }

  // === INFO MESSAGE: Icon and color based on level ===
  if (message.role === 'info') {
    const level = message.infoLevel || 'info'
    const config = {
      info: { icon: Info, className: 'text-muted-foreground' },
      warning: { icon: AlertTriangle, className: 'text-amber-600' },
      error: { icon: CircleAlert, className: 'text-destructive' },
      success: { icon: CheckCircle2, className: 'text-emerald-600' },
    }[level]
    const Icon = config.icon

    return (
      <div className={cn('flex items-center gap-2 px-3 py-1 text-[13px]', config.className)}>
        <div className="w-3 h-3 flex items-center justify-center shrink-0">
          <Icon className="w-3 h-3" />
        </div>
        <span>{message.content}</span>
      </div>
    )
  }

  // === WARNING MESSAGE: Amber themed bubble ===
  if (message.role === 'warning') {
    return (
      <div className="flex justify-start">
        <div className="max-w-[80%] bg-amber-500/10 rounded-[8px] pl-5 pr-4 pt-2 pb-2.5 break-words">
          <div className="text-xs text-amber-600/50 dark:text-amber-500/50 mb-0.5 font-semibold">
            Warning
          </div>
          <p className="text-sm text-amber-700 dark:text-amber-400">{message.content}</p>
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
const MemoizedMessageBubble = React.memo(MessageBubble, (prev, next) => {
  // Always re-render streaming messages (content is changing)
  if (prev.message.isStreaming || next.message.isStreaming) {
    return false
  }
  // Skip re-render if key props unchanged
  return (
    prev.message.id === next.message.id &&
    prev.message.content === next.message.content &&
    prev.message.role === next.message.role
  )
})
