import * as React from "react"
import { useEffect } from "react"
import {
  MessageSquare,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Paperclip,
  ArrowUp,
  Bot,
  AlertTriangle,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
} from "@/components/ui/styled-dropdown"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { Markdown, CollapsibleMarkdownProvider, type RenderMode } from "@/components/markdown"
import { AnimatedCollapsibleContent } from "@/components/ui/collapsible"
import { AttachmentPreview, FileTypeIcon, getFileTypeLabel } from "./AttachmentPreview"
import { LoadingIndicator } from "@/components/ui/loading-indicator"
import { useFocusZone } from "@/hooks/keyboard"
import type { Session, Message, FileAttachment, StoredAttachment, PermissionRequest } from "../../../shared/types"
import { PermissionBanner } from "./PermissionBanner"
import { MODELS, getModelDisplayName } from "@config/models"

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
  /** When true, disables input (e.g., when agent needs setup) */
  disabled?: boolean
  /** Pending permission request for this session */
  pendingPermission?: PermissionRequest
  /** Callback to respond to permission request */
  onRespondToPermission?: (sessionId: string, requestId: string, allowed: boolean, alwaysAllow: boolean) => void
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
}: ChatDisplayProps) {
  // Input is disabled when explicitly disabled prop is true OR session is processing
  const isInputDisabled = disabled || session?.isProcessing
  const [input, setInput] = React.useState("")
  const [attachments, setAttachments] = React.useState<FileAttachment[]>([])
  const [isDraggingOver, setIsDraggingOver] = React.useState(false)
  const [loadingCount, setLoadingCount] = React.useState(0)
  const messagesEndRef = React.useRef<HTMLDivElement>(null)
  const prevSessionIdRef = React.useRef<string | null>(null)
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

  // Auto-scroll to bottom
  // - Instant scroll on session switch
  // - Smooth scroll on new messages in same session
  React.useEffect(() => {
    const isSessionSwitch = prevSessionIdRef.current !== session?.id
    prevSessionIdRef.current = session?.id ?? null

    messagesEndRef.current?.scrollIntoView({
      behavior: isSessionSwitch ? 'instant' : 'smooth'
    })
  }, [session?.id, session?.messages])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const hasContent = input.trim() || attachments.length > 0
    if (!hasContent || isInputDisabled) return
    onSendMessage(input.trim(), attachments.length > 0 ? attachments : undefined)
    setInput("")
    setAttachments([])
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
    // Escape to blur textarea
    if (e.key === 'Escape') {
      textareaRef.current?.blur()
    }
  }

  return (
    <div ref={zoneRef} className="flex h-full flex-col min-w-0" data-focus-zone="chat">
      {session ? (
        <div className="flex flex-1 flex-col min-h-0 min-w-0">
          {/* === MESSAGES AREA: Scrollable list of message bubbles === */}
          <ScrollArea className="flex-1 min-w-0 font-mono">
            <div className="px-5 py-4 space-y-4 min-w-0">
              {session.messages.length === 0 ? (
                /* Empty State: Welcome message for new sessions */
                <div className="flex flex-col items-center justify-center h-64 text-muted-foreground px-8">
                  <div className="size-14 rounded-xl bg-muted flex items-center justify-center mb-3">
                    {session.agentName ? (
                      <Bot className="size-7 text-muted-foreground/50" />
                    ) : (
                      <MessageSquare className="size-7 text-muted-foreground/50" />
                    )}
                  </div>
                  <p className="text-sm font-medium text-foreground">
                    {session.agentName ? `Chat with ${session.agentName}` : `Welcome to ${session.workspaceName}`}
                  </p>
                  <p className="text-xs mt-1 text-center">Start a conversation by typing a message below.</p>
                </div>
              ) : (
                /* Message List */
                session.messages.map(message => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    onOpenFile={onOpenFile}
                    onOpenUrl={onOpenUrl}
                  />
                ))
              )}
              {/* Scroll Anchor: For auto-scroll to bottom */}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          {/* Fade gradient - overlays bottom of scroll area */}
          <div className="h-8 -mt-8 bg-gradient-to-t from-background to-transparent pointer-events-none" />

          {/* Permission Banner - shows when agent needs approval for a command */}
          {pendingPermission && onRespondToPermission && (
            <PermissionBanner
              request={pendingPermission}
              onRespond={(allowed, alwaysAllow) =>
                onRespondToPermission(pendingPermission.sessionId, pendingPermission.requestId, allowed, alwaysAllow)
              }
            />
          )}

          {/* === INPUT CONTAINER: Textarea + Bottom row with controls === */}
          <div className="px-4 pb-4 font-mono">
            <form onSubmit={handleSubmit}>
              <div
                className={cn(
                  "rounded-xl border bg-background overflow-hidden transition-all",
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
                  className="w-full min-h-[100px] px-4 py-3 bg-transparent outline-none text-sm placeholder:text-muted-foreground resize-none focus-visible:ring-0"
                  placeholder={`Message ${session.workspaceName || 'Chat'}...`}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
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
                        <Sparkles className="h-3.5 w-3.5" />
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

                  {/* Spacer */}
                  <div className="flex-1" />

                  {/* Send Button */}
                  <Button
                    type="submit"
                    size="icon"
                    className="h-7 w-7 rounded-full shrink-0"
                    disabled={(!input.trim() && attachments.length === 0) || isInputDisabled}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </form>
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
 * - tool:      Left-aligned, bordered card with tool name header + result preview (max 500 chars)
 * - error:     Left-aligned, red border/bg, warning icon + error message
 * - status:    Centered pill badge with pulsing dot (e.g., "Thinking...")
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
}

/**
 * ErrorMessage - Separate component for error messages to allow useState hook
 */
function ErrorMessage({ message }: { message: Message }) {
  const hasDetails = (message.errorDetails && message.errorDetails.length > 0) || message.errorOriginal
  const [detailsOpen, setDetailsOpen] = React.useState(false)

  return (
    <div className="flex justify-start">
      <div className="max-w-[80%] bg-destructive/10 border border-destructive/20 rounded-lg pl-5 pr-4 py-2 break-words">
        {/* Error Header: Warning icon + title */}
        <div className="flex items-center gap-2 text-xs text-destructive mb-1 font-semibold">
          <AlertTriangle className="w-4 h-4" />
          <span>{message.errorTitle || 'Error'}</span>
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

function MessageBubble({ message, onOpenFile, onOpenUrl, renderMode = 'minimal' }: MessageBubbleProps) {
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
        <div className="max-w-[80%] bg-primary text-primary-foreground rounded-lg px-4 py-1 break-words min-w-0">
          <Markdown
            mode="minimal"
            onUrlClick={onOpenUrl}
            onFileClick={onOpenFile}
            className="text-sm [&_a]:text-primary-foreground [&_a]:underline [&_code]:bg-primary-foreground/20 [&_code]:text-primary-foreground"
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
      <div className="flex justify-start">
        <div className="max-w-[80%] bg-muted rounded-lg pl-6 pr-4 py-3 break-words min-w-0">
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
          {/* Streaming Cursor: Pulsing bar while response is being generated */}
          {message.isStreaming && (
            <span className="inline-block w-2 h-4 bg-primary ml-1 animate-pulse rounded-sm" />
          )}
        </div>
      </div>
    )
  }

  // === TOOL MESSAGE: Bordered card with header + result preview ===
  if (message.role === 'tool') {
    return (
      <div className="flex justify-start">
        <div className="max-w-[85%] border rounded-lg overflow-hidden">
          {/* Tool Header: Gear icon + tool name */}
          <div className="flex items-center gap-2 pl-4 pr-3 py-2 bg-muted/50 border-b">
            <div className="p-1 rounded bg-primary/10 text-primary">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <span className="text-xs font-semibold uppercase tracking-wide">{message.toolName}</span>
          </div>
          {/* Tool Result: Shows preview (max 500 chars) or "Running..." spinner */}
          <div className="pl-4 pr-3 py-2 min-w-0">
            {(() => {
              // Check both toolResult and content for backwards compat with old persisted sessions
              const result = message.toolResult || message.content
              if (result) {
                return (
                  <pre className="text-xs text-muted-foreground max-h-48 overflow-y-auto font-mono bg-muted/30 p-2 rounded whitespace-pre-wrap break-words">
                    {result.slice(0, 500)}
                    {result.length > 500 && '...'}
                  </pre>
                )
              }
              /* Running Indicator: Braille spinner + "Running..." text */
              return (
                <LoadingIndicator
                  label="Running..."
                  className="text-sm text-muted-foreground"
                />
              )
            })()}
          </div>
        </div>
      </div>
    )
  }

  // === ERROR MESSAGE: Red bordered bubble with warning icon and collapsible details ===
  if (message.role === 'error') {
    return <ErrorMessage message={message} />
  }

  // === STATUS MESSAGE: Left-aligned with braille spinner (TUI-style) ===
  if (message.role === 'status') {
    return (
      <div className="flex justify-start pl-1">
        <LoadingIndicator
          label={message.content}
          className="text-sm"
        />
      </div>
    )
  }

  // === WARNING MESSAGE: Amber bordered bubble with warning icon ===
  if (message.role === 'warning') {
    return (
      <div className="flex justify-start">
        <div className="max-w-[80%] bg-amber-500/10 border border-amber-500/20 rounded-lg pl-5 pr-4 py-2 break-words">
          {/* Warning Header: Triangle icon + "Warning" label */}
          <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-500 mb-1 font-semibold">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>Warning</span>
          </div>
          <p className="text-sm text-amber-700 dark:text-amber-400">{message.content}</p>
        </div>
      </div>
    )
  }

  return null
}
