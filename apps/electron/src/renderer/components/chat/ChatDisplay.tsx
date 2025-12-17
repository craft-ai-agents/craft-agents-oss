import * as React from "react"
import { useState, useEffect } from "react"
import {
  MessageSquare,
  Sparkles,
  ChevronDown,
  Paperclip,
  ArrowUp,
  Bot,
  MoreHorizontal,
  Pencil,
  Archive,
  Trash2,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { Markdown, type RenderMode } from "@/components/markdown"
import { AttachmentPreview, FileTypeIcon } from "./AttachmentPreview"
import { useFocusZone } from "@/hooks/keyboard"
import type { Session, Message, FileAttachment, StoredAttachment } from "../../../shared/types"
import { MODELS, getModelDisplayName } from "@config/models"

interface ChatDisplayProps {
  session: Session | null
  onSendMessage: (message: string, attachments?: FileAttachment[]) => void
  onOpenFile: (path: string) => void
  onOpenUrl: (url: string) => void
  // Model selection
  currentModel: string
  onModelChange: (model: string) => void
  // Session actions
  onRename?: (name: string) => void
  onArchive?: () => void
  onDelete?: () => void
  /** Ref for the textarea, used for external focus control */
  textareaRef?: React.RefObject<HTMLTextAreaElement>
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
  onRename,
  onArchive,
  onDelete,
  textareaRef: externalTextareaRef,
}: ChatDisplayProps) {
  const [input, setInput] = React.useState("")
  const [attachments, setAttachments] = React.useState<FileAttachment[]>([])
  const [isDraggingOver, setIsDraggingOver] = React.useState(false)
  const messagesEndRef = React.useRef<HTMLDivElement>(null)
  const prevSessionIdRef = React.useRef<string | null>(null)
  const internalTextareaRef = React.useRef<HTMLTextAreaElement>(null)
  const textareaRef = externalTextareaRef || internalTextareaRef
  const dragCounterRef = React.useRef(0)

  // Rename dialog state
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [renameName, setRenameName] = useState("")

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
    if (session?.isProcessing) {
      console.log('[ChatDisplay] Session is processing, ignoring click')
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

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current = 0
    setIsDraggingOver(false)
    if (session?.isProcessing) return

    const files = Array.from(e.dataTransfer.files)
    for (const file of files) {
      // In Electron, dropped files have a path property
      const filePath = (file as File & { path?: string }).path
      if (filePath) {
        try {
          const attachment = await window.electronAPI.readFileAttachment(filePath)
          if (attachment) {
            setAttachments(prev => [...prev, attachment])
          }
        } catch (error) {
          console.error('Failed to read dropped file:', error)
        }
      }
    }
  }

  // Clear attachments when session changes
  React.useEffect(() => {
    setAttachments([])
  }, [session?.id])

  const handleRenameClick = () => {
    setRenameName(session?.name || session?.agentName || session?.workspaceName || '')
    setRenameDialogOpen(true)
  }

  const handleRenameSubmit = () => {
    if (onRename && renameName.trim()) {
      onRename(renameName.trim())
    }
    setRenameDialogOpen(false)
    setRenameName("")
  }

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
    if (!hasContent || session?.isProcessing) return
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
          {/* === SESSION HEADER: Title + Agent Badge + Actions Menu === */}
          <div className="flex h-[50px] shrink-0 items-center px-4 relative z-50 gap-3">
            {session.agentName ? (
              <Bot className="h-4 w-4 text-muted-foreground" />
            ) : null}
            <div className="font-semibold font-sans text-sm">
              {session.name || session.agentName || session.workspaceName || 'Chat'}
            </div>
            {session.agentName && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Agent</Badge>
            )}

            {/* Spacer to push menu to the right */}
            <div className="flex-1" />

            {/* Session Actions Menu */}
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={(e) => {
                    e.preventDefault()
                    const rect = e.currentTarget.getBoundingClientRect()
                    const event = new MouseEvent('contextmenu', {
                      bubbles: true,
                      cancelable: true,
                      clientX: rect.right,
                      clientY: rect.bottom,
                    })
                    e.currentTarget.dispatchEvent(event)
                  }}
                >
                  <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                </Button>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-40">
                <ContextMenuItem onClick={handleRenameClick} shortcut="R">
                  <Pencil />
                  Rename
                </ContextMenuItem>
                <ContextMenuSeparator />
                {onArchive && (
                  <ContextMenuItem onClick={onArchive} shortcut="A">
                    <Archive />
                    Archive
                  </ContextMenuItem>
                )}
                {onDelete && (
                  <ContextMenuItem onClick={onDelete} variant="destructive" shortcut="D">
                    <Trash2 />
                    Delete
                  </ContextMenuItem>
                )}
              </ContextMenuContent>
            </ContextMenu>
          </div>
          <Separator />

          {/* === MESSAGES AREA: Scrollable list of message bubbles === */}
          <ScrollArea className="flex-1 min-w-0">
            <div className="p-4 space-y-4 min-w-0">
              {session.messages.length === 0 ? (
                /* Empty State: Welcome message for new sessions */
                <div className="flex flex-col items-center justify-center h-64 text-muted-foreground px-8">
                  <div className="size-14 rounded-xl bg-muted flex items-center justify-center mb-3">
                    <MessageSquare className="size-7 text-muted-foreground/50" />
                  </div>
                  <p className="text-sm font-medium text-foreground">Welcome to {session.workspaceName}</p>
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

          <Separator className="mt-auto" />

          {/* === INPUT CONTAINER: Textarea + Bottom row with controls === */}
          <div className="p-4">
            <form onSubmit={handleSubmit}>
              <div
                className={cn(
                  "rounded-xl border bg-background overflow-hidden transition-colors",
                  isDraggingOver && "border-primary border-2 bg-primary/5"
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
                  disabled={session.isProcessing}
                />

                {/* Textarea - 4 lines minimum height */}
                <textarea
                  ref={textareaRef}
                  className="w-full min-h-[100px] px-4 py-3 bg-transparent outline-none text-sm placeholder:text-muted-foreground resize-none focus-visible:ring-0"
                  placeholder={`Message ${session.workspaceName || 'Chat'}...`}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={session.isProcessing}
                  rows={4}
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
                    disabled={session.isProcessing}
                  >
                    <Paperclip className="h-4 w-4" />
                  </Button>

                  {/* Model Selector Dropdown */}
                  <ContextMenu>
                    <ContextMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 text-xs shrink-0"
                        onClick={(e) => {
                          e.preventDefault()
                          const rect = e.currentTarget.getBoundingClientRect()
                          const event = new MouseEvent('contextmenu', {
                            bubbles: true,
                            cancelable: true,
                            clientX: rect.left,
                            clientY: rect.bottom,
                          })
                          e.currentTarget.dispatchEvent(event)
                        }}
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        {getModelDisplayName(currentModel)}
                        <ChevronDown className="h-3 w-3 opacity-50" />
                      </Button>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      {MODELS.map((model) => (
                        <ContextMenuItem
                          key={model.id}
                          onClick={() => onModelChange(model.id)}
                          className={cn(currentModel === model.id && "bg-accent")}
                        >
                          {model.name}
                        </ContextMenuItem>
                      ))}
                    </ContextMenuContent>
                  </ContextMenu>

                  {/* Spacer */}
                  <div className="flex-1" />

                  {/* Send Button */}
                  <Button
                    type="submit"
                    size="icon"
                    className="h-7 w-7 rounded-full shrink-0"
                    disabled={(!input.trim() && attachments.length === 0) || session.isProcessing}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Rename Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Rename conversation</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              placeholder="Enter a name..."
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleRenameSubmit()
                }
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRenameSubmit}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

function MessageBubble({ message, onOpenFile, onOpenUrl, renderMode = 'minimal' }: MessageBubbleProps) {
  // Track which thumbnails failed to load (by attachment ID)
  const [thumbnailErrors, setThumbnailErrors] = useState<Record<string, boolean>>({})

  // === USER MESSAGE: Right-aligned blue bubble with attachments above ===
  if (message.role === 'user') {
    const hasAttachments = message.attachments && message.attachments.length > 0

    return (
      <div className="flex flex-col items-end gap-1">
        {/* Attachment preview row - stored attachments with thumbnails */}
        {hasAttachments && (
          <div className="flex gap-2 justify-end max-w-[80%] flex-wrap">
            {message.attachments!.map((att, i) => {
              const thumbnailFailed = att.id ? thumbnailErrors[att.id] : false
              const showThumbnail = att.thumbnailPath && !thumbnailFailed

              return (
                <div
                  key={att.id || i}
                  className="shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => att.storedPath && onOpenFile(att.storedPath)}
                  title={`Click to open ${att.name}`}
                >
                  {showThumbnail ? (
                    // Use OS-generated thumbnail from disk
                    <div className="h-14 w-14 rounded-lg overflow-hidden border bg-muted">
                      <img
                        src={`file://${att.thumbnailPath}`}
                        alt={att.name}
                        className="h-full w-full object-cover"
                        onError={() => {
                          if (att.id) {
                            setThumbnailErrors(prev => ({ ...prev, [att.id!]: true }))
                          }
                        }}
                      />
                    </div>
                  ) : (
                    // Fallback: icon + filename for files without thumbnails or failed loads
                    <div className="flex items-center gap-2 rounded-lg border bg-primary/10 px-3 py-2">
                      <FileTypeIcon type={att.type} mimeType={att.mimeType} />
                      <span className="text-xs truncate max-w-[100px] text-muted-foreground">{att.name}</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {/* Text content bubble */}
        <div className="max-w-[80%] bg-primary text-primary-foreground rounded-lg pl-5 pr-4 py-2 break-words min-w-0">
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
        <div className="max-w-[80%] bg-muted rounded-lg pl-5 pr-4 py-2 break-words min-w-0">
          <Markdown
            mode={renderMode}
            onUrlClick={onOpenUrl}
            onFileClick={onOpenFile}
            id={message.id}
            className="text-sm"
          >
            {message.content}
          </Markdown>
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
              /* Running Indicator: Pulsing dot + "Running..." text */
              return (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span className="flex h-2 w-2 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                  </span>
                  <span className="text-xs">Running...</span>
                </div>
              )
            })()}
          </div>
        </div>
      </div>
    )
  }

  // === ERROR MESSAGE: Red bordered bubble with warning icon ===
  if (message.role === 'error') {
    return (
      <div className="flex justify-start">
        <div className="max-w-[80%] bg-destructive/10 border border-destructive/20 rounded-lg pl-5 pr-4 py-2 break-words">
          {/* Error Header: Warning icon + "Error" label */}
          <div className="flex items-center gap-2 text-xs text-destructive mb-1 font-semibold">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>Error</span>
          </div>
          <p className="text-sm text-destructive">{message.content}</p>
        </div>
      </div>
    )
  }

  // === STATUS MESSAGE: Centered pill badge with pulsing dot ===
  if (message.role === 'status') {
    return (
      <div className="flex justify-center my-2">
        <div className="px-3 py-1 rounded-full bg-muted border text-xs font-medium text-muted-foreground flex items-center gap-2">
          {/* Pulsing Status Indicator */}
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></div>
          {message.content}
        </div>
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
