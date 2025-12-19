import * as React from "react"
import { useEffect } from "react"
import {
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Paperclip,
  ArrowUp,
  Square,
  AlertTriangle,
  ExternalLink,
  CircleSlash,
  Zap,
  ShieldOff,
} from "lucide-react"
import { motion } from "motion/react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
} from "@/components/ui/styled-dropdown"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { Markdown, CollapsibleMarkdownProvider, StreamingMarkdown, type RenderMode } from "@/components/markdown"
import { AnimatedCollapsibleContent } from "@/components/ui/collapsible"
import { AttachmentPreview, FileTypeIcon, getFileTypeLabel } from "./AttachmentPreview"
import { Spinner } from "@/components/ui/loading-indicator"
import { useFocusZone } from "@/hooks/keyboard"
import type { Session, Message, FileAttachment, StoredAttachment, PermissionRequest } from "../../../shared/types"
import { PermissionBanner } from "./PermissionBanner"
import { SetupAuthBanner, type BannerState } from "./SetupAuthBanner"
import { MODELS, getModelDisplayName } from "@config/models"
import { TurnCard } from "./TurnCard"
import { groupMessagesByTurn, type Turn, type AssistantTurn, type UserTurn, type SystemTurn } from "./turn-utils"

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
}

/**
 * ThinkingIndicator - Shows "Thinking..." with elapsed time
 * Matches TurnCard header layout for visual continuity
 */
