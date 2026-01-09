import * as React from 'react'
import { useMemo, useEffect, useRef, useCallback, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  ChevronRight,
  CheckCircle2,
  XCircle,
  Circle,
  MessageCircleDashed,
  ExternalLink,
  ArrowUpRight,
  Ban,
  Copy,
  Check,
  X,
  Maximize2,
  CircleCheck,
  ListTodo,
} from 'lucide-react'
import * as ReactDOM from 'react-dom'
import { cn } from '../../lib/utils'
import { Markdown } from '../markdown'
import { Spinner } from '../ui/LoadingIndicator'
import { TurnCardActionsMenu } from './TurnCardActionsMenu'
import { computeLastChildSet, groupActivitiesByParent, isActivityGroup, formatDuration, formatTokens, type ActivityGroup } from './turn-utils'
import { FullscreenOverlay } from './fullscreen'

// ============================================================================
// Utilities
// ============================================================================

/**
 * Simple markdown stripping for preview text.
 * Removes common markdown syntax to show plain text preview.
 */
function stripMarkdown(text: string): string {
  return text
    // Remove code blocks
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, '')
    // Remove headers
    .replace(/^#{1,6}\s+/gm, '')
    // Remove bold/italic
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    // Remove links
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove images
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    // Remove blockquotes
    .replace(/^>\s+/gm, '')
    // Remove horizontal rules
    .replace(/^---+$/gm, '')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim()
}

// ============================================================================
// Size Configuration
// ============================================================================

/**
 * Global size configuration for TurnCard components.
 * Adjust these values to scale the entire component uniformly.
 */
const SIZE_CONFIG = {
  /** Base font size class for all text */
  fontSize: 'text-[13px]',
  /** Icon size class (width and height) */
  iconSize: 'w-3 h-3',
  /** Spinner text size class */
  spinnerSize: 'text-[10px]',
  /** Small spinner for header */
  spinnerSizeSmall: 'text-[8px]',
  /** Activity row height in pixels (approx for calculation) */
  activityRowHeight: 24,
  /** Max visible activities before scrolling (show ~14 items) */
  maxVisibleActivities: 14,
  /** Number of items before which we apply staggered animation */
  staggeredAnimationLimit: 10,
} as const

// ============================================================================
// Types
// ============================================================================

export type ActivityStatus = 'pending' | 'running' | 'completed' | 'error' | 'backgrounded'
export type ActivityType = 'tool' | 'thinking' | 'intermediate' | 'status'

// ============================================================================
// Todo Types (for TodoWrite tool visualization)
// ============================================================================

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'interrupted'

export interface TodoItem {
  /** Task content/description */
  content: string
  /** Current status */
  status: TodoStatus
  /** Present continuous form shown when in_progress (e.g., "Running tests") */
  activeForm?: string
}

export interface ActivityItem {
  id: string
  type: ActivityType
  status: ActivityStatus
  toolName?: string
  toolUseId?: string  // For matching parent-child relationships
  toolInput?: Record<string, unknown>
  content?: string
  intent?: string
  displayName?: string  // LLM-generated human-friendly tool name (for MCP tools)
  timestamp: number
  error?: string
  // Parent-child nesting for Task subagents
  parentId?: string  // Parent activity's toolUseId
  depth?: number     // Nesting level (0 = root, 1 = child, etc.)
  // Status activities (e.g., compacting)
  statusType?: string  // e.g., 'compacting'
  // Background task fields
  taskId?: string         // For background Task tools
  shellId?: string        // For background Bash shells
  elapsedSeconds?: number // Live progress updates
  isBackground?: boolean  // Flag for UI differentiation
}

export interface ResponseContent {
  text: string
  isStreaming: boolean
  streamStartTime?: number
  /** Whether this response is a plan (renders with plan variant) */
  isPlan?: boolean
}

export interface TurnCardProps {
  /** Session ID for state persistence (optional in shared context) */
  sessionId?: string
  /** Turn ID for state persistence */
  turnId: string
  /** All activities in this turn (tools, thinking, intermediate text) */
  activities: ActivityItem[]
  /** Final response content (may be streaming) */
  response?: ResponseContent
  /** Primary intent/goal for this turn (shown in collapsed preview) */
  intent?: string
  /** Whether content is still being received */
  isStreaming: boolean
  /** Whether this turn is fully complete */
  isComplete: boolean
  /** Start in expanded state */
  defaultExpanded?: boolean
  /** Controlled expansion state (overrides internal state) */
  isExpanded?: boolean
  /** Callback when expansion state changes */
  onExpandedChange?: (expanded: boolean) => void
  /** Controlled expansion state for activity groups */
  expandedActivityGroups?: Set<string>
  /** Callback when activity group expansion changes */
  onExpandedActivityGroupsChange?: (groups: Set<string>) => void
  /** Callback when file path is clicked */
  onOpenFile?: (path: string) => void
  /** Callback when URL is clicked */
  onOpenUrl?: (url: string) => void
  /** Callback to open response in Monaco editor */
  onPopOut?: (text: string) => void
  /** Callback to open turn details in a new window */
  onOpenDetails?: () => void
  /** Callback to open individual activity details in Monaco */
  onOpenActivityDetails?: (activity: ActivityItem) => void
  /** Callback to open all edits/writes in multi-file diff view */
  onOpenMultiFileDiff?: () => void
  /** Whether this turn has any Edit or Write activities */
  hasEditOrWriteActivities?: boolean
  /** TodoWrite tool state - shown at bottom of turn */
  todos?: TodoItem[]
  /** Optional render prop for actions menu (Electron provides dropdown) */
  renderActionsMenu?: () => React.ReactNode
  /** Callback when user accepts the plan (plan responses only) */
  onAcceptPlan?: () => void
  /** Whether a user message has been sent after this turn (hides plan approve footer) */
  hasUserResponse?: boolean
  /** Callback when user sends feedback via fullscreen commenting */
  onSendFeedback?: (feedback: string) => void
}

// ============================================================================
// Buffering Constants & Utilities
// ============================================================================

/**
 * Aggressive buffering configuration.
 * Waits until content is suspected to be meaningful "commentary" before showing.
 */
