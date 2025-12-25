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
  ListTodo,
  ShieldOff,
  X,
} from "lucide-react"
import { motion, AnimatePresence } from "motion/react"

import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { Markdown, CollapsibleMarkdownProvider, StreamingMarkdown, type RenderMode } from "@/components/markdown"
import { AnimatedCollapsibleContent } from "@/components/ui/collapsible"
import { FileTypeIcon, getFileTypeLabel } from "./AttachmentPreview"
import { Spinner } from "@/components/ui/loading-indicator"
import { useFocusZone } from "@/hooks/keyboard"
import type { Session, Message, FileAttachment, StoredAttachment, PermissionRequest, ConnectionConfig } from "../../../shared/types"
import { SetupAuthBanner, type BannerState } from "./SetupAuthBanner"
import { TurnCard } from "./TurnCard"
import { PlanCard } from "./PlanCard"
import { groupMessagesByTurn, formatTurnAsMarkdown, formatActivityAsMarkdown, type Turn, type AssistantTurn, type UserTurn, type SystemTurn, type PlanTurn } from "./turn-utils"
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
  /** Enable safe mode for read-only exploration */
  safeModeEnabled?: boolean
  onSafeModeChange?: (enabled: boolean) => void
  // Input value preservation (controlled from parent)
  /** Current input value - preserved across mode switches and conversation changes */
  inputValue?: string
  /** Callback when input value changes */
  onInputChange?: (value: string) => void
  // Connection selection
  /** Available connections (enabled only) */
  connections?: ConnectionConfig[]
  /** Callback when connection selection changes */
  onConnectionsChange?: (ids: string[]) => void
  // Working directory (per session)
  /** Current working directory for this session */
  workingDirectory?: string
  /** Callback when working directory changes */
  onWorkingDirectoryChange?: (path: string) => void
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
      {/* Label with crossfade animation on content change only */}
      <span className="relative h-5 flex items-center">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={currentMessage}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: 'easeInOut' }}
          >
            {currentMessage}
          </motion.span>
        </AnimatePresence>
        {elapsed >= 1 && (
          <span className="text-muted-foreground/60 ml-1">
            {formatElapsed(elapsed)}
          </span>
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
  safeModeEnabled = false,
  onSafeModeChange,
  // Input value preservation
  inputValue,
  onInputChange,
  // Connections
  connections,
  onConnectionsChange,
  // Working directory
  workingDirectory,
  onWorkingDirectoryChange,
}: ChatDisplayProps) {
  // Input is only disabled when explicitly disabled (e.g., agent needs activation)
  // User can type during streaming - submitting will stop the stream and send
  const isInputDisabled = disabled
  const messagesEndRef = React.useRef<HTMLDivElement>(null)
  const scrollViewportRef = React.useRef<HTMLDivElement>(null)
  const prevSessionIdRef = React.useRef<string | null>(null)
  // Sticky-bottom: When true, auto-scroll on content changes. Toggled by user scroll behavior.
  const isStickToBottomRef = React.useRef(true)
  const internalTextareaRef = React.useRef<HTMLTextAreaElement>(null)
  const textareaRef = externalTextareaRef || internalTextareaRef

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

  // Pop-out handler - opens message in a new preview window (read-only)
  const handlePopOut = React.useCallback((message: Message) => {
    if (!session) return
    window.electronAPI.openMarkdownPreview(`${session.id}:${message.id}`, {
      mode: 'readOnly',
      content: message.content,
      title: 'Message Preview',
    })
  }, [session])

  // Track scroll position to toggle sticky-bottom behavior
  // - User scrolls up → unstick (stop auto-scrolling)
  // - User scrolls back to bottom → re-stick (resume auto-scrolling)
  const handleScroll = React.useCallback(() => {
    const viewport = scrollViewportRef.current
    if (!viewport) return
    const { scrollTop, scrollHeight, clientHeight } = viewport
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight
    // 20px threshold for "at bottom" detection
    isStickToBottomRef.current = distanceFromBottom < 20
  }, [])

  // Set up scroll event listener
  React.useEffect(() => {
    const viewport = scrollViewportRef.current
    if (!viewport) return
    viewport.addEventListener('scroll', handleScroll)
    return () => viewport.removeEventListener('scroll', handleScroll)
  }, [handleScroll])

  // Auto-scroll using ResizeObserver - fires AFTER layout is complete
  // Debounced to wait for layout to settle before scrolling
  React.useEffect(() => {
    const viewport = scrollViewportRef.current
    if (!viewport) return

    const isSessionSwitch = prevSessionIdRef.current !== session?.id
    prevSessionIdRef.current = session?.id ?? null

    // On session switch: scroll immediately and re-stick to bottom
    if (isSessionSwitch) {
      isStickToBottomRef.current = true
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' })
    }

    // Debounced scroll - waits for layout to settle
    let debounceTimer: ReturnType<typeof setTimeout> | null = null

    const resizeObserver = new ResizeObserver(() => {
      if (!isStickToBottomRef.current) return

      // Clear pending scroll and wait for layout to settle
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      }, 200)
    })

    // Observe the scroll content container (first child of viewport)
    const content = viewport.firstElementChild
    if (content) {
      resizeObserver.observe(content)
    }

    return () => {
      resizeObserver.disconnect()
      if (debounceTimer) clearTimeout(debounceTimer)
    }
  }, [session?.id])

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

    // Force stick-to-bottom when user sends a message
    isStickToBottomRef.current = true
    onSendMessage(message, attachments)

    // Immediately scroll to bottom after sending - use requestAnimationFrame
    // to ensure the DOM has updated with the new message
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    })
  }

  // Handle stop request from InputContainer
  const handleStop = () => {
    if (!session?.isProcessing) return
    window.electronAPI.cancelProcessing(session.id).catch(error => {
      console.error('[ChatDisplay] Failed to cancel processing:', error)
    })
  }

  // Handle structured input responses (permissions)
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
  }

  // Build structured input state from pending requests
  const structuredInput: StructuredInputState | undefined = React.useMemo(() => {
    if (pendingPermission) {
      return { type: 'permission', data: pendingPermission }
    }
    return undefined
  }, [pendingPermission])

  // Memoize turn grouping - avoids O(n) iteration on every render/keystroke
  const turns = React.useMemo(() => {
    if (!session) return []
    return groupMessagesByTurn(session.messages)
  }, [session?.messages])

  return (
    <div ref={zoneRef} className="flex h-full flex-col min-w-0" data-focus-zone="chat">
      {session ? (
        <div className="flex flex-1 flex-col min-h-0 min-w-0">
          {/* === MESSAGES AREA: Scrollable list of message bubbles === */}
          <div className="relative flex-1 min-h-0">
            {/* Top fade gradient - absolutely positioned overlay */}
            <div className="absolute top-0 left-0 right-2 h-8 z-10 bg-gradient-to-b from-background to-transparent pointer-events-none" />
            <ScrollArea className="h-full min-w-0" viewportRef={scrollViewportRef}>
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
                  return turns.map((turn, index) => {
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

                    // Plan turns - render with PlanCard for inline plan review
                    if (turn.type === 'plan') {
                      // Check if any subsequent turn is a user message (hide footer if so)
                      const hasUserResponse = turns.slice(index + 1).some(t => t.type === 'user')
                      return (
                        <PlanCard
                          key={`plan-${turn.message.id}`}
                          message={turn.message}
                          onOpenFile={onOpenFile}
                          onOpenUrl={onOpenUrl}
                          hasUserResponse={hasUserResponse}
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
                        todos={turn.todos}
                        onOpenFile={onOpenFile}
                        onOpenUrl={onOpenUrl}
                        onPopOut={(text) => {
                          if (session) {
                            window.electronAPI.openMarkdownPreview(`${session.id}:${turn.turnId}`, {
                              mode: 'readOnly',
                              content: text,
                              title: 'Response Preview',
                            })
                          }
                        }}
                        onOpenDetails={() => {
                          if (session) {
                            const markdown = formatTurnAsMarkdown(turn)
                            window.electronAPI.openMarkdownPreview(`${session.id}:details-${turn.turnId}`, {
                              mode: 'readOnly',
                              content: markdown,
                              title: 'Turn Details',
                            })
                          }
                        }}
                        onOpenActivityDetails={(activity) => {
                          if (session) {
                            const input = activity.toolInput as Record<string, unknown> | undefined

                            // Edit tool → Diff preview (Monaco DiffEditor)
                            if (activity.toolName === 'Edit' && input) {
                              const filePath = (input.file_path as string) || 'unknown'
                              const oldString = (input.old_string as string) || ''
                              const newString = (input.new_string as string) || ''
                              window.electronAPI.openDiffPreview(session.id, `diff-${activity.id}`, {
                                filePath,
                                original: oldString,
                                modified: newString,
                              })
                            }
                            // Read tool → Code preview (read mode)
                            else if (activity.toolName === 'Read' && input) {
                              // Always use input.file_path as the absolute path for opening files
                              const filePath = (input.file_path as string) || 'unknown'
                              let content = activity.content || ''
                              let numLines: number | undefined
                              let startLine: number | undefined
                              let totalLines: number | undefined

                              // Try to parse JSON structure from Read tool result for metadata
                              try {
                                const parsed = JSON.parse(content)
                                if (parsed.file) {
                                  // Use content and metadata from JSON, but keep absolute filePath from input
                                  content = parsed.file.content || ''
                                  numLines = parsed.file.numLines
                                  startLine = parsed.file.startLine
                                  totalLines = parsed.file.totalLines
                                }
                              } catch {
                                // Not JSON, use as plain text
                              }

                              window.electronAPI.openCodePreview(session.id, `code-${activity.id}`, {
                                filePath,
                                content,
                                mode: 'read',
                                numLines,
                                startLine,
                                totalLines,
                              })
                            }
                            // Write tool → Code preview (write mode)
                            else if (activity.toolName === 'Write' && input) {
                              const filePath = (input.file_path as string) || 'unknown'
                              const content = (input.content as string) || ''
                              window.electronAPI.openCodePreview(session.id, `code-${activity.id}`, {
                                filePath,
                                content,
                                mode: 'write',
                              })
                            }
                            // Bash tool → Terminal preview
                            else if (activity.toolName === 'Bash' && input) {
                              const command = (input.command as string) || ''
                              const description = (input.description as string) || undefined
                              // Parse exit code and output from JSON result
                              let exitCode: number | undefined
                              let output = activity.content || ''

                              // Try to parse JSON structure from Bash tool result
                              try {
                                const parsed = JSON.parse(output)
                                if (parsed.stdout !== undefined || parsed.stderr !== undefined) {
                                  // Combine stdout and stderr, preserving formatting
                                  const stdout = parsed.stdout || ''
                                  const stderr = parsed.stderr || ''
                                  output = stdout + (stderr ? `\n${stderr}` : '')
                                  // exitCode might not be in the result, check interrupted flag
                                  if (parsed.interrupted) {
                                    exitCode = 130 // Standard SIGINT exit code
                                  }
                                }
                              } catch {
                                // Not JSON, parse exit code from text if present
                                const exitMatch = output.match(/Exit code: (\d+)/)
                                if (exitMatch) {
                                  exitCode = parseInt(exitMatch[1], 10)
                                }
                              }

                              window.electronAPI.openTerminalPreview(session.id, `terminal-${activity.id}`, {
                                command,
                                output,
                                description,
                                exitCode,
                                toolType: 'bash',
                              })
                            }
                            // Grep tool → Terminal preview (search results)
                            else if (activity.toolName === 'Grep' && input) {
                              const pattern = (input.pattern as string) || ''
                              const searchPath = (input.path as string) || '.'
                              const outputMode = (input.output_mode as string) || 'files_with_matches'
                              const rawOutput = activity.content || ''

                              // Try to parse JSON structure from Grep tool result
                              let output = rawOutput
                              let description = `Search for "${pattern}"`
                              try {
                                const parsed = JSON.parse(rawOutput)
                                if (parsed.content !== undefined) {
                                  output = parsed.content || ''
                                  // Add file count info if available
                                  if (parsed.numFiles !== undefined) {
                                    description = `Search for "${pattern}" (${parsed.numFiles} files, ${parsed.numLines || 0} lines)`
                                  }
                                } else if (parsed.filenames) {
                                  // files_with_matches mode returns filenames array
                                  output = parsed.filenames.join('\n')
                                  description = `Search for "${pattern}" (${parsed.filenames.length} files)`
                                }
                              } catch {
                                // Not JSON, use as plain text
                              }

                              const command = `grep "${pattern}" ${searchPath} --${outputMode}`

                              window.electronAPI.openTerminalPreview(session.id, `terminal-${activity.id}`, {
                                command,
                                output,
                                description,
                                toolType: 'grep',
                              })
                            }
                            // Glob tool → Terminal preview (file list)
                            else if (activity.toolName === 'Glob' && input) {
                              const pattern = (input.pattern as string) || '*'
                              const searchPath = (input.path as string) || '.'
                              const rawOutput = activity.content || ''

                              // Try to parse JSON structure from Glob tool result
                              let output = rawOutput
                              let description = `Find files matching "${pattern}"`
                              try {
                                const parsed = JSON.parse(rawOutput)
                                if (parsed.filenames && Array.isArray(parsed.filenames)) {
                                  // Standard Glob result format: { filenames: [...], numFiles, durationMs, truncated }
                                  output = parsed.filenames.join('\n')
                                  const truncatedNote = parsed.truncated ? ' (truncated)' : ''
                                  description = `Find files matching "${pattern}" (${parsed.numFiles || parsed.filenames.length} files${truncatedNote})`
                                } else if (Array.isArray(parsed)) {
                                  // Simple array format
                                  output = parsed.join('\n')
                                  description = `Find files matching "${pattern}" (${parsed.length} matches)`
                                }
                              } catch {
                                // Not JSON, use as plain text
                              }

                              const command = `glob "${pattern}" in ${searchPath}`

                              window.electronAPI.openTerminalPreview(session.id, `terminal-${activity.id}`, {
                                command,
                                output,
                                description,
                                toolType: 'glob',
                              })
                            }
                            // Default → Markdown preview
                            else {
                              const markdown = formatActivityAsMarkdown(activity)
                              window.electronAPI.openMarkdownPreview(`${session.id}:activity-${activity.id}`, {
                                mode: 'readOnly',
                                content: markdown,
                                title: 'Activity Details',
                              })
                            }
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
            {/* Bottom fade gradient - absolutely positioned overlay */}
            <div className="absolute bottom-0 left-0 right-2 h-8 z-10 bg-gradient-to-t from-background to-transparent pointer-events-none" />
          </div>

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
              <>
                {/* Active option badges - positioned above input */}
                {(ultrathinkEnabled || safeModeEnabled || skipPermissions) && (
                  <div className="flex justify-start gap-2 mb-2">
                    {ultrathinkEnabled && (
                      <button
                        type="button"
                        onClick={() => onUltrathinkChange?.(false)}
                        className="h-[30px] pl-2.5 pr-2 text-xs font-medium rounded-[8px] flex items-center gap-1.5 transition-all bg-gradient-to-r from-blue-600/10 via-purple-600/10 to-pink-600/10 hover:from-blue-600/15 hover:via-purple-600/15 hover:to-pink-600/15 shadow-tinted"
                        style={{ '--shadow-color': '147, 51, 234' } as React.CSSProperties}
                      >
                        <span className="bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">Ultrathink</span>
                        <X className="h-3 w-3 text-purple-500 opacity-60 hover:opacity-100 translate-y-px" />
                      </button>
                    )}
                    {safeModeEnabled && (
                      <button
                        type="button"
                        onClick={() => onSafeModeChange?.(false)}
                        className="h-[30px] pl-2.5 pr-2 text-xs font-medium rounded-[8px] flex items-center gap-1.5 transition-all bg-emerald-500/5 text-emerald-700 hover:bg-emerald-500/10 shadow-tinted"
                        style={{ '--shadow-color': '6, 95, 70' } as React.CSSProperties}
                      >
                        <ListTodo className="h-3.5 w-3.5" />
                        <span>Safe Mode</span>
                        <X className="h-3.5 w-3.5 opacity-60 hover:opacity-100" />
                      </button>
                    )}
                    {skipPermissions && (
                      <button
                        type="button"
                        onClick={() => onSkipPermissionsChange?.(false)}
                        className="h-[30px] pl-2.5 pr-2 text-xs font-medium rounded-[8px] flex items-center gap-1.5 transition-all bg-amber-500/5 text-amber-700 hover:bg-amber-500/10 shadow-tinted"
                        style={{ '--shadow-color': '146, 64, 14' } as React.CSSProperties}
                      >
                        <ShieldOff className="h-3.5 w-3.5" />
                        <span>Skipping Permissions</span>
                        <X className="h-3.5 w-3.5 opacity-60 hover:opacity-100" />
                      </button>
                    )}
                  </div>
                )}
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
                safeModeEnabled={safeModeEnabled}
                onSafeModeChange={onSafeModeChange}
                structuredInput={structuredInput}
                onStructuredResponse={handleStructuredResponse}
                inputValue={inputValue}
                onInputChange={onInputChange}
                connections={connections}
                selectedConnectionIds={session.selectedConnectionIds}
                onConnectionsChange={onConnectionsChange}
                workingDirectory={workingDirectory}
                onWorkingDirectoryChange={onWorkingDirectoryChange}
              />
              </>
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
      <div className="flex flex-col items-end gap-3">
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
                    <div className="h-14 w-14 rounded-[8px] overflow-hidden bg-white shadow-minimal">
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
                      <div className="h-11 w-8 rounded-[6px] overflow-hidden bg-white shadow-minimal flex items-center justify-center shrink-0">
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
        <div className="max-w-[80%] bg-foreground/5 rounded-[16px] px-4 py-1 break-words min-w-0 select-text">
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
        <div className="relative max-w-[90%] bg-white shadow-minimal rounded-[8px] pl-6 pr-4 py-3 break-words min-w-0 select-text">
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