function ThinkingIndicator() {
  const [elapsed, setElapsed] = React.useState(0)
  const startTimeRef = React.useRef(Date.now())

  React.useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="flex items-center gap-2 px-3 py-1 -mb-1 text-[13px] text-muted-foreground">
      {/* Spinner in same location as TurnCard chevron */}
      <div className="w-3 h-3 flex items-center justify-center shrink-0">
        <Spinner className="text-[10px]" />
      </div>
      {/* Label with elapsed time inline */}
      <span>
        Thinking...
        {elapsed >= 1 && (
          <span className="text-muted-foreground/60 ml-1">{elapsed}s</span>
        )}
      </span>
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
}: ChatDisplayProps) {
  // Input is only disabled when explicitly disabled (e.g., agent needs activation)
  // User can type during streaming - submitting will stop the stream and send
  const isInputDisabled = disabled
  const [input, setInput] = React.useState("")
  const [attachments, setAttachments] = React.useState<FileAttachment[]>([])
  const [isDraggingOver, setIsDraggingOver] = React.useState(false)
  const [loadingCount, setLoadingCount] = React.useState(0)
  const messagesEndRef = React.useRef<HTMLDivElement>(null)
  const scrollViewportRef = React.useRef<HTMLDivElement>(null)
  const prevSessionIdRef = React.useRef<string | null>(null)
  const isAtBottomRef = React.useRef(true)
  const internalTextareaRef = React.useRef<HTMLTextAreaElement>(null)
  const textareaRef = externalTextareaRef || internalTextareaRef
  const dragCounterRef = React.useRef(0)

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

  // File attachment handlers
  const handleAttachClick = async () => {
    console.log('[ChatDisplay] Attach button clicked')
    if (isInputDisabled) {
      console.log('[ChatDisplay] Input is disabled, ignoring click')
      return
    }
    try {
      console.log('[ChatDisplay] Opening file dialog...')
      const paths = await window.electronAPI.openFileDialog()
      console.log('[ChatDisplay] File dialog returned:', paths)
      for (const path of paths) {
        const attachment = await window.electronAPI.readFileAttachment(path)
        console.log('[ChatDisplay] Read attachment:', attachment?.name)
        if (attachment) {
          setAttachments(prev => [...prev, attachment])
        }
      }
    } catch (error) {
      console.error('[ChatDisplay] Failed to attach files:', error)
    }
  }

  const handleRemoveAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index))
  }

  // Drag and drop handlers
  // Uses a counter to properly track enter/leave events with nested elements
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (e.dataTransfer.types.includes('Files')) {
      setIsDraggingOver(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      setIsDraggingOver(false)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  // Helper to read a File using FileReader API (for when Electron's file.path isn't available)
  const readFileAsAttachment = async (file: File): Promise<FileAttachment | null> => {
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = async () => {
        const result = reader.result as ArrayBuffer
        const base64 = btoa(
          new Uint8Array(result).reduce((data, byte) => data + String.fromCharCode(byte), '')
        )

        // Determine type from MIME
        let type: FileAttachment['type'] = 'unknown'
        if (file.type.startsWith('image/')) type = 'image'
        else if (file.type === 'application/pdf') type = 'pdf'
        else if (file.type.includes('text') || file.name.match(/\.(txt|md|json|js|ts|tsx|py|css|html)$/i)) type = 'text'
        else if (file.type.includes('officedocument') || file.name.match(/\.(docx?|xlsx?|pptx?)$/i)) type = 'office'

        const mimeType = file.type || 'application/octet-stream'

        // Generate thumbnail via IPC (uses Quick Look on macOS)
        let thumbnailBase64: string | undefined
        try {
          const thumb = await window.electronAPI.generateThumbnail(base64, mimeType)
          if (thumb) {
            thumbnailBase64 = thumb
          }
        } catch (err) {
          console.log('[ChatDisplay] Thumbnail generation failed:', err)
        }

        resolve({
          type,
          path: file.name, // Use name as path since we don't have the real path
          name: file.name,
          mimeType,
          base64,
          size: file.size,
          thumbnailBase64,
        })
      }
      reader.onerror = () => resolve(null)
      reader.readAsArrayBuffer(file)
    })
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current = 0
    setIsDraggingOver(false)
    if (isInputDisabled) return

    const files = Array.from(e.dataTransfer.files)
    console.log('[ChatDisplay] Dropped files:', files.map(f => ({ name: f.name, path: (f as any).path })))

    // Show loading indicators for all files
    setLoadingCount(files.length)

    for (const file of files) {
      // In Electron, dropped files have a path property - try it first
      const filePath = (file as File & { path?: string }).path
      if (filePath) {
        try {
          const attachment = await window.electronAPI.readFileAttachment(filePath)
          if (attachment) {
            setAttachments(prev => [...prev, attachment])
            setLoadingCount(prev => prev - 1)
            continue
          }
        } catch (error) {
          console.error('[ChatDisplay] Failed to read via IPC:', error)
        }
      }

      // Fallback: read file directly using FileReader API
      console.log('[ChatDisplay] Using FileReader fallback for:', file.name)
      try {
        const attachment = await readFileAsAttachment(file)
        if (attachment) {
          setAttachments(prev => [...prev, attachment])
        }
      } catch (error) {
        console.error('[ChatDisplay] Failed to read dropped file:', error)
      }
      setLoadingCount(prev => prev - 1)
    }
  }

  // Clear attachments when session changes
  React.useEffect(() => {
    setAttachments([])
  }, [session?.id])

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
  // - Always scroll on session switch (instant)
  // - Only scroll on new messages if user was at bottom (smooth)
  React.useEffect(() => {
    const isSessionSwitch = prevSessionIdRef.current !== session?.id
    prevSessionIdRef.current = session?.id ?? null

    // Always scroll on session switch, otherwise only if user is at bottom
    if (isSessionSwitch || isAtBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({
        behavior: isSessionSwitch ? 'instant' : 'smooth'
      })
    }
  }, [session?.id, session?.messages])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const hasContent = input.trim() || attachments.length > 0
    if (!hasContent || isInputDisabled) return

    // If currently processing, stop the stream first
    if (session?.isProcessing) {
      try {
        await window.electronAPI.cancelProcessing(session.id)
        // Small delay to let the cancellation complete
        await new Promise(resolve => setTimeout(resolve, 100))
      } catch (error) {
        console.error('[ChatDisplay] Failed to cancel before send:', error)
      }
    }

    onSendMessage(input.trim(), attachments.length > 0 ? attachments : undefined)
    setInput("")
    setAttachments([])

    // Scroll to bottom with animation when sending a message
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const handleStop = () => {
    if (!session?.isProcessing) return
    // Fire and forget - don't await, UI updates when 'complete' event arrives
    window.electronAPI.cancelProcessing(session.id).catch(error => {
      console.error('[ChatDisplay] Failed to cancel processing:', error)
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Enter (without shift) or Cmd+Enter to submit
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit(e)
    }
    // Escape to stop streaming (if processing) or blur textarea
    if (e.key === 'Escape') {
      if (session?.isProcessing) {
        handleStop()
      } else {
        textareaRef.current?.blur()
      }
    }
  }

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
                /* Turn-based Message Display */
                (() => {
                  const turns = groupMessagesByTurn(session.messages)

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
              {/* Thinking Indicator - always visible while processing */}
              {session.isProcessing && <ThinkingIndicator />}
              {/* Scroll Anchor: For auto-scroll to bottom */}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          {/* Bottom fade gradient - overlays bottom of scroll area (pr-2 avoids scrollbar) */}
          <div className="h-8 -mt-8 relative z-10 bg-gradient-to-t from-background to-transparent pointer-events-none pr-2" />

          {/* === INPUT CONTAINER: Textarea + Bottom row with controls === */}
          <div className="max-w-[960px] mx-auto w-full px-4 pb-4 mt-1">
            <div className="relative">
              {/* Permission Banner - crossfades with input, anchored to bottom */}
              {pendingPermission && onRespondToPermission && (
                <motion.div
                  initial={false}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                  className="absolute inset-x-0 bottom-0 z-10"
                >
                  <PermissionBanner
                    request={pendingPermission}
                    onRespond={(allowed, alwaysAllow) =>
                      onRespondToPermission(pendingPermission.sessionId, pendingPermission.requestId, allowed, alwaysAllow)
                    }
                  />
                </motion.div>
              )}

              {/* Agent Setup Banner - shown instead of input when agent needs setup */}
              {agentSetupState && agentSetupState.state !== 'hidden' && !pendingPermission && (
                <motion.div
                  initial={false}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                  className="absolute inset-x-0 bottom-0 z-10"
                >
                  <SetupAuthBanner
                    state={agentSetupState.state}
                    agentName={agentSetupState.agentName}
                    reason={agentSetupState.reason}
                    onAction={agentSetupState.onAction}
                    variant="inputAreaCover"
                  />
                </motion.div>
              )}

              {/* Normal Input Form - fades when permission/setup shows */}
              <motion.form
                initial={false}
                animate={{
                  opacity: (pendingPermission || (agentSetupState && agentSetupState.state !== 'hidden')) ? 0 : 1
                }}
                transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                onSubmit={handleSubmit}
                style={{
                  pointerEvents: (pendingPermission || (agentSetupState && agentSetupState.state !== 'hidden')) ? 'none' : 'auto'
                }}
              >
                <div
                  className={cn(
                    "rounded-[8px] bg-background overflow-hidden transition-all shadow-middle",
                    isDraggingOver && "ring-2 ring-primary ring-offset-2 ring-offset-background bg-primary/5"
                  )}
                  onDragEnter={handleDragEnter}
                  onDragLeave={handleDragLeave}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                >
                  {/* Attachment Preview - ChatGPT-style bubbles above textarea */}
                  <AttachmentPreview
                    attachments={attachments}
                    onRemove={handleRemoveAttachment}
                    disabled={isInputDisabled}
                    loadingCount={loadingCount}
                  />

                  {/* Textarea - 4 lines minimum height */}
                  <textarea
                    ref={textareaRef}
                    className="w-full min-h-[72px] pl-5 pr-4 pt-4 pb-3 bg-transparent outline-none text-sm placeholder:text-muted-foreground resize-none focus-visible:ring-0"
                    placeholder={`Message ${session.agentName || session.workspaceName || 'Chat'}...`}
                    value={input}
                    onChange={(e) => {
                      let value = e.target.value
                      // Auto-capitalize first letter
                      if (value.length > 0) {
                        value = value.charAt(0).toUpperCase() + value.slice(1)
                      }
                      setInput(value)
                    }}
                    onKeyDown={handleKeyDown}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    disabled={isInputDisabled}
                    rows={3}
                  />

                  {/* Bottom Row: Attach, Model selector, Send */}
                  <div className="flex items-center gap-1 px-2 py-2 border-t border-border/50">
                    {/* Attach File Button */}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={handleAttachClick}
                      disabled={isInputDisabled}
                    >
                      <Paperclip className="h-4 w-4" />
                    </Button>

                    {/* Model Selector Dropdown */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 text-xs shrink-0 hover:bg-foreground/5 data-[state=open]:bg-foreground/5"
                        >
                          {getModelDisplayName(currentModel)}
                          <ChevronDown className="h-3 w-3 opacity-50" />
                        </Button>
                      </DropdownMenuTrigger>
                      <StyledDropdownMenuContent side="top" align="start" sideOffset={8}>
                        {MODELS.map((model) => (
                          <StyledDropdownMenuItem
                            key={model.id}
                            onClick={() => onModelChange(model.id)}
                            className={cn(currentModel === model.id && "bg-foreground/10")}
                          >
                            {model.name}
                          </StyledDropdownMenuItem>
                        ))}
                      </StyledDropdownMenuContent>
                    </DropdownMenu>

                    {/* Advanced Options - Clickable Tags */}
                    <button
                      type="button"
                      onClick={() => onUltrathinkChange?.(!ultrathinkEnabled)}
                      className={cn(
                        "h-6 px-2.5 text-[11px] font-medium rounded-[4px] flex items-center gap-1.5 transition-all",
                        ultrathinkEnabled
                          ? "bg-gradient-to-r from-violet-500/20 via-fuchsia-500/20 to-pink-500/20 text-fuchsia-500 border border-fuchsia-500/30 shadow-[0_0_12px_rgba(217,70,239,0.2)]"
                          : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground border border-transparent"
                      )}
                    >
                      <Zap className={cn("h-3 w-3", ultrathinkEnabled && "fill-fuchsia-500")} />
                      <span>Ultrathink</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onSkipPermissionsChange?.(!skipPermissions)}
                      className={cn(
                        "h-6 px-2.5 text-[11px] font-medium rounded-[4px] flex items-center gap-1.5 transition-all",
                        skipPermissions
                          ? "bg-red-500/10 text-red-500 border border-red-500/30"
                          : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground border border-transparent"
                      )}
                    >
                      <ShieldOff className="h-3 w-3" />
                      <span>Skip Permissions</span>
                    </button>

                    {/* Spacer */}
                    <div className="flex-1" />

                    {/* Send/Stop Button - show send if there's content, stop if processing with no content */}
                    {(() => {
                      const hasContent = input.trim() || attachments.length > 0
                      // Show send button if there's content OR not processing
                      if (hasContent || !session?.isProcessing) {
                        return (
                          <Button
                            type="submit"
                            size="icon"
                            className="h-7 w-7 rounded-full shrink-0"
                            disabled={!hasContent || disabled}
                          >
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                        )
                      }
                      // Show stop button when processing with no content
                      return (
                        <Button
                          type="button"
                          size="icon"
                          variant="secondary"
                          className="h-7 w-7 rounded-full shrink-0 hover:bg-foreground/15 active:bg-foreground/20"
                          onClick={handleStop}
                        >
                          <Square className="h-3 w-3 fill-current" />
                        </Button>
                      )
                    })()}
                  </div>
                </div>
              </motion.form>
            </div>
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
        <div className="relative max-w-[80%] bg-white shadow-minimal rounded-[8px] pl-6 pr-4 py-3 break-words min-w-0">
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

  // === STATUS MESSAGE: Matches ThinkingIndicator layout for visual consistency ===
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

  // === INFO MESSAGE: Matches TurnCard header style ===
  if (message.role === 'info') {
    return (
      <div className="flex items-center gap-2 px-3 py-1 text-[13px] text-muted-foreground">
        <div className="w-3 h-3 flex items-center justify-center shrink-0">
          <CircleSlash className="w-3 h-3" />
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