const BUFFER_CONFIG = {
  MIN_WORDS_STANDARD: 40,      // Base threshold for showing content
  MIN_WORDS_CODE: 15,          // Code blocks show faster
  MIN_WORDS_LIST: 20,          // Lists show faster
  MIN_WORDS_QUESTION: 8,       // Questions from AI show faster
  MIN_WORDS_HEADER: 12,        // Headers indicate structure
  MIN_BUFFER_MS: 500,          // Always wait at least 500ms
  MAX_BUFFER_MS: 2500,         // Never buffer longer than 2.5s
  TIMEOUT_MIN_WORDS: 5,        // Show on timeout if at least this many words
  HIGH_WORD_COUNT: 60,         // Show regardless of structure at this count
  CONTENT_THROTTLE_MS: 300,    // Throttle content updates during streaming (perf optimization)
} as const

type BufferReason =
  | 'complete'
  | 'min_time'
  | 'timeout'
  | 'code_block'
  | 'list'
  | 'header'
  | 'question'
  | 'threshold_met'
  | 'high_word_count'
  | 'buffering'

/** Count words in text */
function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length
}

/** Detect code blocks (fenced) */
function hasCodeBlock(text: string): boolean {
  return /```/.test(text)
}

/** Detect markdown lists (bullet or numbered) */
function hasList(text: string): boolean {
  return /^\s*[-*•]\s/m.test(text) || /^\s*\d+\.\s/m.test(text)
}

/** Detect markdown headers */
function hasHeader(text: string): boolean {
  return /^#{1,4}\s/m.test(text)
}

/** Detect structural content (sentences, paragraphs, etc) */
function hasStructure(text: string): boolean {
  // Sentence ending (period, exclamation, question mark, colon)
  if (/[.!?:]\s*$/.test(text.trimEnd())) return true
  // Paragraph breaks
  if (/\n\s*\n/.test(text)) return true
  // Headers anywhere
  if (/\n\s*#{1,4}\s/.test(text)) return true
  // Code blocks
  if (hasCodeBlock(text)) return true
  return false
}

/** Detect if text ends with a question (AI asking for clarification) */
function isQuestion(text: string): boolean {
  return /\?\s*$/.test(text.trim())
}

/**
 * Determine if buffered content should be shown.
 * This is the core buffering decision function.
 *
 * @param text - The accumulated response text
 * @param isStreaming - Whether the response is still streaming
 * @param streamStartTime - When streaming started (for timeout calculation)
 * @returns Decision with reason for debugging
 */
function shouldShowContent(
  text: string,
  isStreaming: boolean,
  streamStartTime?: number
): { shouldShow: boolean; reason: BufferReason; wordCount: number } {
  const wordCount = countWords(text)

  // Always show complete content immediately
  if (!isStreaming) {
    return { shouldShow: true, reason: 'complete', wordCount }
  }

  const elapsed = streamStartTime ? Date.now() - streamStartTime : 0

  // Minimum buffer time - always wait at least 500ms
  if (elapsed < BUFFER_CONFIG.MIN_BUFFER_MS) {
    return { shouldShow: false, reason: 'min_time', wordCount }
  }

  // Maximum buffer time - force show after 2.5s if we have some content
  if (elapsed > BUFFER_CONFIG.MAX_BUFFER_MS && wordCount >= BUFFER_CONFIG.TIMEOUT_MIN_WORDS) {
    return { shouldShow: true, reason: 'timeout', wordCount }
  }

  // High-confidence patterns get expedited treatment

  // Code blocks - developers want to see code early
  if (hasCodeBlock(text) && wordCount >= BUFFER_CONFIG.MIN_WORDS_CODE) {
    return { shouldShow: true, reason: 'code_block', wordCount }
  }

  // Headers indicate structured content
  if (hasHeader(text) && wordCount >= BUFFER_CONFIG.MIN_WORDS_HEADER) {
    return { shouldShow: true, reason: 'header', wordCount }
  }

  // Lists indicate structured content
  if (hasList(text) && wordCount >= BUFFER_CONFIG.MIN_WORDS_LIST) {
    return { shouldShow: true, reason: 'list', wordCount }
  }

  // Questions from AI (clarification) - show quickly
  if (isQuestion(text) && wordCount >= BUFFER_CONFIG.MIN_WORDS_QUESTION) {
    return { shouldShow: true, reason: 'question', wordCount }
  }

  // Standard threshold - 40 words with some structure
  if (wordCount >= BUFFER_CONFIG.MIN_WORDS_STANDARD && hasStructure(text)) {
    return { shouldShow: true, reason: 'threshold_met', wordCount }
  }

  // High word count - show regardless of structure
  if (wordCount >= BUFFER_CONFIG.HIGH_WORD_COUNT) {
    return { shouldShow: true, reason: 'high_word_count', wordCount }
  }

  return { shouldShow: false, reason: 'buffering', wordCount }
}

/**
 * Check if a response is currently in buffering state
 * Used by TurnCard to show subtle indicator instead of big card
 */
function isResponseBuffering(response: ResponseContent | undefined): boolean {
  if (!response) return false
  if (!response.isStreaming) return false
  const decision = shouldShowContent(response.text, response.isStreaming, response.streamStartTime)
  return !decision.shouldShow
}

// ============================================================================
// Helper Functions
// ============================================================================

/** Get display name for a tool (strip MCP prefixes, apply friendly names) */
function getToolDisplayName(name: string): string {
  const stripped = name.replace(/^mcp__[^_]+__/, '')

  // Friendly display names for specific tools
  const displayNames: Record<string, string> = {
    'TodoWrite': 'Todo List Updated',
  }

  return displayNames[stripped] || stripped
}

/** Format tool input as a concise summary - CSS truncate handles overflow */
function formatToolInput(input?: Record<string, unknown>): string {
  if (!input || Object.keys(input).length === 0) return ''
  const parts: string[] = []
  for (const [key, value] of Object.entries(input)) {
    // Skip meta fields and description (shown separately)
    if (key === '_intent' || key === 'description' || value === undefined || value === null) continue
    const valStr = typeof value === 'string'
      ? value.replace(/\s+/g, ' ').trim()
      : JSON.stringify(value)
    parts.push(valStr)
    if (parts.length >= 2) break // Max 2 values
  }
  return parts.join(' ')
}

/** Get the primary preview text for collapsed state */
function getPreviewText(
  activities: ActivityItem[],
  intent?: string,
  isStreaming?: boolean,
  hasResponse?: boolean,
  isComplete?: boolean
): string {
  // If we have an explicit intent, use it
  if (intent) return intent

  // Find the most relevant activity intent
  const activityWithIntent = activities.find(a => a.intent)
  if (activityWithIntent?.intent) return activityWithIntent.intent

  // Check if we're in responding state
  if (isStreaming && hasResponse) return 'Responding...'

  // Find running Task tools and show their description
  const runningTask = activities.find(a => a.toolName === 'Task' && a.status === 'running')
  if (runningTask?.toolInput?.description) {
    return runningTask.toolInput.description as string
  }

  // While still streaming, show the latest intermediate message content
  // This gives visibility into what the LLM is "thinking"
  if (isStreaming && !isComplete) {
    const latestIntermediate = [...activities]
      .reverse()
      .find(a => a.type === 'intermediate' && a.content)
    if (latestIntermediate?.content) {
      return latestIntermediate.content
    }
  }

  // Get running and completed tools (not intermediate messages)
  const runningTools = activities.filter(a => a.status === 'running' && a.toolName)
  const errorCount = activities.filter(a => a.status === 'error').length

  // Show running tool names
  if (runningTools.length > 0) {
    const toolNames = runningTools
      .map(a => getToolDisplayName(a.toolName!))
      .slice(0, 3) // Max 3 names
    return `${toolNames.join(', ')}...`
  }

  // When complete, show first Task's description if available
  const firstTask = activities.find(a => a.toolName === 'Task')
  if (firstTask?.toolInput?.description) {
    const errorSuffix = errorCount > 0
      ? ` · ${errorCount} error${errorCount > 1 ? 's' : ''}`
      : ''
    return `${firstTask.toolInput.description as string}${errorSuffix}`
  }

  // When complete, show summary (badge already shows count)
  if (isComplete || (!isStreaming && activities.length > 0)) {
    const errorSuffix = errorCount > 0
      ? ` · ${errorCount} error${errorCount > 1 ? 's' : ''}`
      : ''
    return `Steps Completed${errorSuffix}`
  }

  return 'Starting...'
}


// ============================================================================
// Sub-Components
// ============================================================================

/** Status icon for an activity */
function ActivityStatusIcon({ status }: { status: ActivityStatus }) {
  switch (status) {
    case 'pending':
      return <Circle className={cn(SIZE_CONFIG.iconSize, "shrink-0 text-muted-foreground/50")} />
    case 'running':
      return (
        <div className={cn(SIZE_CONFIG.iconSize, "flex items-center justify-center shrink-0")}>
          <Spinner className={SIZE_CONFIG.spinnerSize} />
        </div>
      )
    case 'backgrounded':
      return (
        <div className={cn(SIZE_CONFIG.iconSize, "flex items-center justify-center shrink-0")}>
          <Spinner className={cn(SIZE_CONFIG.spinnerSize, "text-accent")} />
        </div>
      )
    case 'completed':
      return <CheckCircle2 className={cn(SIZE_CONFIG.iconSize, "shrink-0 text-success")} />
    case 'error':
      return <XCircle className={cn(SIZE_CONFIG.iconSize, "shrink-0 text-destructive")} />
  }
}

interface ActivityRowProps {
  activity: ActivityItem
  /** Callback to open activity details in Monaco */
  onOpenDetails?: () => void
  /** Whether this is the last child at its depth level (for └ corner in tree view) */
  isLastChild?: boolean
}

/**
 * TreeViewConnector is no longer used - the vertical line from the expanded section
 * already provides visual hierarchy. Keeping this as a no-op for now in case
 * we need depth indentation in the future.
 */
function TreeViewConnector({ depth }: { depth: number; isLastChild?: boolean }) {
  if (depth === 0) return null

  // Just add indentation based on depth, no connectors
  return (
    <div className="flex self-stretch">
      {Array.from({ length: depth }).map((_, i) => (
        <div key={i} className="w-4 shrink-0" />
      ))}
    </div>
  )
}

/** Single activity row in expanded view */
function ActivityRow({ activity, onOpenDetails, isLastChild }: ActivityRowProps) {
  const depth = activity.depth || 0

  // Intermediate messages (LLM commentary) - render with dashed circle icon
  // Show "Thinking" while streaming, stripped markdown content when complete
  if (activity.type === 'intermediate') {
    const isThinking = activity.status === 'running'
    const displayContent = isThinking ? 'Thinking...' : stripMarkdown(activity.content || '')
    const isComplete = activity.status === 'completed'
    return (
      <div className="flex items-stretch">
        <TreeViewConnector depth={depth} isLastChild={isLastChild} />
        <div
          className={cn(
            "group/row flex items-center gap-2 py-0.5 text-foreground/75 flex-1 min-w-0",
            SIZE_CONFIG.fontSize
          )}
          onClick={onOpenDetails && isComplete ? onOpenDetails : undefined}
        >
          {isThinking ? (
            <div className={cn(SIZE_CONFIG.iconSize, "flex items-center justify-center shrink-0")}>
              <Spinner className={SIZE_CONFIG.spinnerSize} />
            </div>
          ) : (
            <MessageCircleDashed className={cn(SIZE_CONFIG.iconSize, "shrink-0")} />
          )}
          <span className={cn("truncate flex-1", onOpenDetails && isComplete && "group-hover/row:underline")}>{displayContent}</span>
          {/* Open details button */}
          {onOpenDetails && isComplete && (
            <div
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation()
                onOpenDetails()
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation()
                  onOpenDetails()
                }
              }}
              className={cn(
                "p-0.5 rounded-[3px] opacity-0 group-hover/row:opacity-100 transition-opacity shrink-0",
                "hover:bg-muted/80 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              )}
            >
              <ArrowUpRight className={SIZE_CONFIG.iconSize} />
            </div>
          )}
        </div>
      </div>
    )
  }

  // Status activities (e.g., compacting) - system-level with distinct styling
  if (activity.type === 'status') {
    const isRunning = activity.status === 'running'
    return (
      <div className="flex items-stretch">
        <TreeViewConnector depth={depth} isLastChild={isLastChild} />
        <div
          className={cn(
            "flex items-center gap-2 py-0.5 text-muted-foreground flex-1 min-w-0",
            SIZE_CONFIG.fontSize
          )}
        >
          <div className={cn(SIZE_CONFIG.iconSize, "flex items-center justify-center shrink-0")}>
            {isRunning ? (
              <Spinner className={SIZE_CONFIG.spinnerSizeSmall} />
            ) : (
              <CheckCircle2 className={cn(SIZE_CONFIG.iconSize, "text-success")} />
            )}
          </div>
          <span className="truncate">{activity.content}</span>
        </div>
      </div>
    )
  }

  // Tool activities - show with status icon
  // Format: "[DisplayName] · [Intent/Description] [Params]"
  // - DisplayName: LLM-generated (activity.displayName) or fallback to formatted toolName
  // - Intent: For MCP tools (activity.intent), for Bash (toolInput.description)
  // - Params: Remaining tool input summary
  const toolName = activity.displayName
    || (activity.toolName ? getToolDisplayName(activity.toolName) : null)
    || (activity.type === 'thinking' ? 'Thinking' : 'Processing')

  // Intent for MCP tools, description for Bash commands
  const intentOrDescription = activity.intent || (activity.toolInput?.description as string | undefined)
  const inputSummary = formatToolInput(activity.toolInput)
  const isComplete = activity.status === 'completed' || activity.status === 'error'
  const isBackgrounded = activity.status === 'backgrounded'

  // For backgrounded tasks, show task/shell ID and elapsed time
  const backgroundInfo = isBackgrounded
    ? activity.taskId
      ? `Task ID: ${activity.taskId}${activity.elapsedSeconds ? `, ${formatDuration(activity.elapsedSeconds * 1000)} elapsed` : ''}`
      : activity.shellId
        ? `Shell ID: ${activity.shellId}${activity.elapsedSeconds ? `, ${formatDuration(activity.elapsedSeconds * 1000)} elapsed` : ''}`
        : null
    : null

  return (
    <div className="flex items-stretch">
      <TreeViewConnector depth={depth} isLastChild={isLastChild} />
      <div
        className={cn(
          "group/row flex items-center gap-2 py-0.5 text-muted-foreground flex-1 min-w-0",
          SIZE_CONFIG.fontSize
        )}
        onClick={onOpenDetails && isComplete ? onOpenDetails : undefined}
      >
        <ActivityStatusIcon status={activity.status} />
        {/* Tool name (always shown, darker) - underlined when clickable */}
        <span className={cn("shrink-0", onOpenDetails && isComplete && "group-hover/row:underline")}>{toolName}</span>
        {/* Background task info (task/shell ID + elapsed time) */}
        {backgroundInfo && (
          <>
            <span className="opacity-60 shrink-0">·</span>
            <span className="truncate min-w-0 max-w-[300px] text-accent">{backgroundInfo}</span>
          </>
        )}
        {/* Intent/description if available (darker, after interpunct) - skip for backgrounded tasks */}
        {!isBackgrounded && intentOrDescription && (
          <>
            <span className="opacity-60 shrink-0">·</span>
            <span className="truncate min-w-0 max-w-[300px]">{intentOrDescription}</span>
          </>
        )}
        {/* Additional params (lighter) - skip for backgrounded tasks */}
        {!isBackgrounded && inputSummary && (
          <span className="opacity-50 truncate min-w-0">{inputSummary}</span>
        )}
        {activity.status === 'error' && activity.error && (
          <>
            <span className="text-destructive/60 shrink-0">·</span>
            <span className="text-destructive truncate min-w-[120px] max-w-[300px]">{activity.error}</span>
          </>
        )}
        {/* Spacer to push details button to right */}
        <span className="flex-1" />
        {/* Open details button */}
        {onOpenDetails && isComplete && (
          <div
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation()
              onOpenDetails()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation()
                onOpenDetails()
              }
            }}
            className={cn(
              "p-0.5 rounded-[3px] opacity-0 group-hover/row:opacity-100 transition-opacity shrink-0",
              "hover:bg-muted/80 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            )}
          >
            <ArrowUpRight className={SIZE_CONFIG.iconSize} />
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Activity Group Component (for Task subagents)
// ============================================================================

interface ActivityGroupRowProps {
  group: ActivityGroup
  /** Controlled expansion state for activity groups */
  expandedGroups?: Set<string>
  /** Callback when expansion changes */
  onExpandedGroupsChange?: (groups: Set<string>) => void
  /** Callback to open activity details in Monaco */
  onOpenActivityDetails?: (activity: ActivityItem) => void
  /** Animation index for staggered animation */
  animationIndex?: number
}

/**
 * Renders a Task subagent with its child activities grouped together.
 * Provides visual containment and collapsible children.
 */
function ActivityGroupRow({ group, expandedGroups: externalExpandedGroups, onExpandedGroupsChange, onOpenActivityDetails, animationIndex = 0 }: ActivityGroupRowProps) {
  // Use local state if no controlled state provided
  const [localExpandedGroups, setLocalExpandedGroups] = useState<Set<string>>(new Set())
  const expandedGroups = externalExpandedGroups ?? localExpandedGroups
  const setExpandedGroups = onExpandedGroupsChange ?? setLocalExpandedGroups

  const groupId = group.parent.id
  const isExpanded = expandedGroups.has(groupId)

  const toggleExpanded = useCallback(() => {
    const next = new Set(expandedGroups)
    if (next.has(groupId)) {
      next.delete(groupId)
    } else {
      next.add(groupId)
    }
    setExpandedGroups(next)
  }, [groupId, expandedGroups, setExpandedGroups])

  const description = group.parent.toolInput?.description as string | undefined
  const subagentType = group.parent.toolInput?.subagent_type as string | undefined
  const isComplete = group.parent.status === 'completed' || group.parent.status === 'error'
  const hasError = group.parent.status === 'error'

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: animationIndex < SIZE_CONFIG.staggeredAnimationLimit ? animationIndex * 0.03 : 0.3 }}
      className="space-y-0.5"
    >
      {/* Task header row - no left padding, chevron aligned with activity row icons */}
      <div
        className={cn(
          "group/row flex items-center gap-2 py-0.5 rounded-md cursor-pointer text-muted-foreground",
          "hover:text-foreground transition-colors",
          SIZE_CONFIG.fontSize
        )}
        onClick={toggleExpanded}
      >
        {/* Chevron for expand/collapse - aligned with activity row icons */}
        <motion.div
          initial={false}
          animate={{ rotate: isExpanded ? 90 : 0 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className={cn(SIZE_CONFIG.iconSize, "flex items-center justify-center shrink-0")}
        >
          <ChevronRight className={SIZE_CONFIG.iconSize} />
        </motion.div>

        {/* Status icon - aligned with tool call icons */}
        <ActivityStatusIcon status={group.parent.status} />

        {/* Subagent type badge */}
        <span className="shrink-0 px-1.5 py-0.5 rounded-[4px] bg-background shadow-minimal text-[10px] font-medium">
          {subagentType || 'Task'}
        </span>

        {/* Task description or fallback */}
        <span className={cn(
          "truncate",
          hasError && "text-destructive"
        )}>
          {description || 'Task'}
        </span>

        {/* Duration and token stats from TaskOutput (only when complete) */}
        {isComplete && group.taskOutputData && (
          <span className="shrink-0 text-muted-foreground/60 tabular-nums">
            {group.taskOutputData.durationMs !== undefined && (
              <span>{formatDuration(group.taskOutputData.durationMs)}</span>
            )}
            {group.taskOutputData.durationMs !== undefined &&
              (group.taskOutputData.inputTokens !== undefined || group.taskOutputData.outputTokens !== undefined) && (
              <span className="mx-1">·</span>
            )}
            {(group.taskOutputData.inputTokens !== undefined || group.taskOutputData.outputTokens !== undefined) && (
              <span>
                {formatTokens((group.taskOutputData.inputTokens || 0) + (group.taskOutputData.outputTokens || 0))} tokens
              </span>
            )}
          </span>
        )}

        {/* Spacer to push details button to right */}
        <span className="flex-1" />

        {/* Open details button for the Task itself */}
        {onOpenActivityDetails && isComplete && (
          <div
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation()
              onOpenActivityDetails(group.parent)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation()
                onOpenActivityDetails(group.parent)
              }
            }}
            className={cn(
              "p-0.5 rounded-[3px] opacity-0 group-hover/row:opacity-100 transition-opacity shrink-0",
              "hover:bg-muted/80 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            )}
          >
            <ArrowUpRight className={SIZE_CONFIG.iconSize} />
          </div>
        )}
      </div>

      {/* Children with indentation */}
      <AnimatePresence initial={false}>
        {isExpanded && group.children.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              height: { duration: 0.2, ease: [0.4, 0, 0.2, 1] },
              opacity: { duration: 0.15 }
            }}
            className="overflow-hidden"
          >
            <div className="pl-0 space-y-0.5 border-l-2 border-muted ml-[5px]">
              {group.children.map((child, idx) => (
                <motion.div
                  key={child.id}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.02 }}
                  className="ml-[-4px]"
                >
                  <ActivityRow
                    activity={child}
                    onOpenDetails={onOpenActivityDetails ? () => onOpenActivityDetails(child) : undefined}
                    isLastChild={idx === group.children.length - 1}
                  />
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ============================================================================
// Streaming Response Preview Component
// ============================================================================

export interface ResponseCardProps {
  /** The content to display (markdown) */
  text: string
  /** Whether the content is still streaming */
  isStreaming: boolean
  /** When streaming started - used for buffering timeout calculation */
  streamStartTime?: number
  /** Callback to open file in editor */
  onOpenFile?: (path: string) => void
  /** Callback to open URL */
  onOpenUrl?: (url: string) => void
  /** Callback to open response in Monaco editor */
  onPopOut?: () => void
  /** Callback when user sends feedback via fullscreen commenting */
  onSendFeedback?: (feedback: string) => void
  /** Card variant - 'response' for AI messages, 'plan' for plan messages */
  variant?: 'response' | 'plan'
  /** Callback when user accepts the plan (plan variant only) */
  onAccept?: () => void
  /** Whether a user message has been sent after this plan (hides the approve footer) */
  hasUserResponse?: boolean
  /** Whether to show the Accept Plan button (default: true) */
  showAcceptPlan?: boolean
}

/**
 * ResponseCard - Unified card component for AI responses and plans
 *
 * Variants:
 * - 'response': Buffered streaming response with smart content gating
 * - 'plan': Plan message with header and Accept Plan button
 *
 * Response variant implements smart buffering:
 * - Waits for 40+ words with structure OR
 * - High-confidence patterns (code blocks, headers, lists) with lower threshold OR
 * - Timeout after 2.5 seconds
 *
 * Performance optimization: Uses throttled static snapshots instead of re-rendering
 * on every character. Content updates every 300ms during streaming, avoiding
 * expensive markdown parsing on every delta.
 */
export function ResponseCard({
  text,
  isStreaming,
  streamStartTime,
  onOpenFile,
  onOpenUrl,
  onPopOut,
  onSendFeedback,
  variant = 'response',
  onAccept,
  hasUserResponse = false,
  showAcceptPlan = true,
}: ResponseCardProps) {
  // Throttled content for display - updates every CONTENT_THROTTLE_MS during streaming
  const [displayedText, setDisplayedText] = useState(text)
  const lastUpdateRef = useRef(Date.now())
  // Copy to clipboard state
  const [copied, setCopied] = useState(false)
  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [text])

  // Throttle content updates during streaming for performance
  // Updates immediately when streaming ends to show final content
  useEffect(() => {
    if (!isStreaming) {
      // Streaming ended - show final content immediately
      setDisplayedText(text)
      return
    }

    const now = Date.now()
    const elapsed = now - lastUpdateRef.current

    if (elapsed >= BUFFER_CONFIG.CONTENT_THROTTLE_MS) {
      // Enough time passed - update immediately
      setDisplayedText(text)
      lastUpdateRef.current = now
    } else {
      // Schedule update for remaining time
      const timeout = setTimeout(() => {
        setDisplayedText(text)
        lastUpdateRef.current = Date.now()
      }, BUFFER_CONFIG.CONTENT_THROTTLE_MS - elapsed)
      return () => clearTimeout(timeout)
    }
  }, [text, isStreaming])

  // Calculate buffering decision based on current text (not displayed text)
  const bufferDecision = useMemo(() => {
    return shouldShowContent(text, isStreaming, streamStartTime)
  }, [text, isStreaming, streamStartTime])

  const isCompleted = !isStreaming
  const isBuffering = isStreaming && !bufferDecision.shouldShow

  // While buffering, return null - TurnCard will show a subtle indicator instead
  if (isBuffering) {
    return null
  }

  const MAX_HEIGHT = 540

  // Completed response or plan - show with max height and footer
  if (isCompleted || variant === 'plan') {
    const isPlan = variant === 'plan'

    return (
      <>
        <div className="bg-background shadow-minimal rounded-[8px] overflow-hidden relative group">
          {/* Fullscreen button - top right corner, visible on hover */}
          <button
            onClick={() => setIsFullscreen(true)}
            className={cn(
              "absolute top-2 right-2 p-1 rounded-[6px] transition-all z-10",
              "opacity-0 group-hover:opacity-100",
              "bg-background shadow-minimal",
              "text-muted-foreground/50 hover:text-foreground",
              "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:opacity-100"
            )}
            title="View Fullscreen"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>

          {/* Plan header - only shown for plan variant */}
          {isPlan && (
            <div
              className={cn(
                "px-4 py-2 border-b border-border/30 flex items-center gap-2 bg-success/5",
                SIZE_CONFIG.fontSize
              )}
            >
              <ListTodo className={cn(SIZE_CONFIG.iconSize, "text-success")} />
              <span className="font-medium text-success">Plan</span>
            </div>
          )}

          <div
            className="pl-[22px] pr-[16px] py-3 text-sm overflow-y-auto"
            style={{ maxHeight: MAX_HEIGHT }}
          >
            <Markdown
              mode="minimal"
              onUrlClick={onOpenUrl}
              onFileClick={onOpenFile}
            >
              {text}
            </Markdown>
          </div>

          {/* Footer with actions */}
          <div className={cn(
            "pl-4 pr-2.5 py-2 border-t border-border/30 flex items-center justify-between bg-muted/20",
            SIZE_CONFIG.fontSize
          )}>
            {/* Left side - Copy and View as Markdown */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleCopy}
                className={cn(
                  "flex items-center gap-1.5 transition-colors",
                  copied ? "text-success" : "text-muted-foreground hover:text-foreground",
                  "focus:outline-none focus-visible:underline"
                )}
              >
                {copied ? (
                  <>
                    <Check className={SIZE_CONFIG.iconSize} />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className={SIZE_CONFIG.iconSize} />
                    <span>Copy</span>
                  </>
                )}
              </button>
              {onPopOut && (
                <button
                  onClick={onPopOut}
                  className={cn(
                    "flex items-center gap-1.5 transition-colors",
                    "text-muted-foreground hover:text-foreground",
                    "focus:outline-none focus-visible:underline"
                  )}
                >
                  <ExternalLink className={SIZE_CONFIG.iconSize} />
                  <span>View as Markdown</span>
                </button>
              )}
            </div>

            {/* Right side - Accept Plan (only shown for plan variant until user responds) */}
            {isPlan && !hasUserResponse && showAcceptPlan && (
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  Type your feedback in chat or
                </span>
                <button
                  type="button"
                  onClick={onAccept}
                  className="h-[28px] pl-2.5 pr-2.5 text-xs font-medium rounded-[6px] flex items-center gap-1.5 transition-all bg-success/5 text-success hover:bg-success/10 shadow-tinted"
                  style={{ '--shadow-color': '34, 136, 82' } as React.CSSProperties}
                >
                  <Check className="h-3.5 w-3.5" />
                  <span>Accept Plan</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Fullscreen overlay with commenting */}
        <FullscreenOverlay
          content={text}
          isOpen={isFullscreen}
          onClose={() => setIsFullscreen(false)}
          variant={isPlan ? 'plan' : undefined}
          onOpenUrl={onOpenUrl}
          onOpenFile={onOpenFile}
          onSendFeedback={onSendFeedback}
        />
      </>
    )
  }

  // Streaming response - show throttled content with spinner
  return (
    <div className="bg-background shadow-minimal rounded-[8px] overflow-hidden">
      {/* Content area - uses displayedText (throttled) for performance */}
      <div
        className="pl-[22px] pr-4 py-3 text-sm overflow-y-auto"
        style={{ maxHeight: MAX_HEIGHT }}
      >
        <Markdown
          mode="minimal"
          onUrlClick={onOpenUrl}
          onFileClick={onOpenFile}
        >
          {displayedText}
        </Markdown>
      </div>

      {/* Footer */}
      <div className={cn("px-4 py-2 border-t border-border/30 flex items-center bg-muted/20", SIZE_CONFIG.fontSize)}>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Spinner className={SIZE_CONFIG.spinnerSize} />
          <span>Streaming...</span>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// TodoList Component (for TodoWrite tool visualization)
// ============================================================================

/** Status icon for a todo item - uses purple filled icon for completed */
function TodoStatusIcon({ status }: { status: TodoStatus }) {
  switch (status) {
    case 'pending':
      return <Circle className={cn(SIZE_CONFIG.iconSize, "shrink-0 text-muted-foreground/50")} />
    case 'in_progress':
      return (
        <div className={cn(SIZE_CONFIG.iconSize, "flex items-center justify-center shrink-0")}>
          <Spinner className={SIZE_CONFIG.spinnerSize} />
        </div>
      )
    case 'completed':
      return <CircleCheck className={cn(SIZE_CONFIG.iconSize, "shrink-0 text-accent fill-current")} />
    case 'interrupted':
      return <Ban className={cn(SIZE_CONFIG.iconSize, "shrink-0 text-muted-foreground/50")} />
  }
}

/** Single todo row - styled like ActivityRow */
function TodoRow({ todo }: { todo: TodoItem }) {
  const displayText = todo.status === 'in_progress' && todo.activeForm
    ? todo.activeForm
    : todo.content

  return (
    <div className={cn(
      "flex items-center gap-2 py-0.5 text-muted-foreground",
      SIZE_CONFIG.fontSize,
      todo.status === 'completed' && "opacity-50"
    )}>
      <TodoStatusIcon status={todo.status} />
      <span className={cn(
        "truncate flex-1",
        todo.status === 'completed' && "line-through"
      )}>
        {displayText}
      </span>
    </div>
  )
}

interface TodoListProps {
  todos: TodoItem[]
}

/**
 * TodoList - Displays the current state of TodoWrite tool
 * Styled to blend with TurnCard activities
 */
function TodoList({ todos }: TodoListProps) {
  if (todos.length === 0) return null

  return (
    <div className="pl-4 pr-2 pt-2.5 pb-1.5 space-y-0.5 border-l-2 border-muted ml-[13px]">
      {/* Header */}
      <div className={cn("text-muted-foreground pb-1", SIZE_CONFIG.fontSize)}>
        Todo List
      </div>
      {/* Todo items */}
      {todos.map((todo, index) => (
        <motion.div
          key={`${todo.content}-${index}`}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: index * 0.03 }}
        >
          <TodoRow todo={todo} />
        </motion.div>
      ))}
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * TurnCard - Email-like display for one assistant turn
 *
 * Batches all activities (tools, thinking) into a collapsible section
 * with the final response displayed separately below.
 *
 * Memoized to prevent re-renders of completed turns during session switches.
 * Only complete, non-streaming turns are memoized - active turns always re-render.
 */
export const TurnCard = React.memo(function TurnCard({
  sessionId,
  turnId,
  activities,
  response,
  intent,
  isStreaming,
  isComplete,
  defaultExpanded = false,
  isExpanded: externalIsExpanded,
  onExpandedChange,
  expandedActivityGroups: externalExpandedActivityGroups,
  onExpandedActivityGroupsChange,
  onOpenFile,
  onOpenUrl,
  onPopOut,
  onOpenDetails,
  onOpenActivityDetails,
  onOpenMultiFileDiff,
  hasEditOrWriteActivities,
  todos,
  renderActionsMenu,
  onAcceptPlan,
  hasUserResponse,
  onSendFeedback,
}: TurnCardProps) {
  const hasRunning = activities.some(a => a.status === 'running')

  // Use local state if no controlled state provided
  const [localExpandedTurns, setLocalExpandedTurns] = useState<Set<string>>(() => defaultExpanded ? new Set([turnId]) : new Set())
  const isExpanded = externalIsExpanded ?? localExpandedTurns.has(turnId)

  const toggleExpanded = useCallback(() => {
    const newExpanded = !isExpanded
    if (onExpandedChange) {
      onExpandedChange(newExpanded)
    } else {
      setLocalExpandedTurns(prev => {
        const next = new Set(prev)
        if (next.has(turnId)) {
          next.delete(turnId)
        } else {
          next.add(turnId)
        }
        return next
      })
    }
  }, [turnId, isExpanded, onExpandedChange])

  // Use local state for activity groups if no controlled state provided
  const [localExpandedActivityGroups, setLocalExpandedActivityGroups] = useState<Set<string>>(new Set())
  const expandedActivityGroups = externalExpandedActivityGroups ?? localExpandedActivityGroups
  const handleExpandedActivityGroupsChange = onExpandedActivityGroupsChange ?? setLocalExpandedActivityGroups

  // Check if response is in buffering state
  // No polling needed - parent updates trigger re-evaluation naturally
  const isBuffering = useMemo(
    () => isResponseBuffering(response),
    [response]
  )


  // Compute preview text with cross-fade animation
  const previewText = useMemo(
    () => getPreviewText(activities, intent, isStreaming, !!response, isComplete),
    [activities, intent, isStreaming, response, isComplete]
  )

  // Sort activities by timestamp for correct chronological order
  // This handles the live streaming case (turn-utils sorts on flush for completed turns)
  const sortedActivities = useMemo(
    () => [...activities].sort((a, b) => a.timestamp - b.timestamp),
    [activities]
  )

  // Check if we have any Task subagents - if so, use grouped view
  const hasTaskSubagents = useMemo(
    () => sortedActivities.some(a => a.toolName === 'Task'),
    [sortedActivities]
  )

  // Group activities by parent Task for better visualization
  // Only group if there are Task subagents, otherwise keep flat for simpler view
  const groupedActivities = useMemo(
    () => hasTaskSubagents ? groupActivitiesByParent(sortedActivities) : null,
    [sortedActivities, hasTaskSubagents]
  )

  // Pre-compute which activities are last children - O(n) instead of O(n²) per-render check
  // Only used for flat view (non-grouped)
  const lastChildSet = useMemo(
    () => !hasTaskSubagents ? computeLastChildSet(sortedActivities) : new Set<string>(),
    [sortedActivities, hasTaskSubagents]
  )

  // Don't render if nothing to show and turn is complete
  if (activities.length === 0 && !response && isComplete) {
    return null
  }

  const hasActivities = activities.length > 0

  // Detect "thinking" state - streaming but no running activities and no ready response
  // This covers the gap between tool completion and response starting
  const isThinking = isStreaming && !isComplete && !hasRunning && (!response || isBuffering)

  return (
    <div className="space-y-1">
      {/* Activity Section */}
      {hasActivities && (
        <div className="group select-none">
          {/* Collapsed Header / Toggle */}
          <button
            onClick={toggleExpanded}
            className={cn(
              "flex items-center gap-2 w-full pl-2.5 pr-1.5 py-1.5 rounded-[8px] text-left",
              SIZE_CONFIG.fontSize,
              "text-muted-foreground",
              "hover:bg-muted/50 transition-colors",
              "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            )}
          >
            {/* Chevron with rotation animation - aligned with activity row icons */}
            <motion.div
              initial={false}
              animate={{ rotate: isExpanded ? 90 : 0 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className={cn(SIZE_CONFIG.iconSize, "flex items-center justify-center shrink-0")}
            >
              <ChevronRight className={SIZE_CONFIG.iconSize} />
            </motion.div>

            {/* Step count badge */}
            <span className="-ml-0.5 shrink-0 px-1.5 py-0.5 rounded-[4px] bg-background shadow-minimal text-[10px] font-medium tabular-nums">
              {activities.length}
            </span>

            {/* Preview text with crossfade + inline failure count */}
            <span className="relative flex-1 min-w-0 h-5 flex items-center">
              <AnimatePresence initial={false}>
                <motion.span
                  key={previewText}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="absolute inset-0 truncate"
                >
                  {previewText}
                </motion.span>
              </AnimatePresence>
            </span>

            {/* Turn actions menu - use platform override or default */}
            {renderActionsMenu ? renderActionsMenu() : (
              <TurnCardActionsMenu
                onOpenDetails={onOpenDetails}
                onOpenMultiFileDiff={onOpenMultiFileDiff}
                hasEditOrWriteActivities={hasEditOrWriteActivities}
              />
            )}
          </button>

          {/* Expanded Activity List */}
          <AnimatePresence initial={false}>
            {isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{
                  height: { duration: 0.25, ease: [0.4, 0, 0.2, 1] },
                  opacity: { duration: 0.15 }
                }}
                className="overflow-hidden"
              >
                {/* Scrollable container when many activities - subtle background for scroll context */}
                {/* ml-[15px] positions the border-l under the chevron */}
                <div
                  className={cn(
                    "pl-4 pr-2 py-0 space-y-0.5 border-l-2 border-muted ml-[13px]",
                    sortedActivities.length > SIZE_CONFIG.maxVisibleActivities && "rounded-r-md overflow-y-auto py-1.5"
                  )}
                  style={{
                    maxHeight: sortedActivities.length > SIZE_CONFIG.maxVisibleActivities
                      ? SIZE_CONFIG.maxVisibleActivities * SIZE_CONFIG.activityRowHeight
                      : undefined
                  }}
                >
                  {/* Grouped view for Task subagents */}
                  {groupedActivities ? (
                    groupedActivities.map((item, index) => (
                      isActivityGroup(item) ? (
                        <ActivityGroupRow
                          key={item.parent.id}
                          group={item}
                          expandedGroups={expandedActivityGroups}
                          onExpandedGroupsChange={handleExpandedActivityGroupsChange}
                          onOpenActivityDetails={onOpenActivityDetails}
                          animationIndex={index}
                        />
                      ) : (
                        <motion.div
                          key={item.id}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: index < SIZE_CONFIG.staggeredAnimationLimit ? index * 0.03 : 0.3 }}
                        >
                          <ActivityRow
                            activity={item}
                            onOpenDetails={onOpenActivityDetails ? () => onOpenActivityDetails(item) : undefined}
                          />
                        </motion.div>
                      )
                    ))
                  ) : (
                    /* Flat view for simple tool calls */
                    sortedActivities.map((activity, index) => (
                      <motion.div
                        key={activity.id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        // Only first 10 items get staggered delay, rest appear simultaneously
                        transition={{ delay: index < SIZE_CONFIG.staggeredAnimationLimit ? index * 0.03 : 0.3 }}
                      >
                        <ActivityRow
                          activity={activity}
                          onOpenDetails={onOpenActivityDetails ? () => onOpenActivityDetails(activity) : undefined}
                          isLastChild={lastChildSet.has(activity.id)}
                        />
                      </motion.div>
                    ))
                  )}
                  {/* Thinking/Buffering indicator - shown while waiting for response */}
                  {isThinking && (
                    <motion.div
                      key="thinking"
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: Math.min(sortedActivities.length, SIZE_CONFIG.staggeredAnimationLimit) * 0.03 }}
                      className={cn("flex items-center gap-2 py-0.5 text-muted-foreground/70", SIZE_CONFIG.fontSize)}
                    >
                      <Spinner className={SIZE_CONFIG.spinnerSize} />
                      <span>{isBuffering ? 'Preparing response...' : 'Thinking...'}</span>
                    </motion.div>
                  )}
                </div>
                {/* TodoList - inside expanded section */}
                {todos && todos.length > 0 && (
                  <TodoList todos={todos} />
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Standalone thinking indicator - when no activities but still working */}
      {!hasActivities && isThinking && (
        <div className={cn("flex items-center gap-2 px-3 py-1.5 text-muted-foreground", SIZE_CONFIG.fontSize)}>
          <Spinner className={SIZE_CONFIG.spinnerSize} />
          <span>{isBuffering ? 'Preparing response...' : 'Thinking...'}</span>
        </div>
      )}

      {/* Response Section - only shown when not buffering */}
      {response && !isBuffering && (
        <div className={cn("select-text", hasActivities && "mt-2")}>
          <ResponseCard
            text={response.text}
            isStreaming={response.isStreaming}
            streamStartTime={response.streamStartTime}
            onOpenFile={onOpenFile}
            onOpenUrl={onOpenUrl}
            onPopOut={onPopOut ? () => onPopOut(response.text) : undefined}
            onSendFeedback={onSendFeedback}
            variant={response.isPlan ? 'plan' : 'response'}
            onAccept={onAcceptPlan}
            hasUserResponse={hasUserResponse}
          />
        </div>
      )}
    </div>
  )
}, (prev, next) => {
  // Conservative memoization: only skip re-render for completed, non-streaming turns
  // Active turns (streaming or incomplete) always re-render to show updates

  // Always re-render streaming turns
  if (prev.isStreaming || next.isStreaming) return false

  // Always re-render incomplete turns
  if (!prev.isComplete || !next.isComplete) return false

  // Re-render if expansion state changed
  if (prev.isExpanded !== next.isExpanded) return false
  if (prev.expandedActivityGroups !== next.expandedActivityGroups) return false

  // For complete, non-streaming turns: skip re-render if same turn
  // These are static and safe to cache
  return prev.turnId === next.turnId
})
