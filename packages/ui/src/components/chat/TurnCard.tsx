import * as React from 'react'
import { useMemo, useEffect, useRef, useCallback, useState } from 'react'
import type { ToolDisplayMeta, AnnotationV1 } from '@craft-agent/core'
import { normalizePath, pathStartsWith, stripPathPrefix } from '@craft-agent/core/utils'
import { motion, AnimatePresence } from 'motion/react'
import {
  ChevronRight,
  CheckCircle2,
  XCircle,
  Circle,
  MessageCircleDashed,
  FileText,
  ArrowUpRight,
  Ban,
  Copy,
  Check,
  Maximize2,
  CircleCheck,
  ListTodo,
  Pencil,
  FilePenLine,
  GitBranch,
  CornerDownRight,
} from 'lucide-react'
import * as ReactDOM from 'react-dom'
import { cn } from '../../lib/utils'
import { Markdown } from '../markdown'
import { resolveTextAnnotations } from '../markdown/annotation-resolver'
import { Spinner } from '../ui/LoadingIndicator'
import {
  Island,
  IslandContentView,
  IslandFollowUpContentView,
  type IslandActiveViewSize,
  type IslandTransitionConfig,
} from '../ui'
import { Tooltip, TooltipTrigger, TooltipContent } from '../tooltip'
import { parseDiffFromFile, type FileContents } from '@pierre/diffs'
import { getDiffStats, getUnifiedDiffStats } from '../code-viewer'
import { TurnCardActionsMenu } from './TurnCardActionsMenu'
import { computeLastChildSet, groupActivitiesByParent, isActivityGroup, formatDuration, formatTokens, deriveTurnPhase, shouldShowThinkingIndicator, type ActivityGroup, type AssistantTurn } from './turn-utils'
import { DocumentFormattedMarkdownOverlay } from '../overlay'
import { AcceptPlanDropdown } from './AcceptPlanDropdown'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
} from '../ui/StyledDropdown'

// ============================================================================
// Utilities
// ============================================================================

/**
 * Simple markdown stripping for preview text.
 * Removes markdown syntax to show plain text preview.
 * Code block content is preserved as plain text.
 */
function stripMarkdown(text: string): string {
  return text
    // Extract content from fenced code blocks (remove ``` and optional language)
    .replace(/```(?:\w+)?\n?([\s\S]*?)```/g, '$1')
    // Extract content from inline code
    .replace(/`([^`]+)`/g, '$1')
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

/**
 * Compute diff stats for Edit/Write tool inputs.
 * Uses @pierre/diffs for accurate line-by-line diff calculation.
 *
 * Supports both:
 * - Claude Code format: { file_path, old_string, new_string }
 * - Codex format: { changes: Array<{ path, kind, diff }> }
 *
 * @param toolName - 'Edit' or 'Write'
 * @param toolInput - The tool input containing old_string/new_string (Edit) or content (Write)
 * @returns { additions, deletions } or null if not applicable
 */
function computeEditWriteDiffStats(
  toolName: string | undefined,
  toolInput: Record<string, unknown> | undefined
): { additions: number; deletions: number } | null {
  if (!toolInput) return null

  if (toolName === 'Edit') {
    // Check for Codex format: { changes: Array<{ path, kind, diff }> }
    if (toolInput.changes && Array.isArray(toolInput.changes)) {
      let totalAdditions = 0
      let totalDeletions = 0
      for (const change of toolInput.changes as Array<{ path?: string; diff?: string }>) {
        if (change.diff) {
          const stats = getUnifiedDiffStats(change.diff, change.path || 'file')
          if (stats) {
            totalAdditions += stats.additions
            totalDeletions += stats.deletions
          }
        }
      }
      if (totalAdditions === 0 && totalDeletions === 0) return null
      return { additions: totalAdditions, deletions: totalDeletions }
    }

    // Claude Code format: { file_path, old_string, new_string }
    const oldString = (toolInput.old_string as string) ?? ''
    const newString = (toolInput.new_string as string) ?? ''
    if (!oldString && !newString) return null

    const oldFile: FileContents = { name: 'file', contents: oldString, lang: 'text' }
    const newFile: FileContents = { name: 'file', contents: newString, lang: 'text' }
    const fileDiff = parseDiffFromFile(oldFile, newFile)
    return getDiffStats(fileDiff)
  }

  if (toolName === 'Write') {
    const content = (toolInput.content as string) ?? ''
    if (!content) return null

    // For Write, everything is an addition (new file content)
    const oldFile: FileContents = { name: 'file', contents: '', lang: 'text' }
    const newFile: FileContents = { name: 'file', contents: content, lang: 'text' }
    const fileDiff = parseDiffFromFile(oldFile, newFile)
    return getDiffStats(fileDiff)
  }

  return null
}

// ============================================================================
// Size Configuration
// ============================================================================

/**
 * Global size configuration for TurnCard components.
 * Adjust these values to scale the entire component uniformly.
 */
/** Shared size configuration for activity UI - exported for reuse in inline execution */
export const SIZE_CONFIG = {
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
  /** Max visible activities before scrolling (show ~15 items) */
  maxVisibleActivities: 15,
  /** Number of items before which we apply staggered animation */
  staggeredAnimationLimit: 10,
} as const

// ============================================================================
// Types
// ============================================================================

export type ActivityStatus = 'pending' | 'running' | 'completed' | 'error' | 'backgrounded'
export type ActivityType = 'tool' | 'thinking' | 'intermediate' | 'status' | 'plan'

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
  toolDisplayMeta?: ToolDisplayMeta  // Embedded metadata with base64 icon (for viewer compatibility)
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
  /** ID of the underlying message (for branching + annotations) */
  messageId?: string
  /** Persisted annotations attached to the response message */
  annotations?: AnnotationV1[]
}

// ============================================================================
// TurnCard Props
// ============================================================================

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
  /** Callback when user accepts the plan with compaction (compact conversation first, then execute) */
  onAcceptPlanWithCompact?: () => void
  /** Whether this is the last response in the session (shows Accept Plan button only for last response) */
  isLastResponse?: boolean
  /** Session folder path for stripping from file paths in tool display */
  sessionFolderPath?: string
  /** Display mode: 'detailed' shows all info, 'informative' hides MCP/API names and params */
  displayMode?: 'informative' | 'detailed'
  /** Animate response appearance (for playground demos) */
  animateResponse?: boolean
  /** Hide footers for compact embedding (EditPopover) */
  compactMode?: boolean
  /** Callback to branch the session from a specific message */
  onBranch?: (messageId: string, options?: { newPanel?: boolean }) => void
  /** Callback to add an annotation to a response message */
  onAddAnnotation?: (messageId: string, annotation: AnnotationV1) => void
  /** Callback to remove a persisted annotation from a response message */
  onRemoveAnnotation?: (messageId: string, annotationId: string) => void
  /** Callback to update a persisted annotation */
  onUpdateAnnotation?: (messageId: string, annotationId: string, patch: Partial<AnnotationV1>) => void
  /** Input send key behavior used by follow-up editor */
  sendMessageKey?: 'enter' | 'cmd-enter'
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

/**
 * Strip session/workspace folder paths from file paths for cleaner display.
 * Only strips paths that match the current session folder path.
 * Example: /path/to/sessions/260121-foo/plans/file.md → plans/file.md
 */
function stripSessionFolderPath(filePath: string, sessionFolderPath?: string): string {
  if (!sessionFolderPath) return filePath

  // Get workspace path (parent of sessions folder)
  // sessionFolderPath: /path/workspaces/{uuid}/sessions/{sessionId}
  const workspacePath = normalizePath(sessionFolderPath).replace(/\/sessions\/[^/]+$/, '')

  // Try session folder first (more specific)
  if (pathStartsWith(filePath, sessionFolderPath)) {
    return stripPathPrefix(filePath, sessionFolderPath)
  }

  // Then try workspace folder
  if (pathStartsWith(filePath, workspacePath)) {
    return stripPathPrefix(filePath, workspacePath)
  }

  return filePath
}

/** Format tool input as a concise summary - CSS truncate handles overflow */
function formatToolInput(
  input?: Record<string, unknown>,
  toolName?: string,
  sessionFolderPath?: string
): string {
  if (!input || Object.keys(input).length === 0) return ''

  // For call_llm: model shown as badge, prompt duplicates intent
  if (toolName === 'mcp__session__call_llm') return ''

  const parts: string[] = []

  // For Edit/Write tools, only show file_path (skip old_string, new_string, replace_all, content)
  const isEditOrWrite = toolName === 'Edit' || toolName === 'Write'

  // Handle Codex format: { changes: Array<{ path, kind, diff }> }
  // Extract path from first change if present
  if (isEditOrWrite && input.changes && Array.isArray(input.changes)) {
    const firstChange = input.changes[0] as { path?: string } | undefined
    if (firstChange?.path) {
      const pathStr = stripSessionFolderPath(firstChange.path, sessionFolderPath)
      parts.push(pathStr)
    }
    return parts.join(' ')
  }

  for (const [key, value] of Object.entries(input)) {
    // Skip meta fields and description (shown separately)
    if (key === '_intent' || key === 'description' || value === undefined || value === null) continue

    // For Edit/Write tools, only include file_path
    if (isEditOrWrite && key !== 'file_path') continue

    let valStr = typeof value === 'string'
      ? value.replace(/\s+/g, ' ').trim()
      : JSON.stringify(value)

    // Strip session/workspace paths from file_path for Edit/Write tools
    if (isEditOrWrite && key === 'file_path' && typeof value === 'string') {
      valStr = stripSessionFolderPath(valStr, sessionFolderPath)
    }

    parts.push(valStr)
    if (parts.length >= 2) break // Max 2 values
  }
  return parts.join(' ')
}

/**
 * Extract the action portion from an LLM-provided displayName by stripping
 * a matching icon/tool prefix.
 *
 * Examples:
 *   extractActionFromDisplayName("Git", "Git Status")  → "Status"
 *   extractActionFromDisplayName("npm", "Install Deps") → "Install Deps"
 *   extractActionFromDisplayName("Git", "Check Branch")  → "Check Branch"
 */
function extractActionFromDisplayName(iconName: string, llmName: string): string {
  // If LLM name starts with the icon name, strip the prefix to get the action
  // "Git Status" with icon "Git" → "Status"
  if (llmName.toLowerCase().startsWith(iconName.toLowerCase() + ' ')) {
    return llmName.slice(iconName.length + 1).trim()
  }
  // Otherwise use the full LLM name as the action
  // "Install Dependencies" with icon "npm" → "Install Dependencies"
  return llmName
}

/**
 * Format tool display using embedded toolDisplayMeta.
 * toolDisplayMeta is set at storage time in the main process and includes:
 * - displayName: Human-readable name
 * - iconDataUrl: Base64-encoded icon (for skills/sources)
 * - description: Brief description
 * - category: 'skill' | 'source' | 'native' | 'mcp'
 */
function formatToolDisplay(
  activity: ActivityItem
): { name: string; icon?: string; description?: string } {
  const { toolName, displayName, toolInput, toolDisplayMeta } = activity

  // Primary: Use embedded toolDisplayMeta (works in both Electron and viewer)
  if (toolDisplayMeta) {
    // For MCP tools, append the tool slug to the source name
    if (toolName?.startsWith('mcp__') && toolDisplayMeta.category === 'source') {
      const parts = toolName.match(/^mcp__([^_]+)__(.+)$/)
      if (parts) {
        const toolSlug = parts[2]
        return {
          name: `${toolDisplayMeta.displayName}: ${toolSlug}`,
          icon: toolDisplayMeta.iconDataUrl,
          description: toolDisplayMeta.description,
        }
      }
    }

    // For Bash commands with LLM-provided displayName: merge icon name + action
    // e.g., icon "Git" + LLM "Git Status" → "Git: Status"
    // e.g., icon "npm" + LLM "Install Dependencies" → "npm: Install Dependencies"
    // Special case: for generic "Terminal", show only the action
    // e.g., icon "Terminal" + LLM "Install Dependencies" → "Install Dependencies"
    if (toolName === 'Bash' && displayName) {
      const iconName = toolDisplayMeta.displayName
      const action = extractActionFromDisplayName(iconName, displayName)
      return {
        name: iconName.toLowerCase() === 'terminal' ? action : `${iconName}: ${action}`,
        icon: toolDisplayMeta.iconDataUrl,
        description: toolDisplayMeta.description,
      }
    }

    // For native tools with LLM-provided displayName: use the LLM's name
    // This gives semantic names like "Read Config" instead of generic "Read"
    if (displayName && toolDisplayMeta.category === 'native') {
      return {
        name: displayName,
        icon: toolDisplayMeta.iconDataUrl,
        description: toolDisplayMeta.description,
      }
    }

    return {
      name: toolDisplayMeta.displayName,
      icon: toolDisplayMeta.iconDataUrl,
      description: toolDisplayMeta.description,
    }
  }

  // Fallback for Skill tool without toolDisplayMeta (legacy sessions)
  if (toolName === 'Skill' && toolInput?.skill) {
    const skillId = String(toolInput.skill)
    // Extract slug from qualified name (workspaceId:slug) for display
    const colonIdx = skillId.indexOf(':')
    const slug = colonIdx > 0 ? skillId.slice(colonIdx + 1) : skillId
    return { name: slug }
  }

  // Final fallback: Use LLM-generated displayName or tool name
  const name = displayName || (toolName ? getToolDisplayName(toolName) : 'Processing')
  return { name }
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

/**
 * Status icon for an activity - exported for reuse in inline execution.
 * Supports custom icons from skill/source metadata when completed.
 * Edit/Write tools show tool-specific icons; others show checkmark or custom icon.
 */
export function ActivityStatusIcon({
  status,
  toolName,
  customIcon
}: {
  status: ActivityStatus
  toolName?: string
  /** Custom icon from tool metadata - emoji or data URL (base64) */
  customIcon?: string
}) {
  // Render the appropriate icon based on status
  const renderIcon = () => {
    // For completed status with custom icon, use it instead of checkmark
    if (status === 'completed' && customIcon) {
      // Check if it's an emoji (short string, not a URL or data URL)
      // Emojis can be 1-4+ characters due to ZWJ sequences
      const isLikelyEmoji = customIcon.length <= 8 && !/^(https?:\/\/|data:)/.test(customIcon)
      if (isLikelyEmoji) {
        return (
          <span className={cn(SIZE_CONFIG.iconSize, "shrink-0 flex items-center justify-center text-[10px] leading-none")}>
            {customIcon}
          </span>
        )
      }
      // Otherwise it's a data URL (base64) or HTTP URL
      return (
        <img
          src={customIcon}
          alt=""
          className={cn(SIZE_CONFIG.iconSize, "shrink-0 rounded-sm object-contain")}
        />
      )
    }

    // Default icon logic
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
        // Edit and Write tools get their own icons with accent color instead of green checkmark
        if (toolName === 'Edit') {
          return <Pencil className={cn(SIZE_CONFIG.iconSize, "shrink-0 text-accent")} />
        }
        if (toolName === 'Write') {
          return <FilePenLine className={cn(SIZE_CONFIG.iconSize, "shrink-0 text-accent")} />
        }
        return <CheckCircle2 className={cn(SIZE_CONFIG.iconSize, "shrink-0 text-success")} />
      case 'error':
        return <XCircle className={cn(SIZE_CONFIG.iconSize, "shrink-0 text-destructive")} />
    }
  }

  // Wrap in AnimatePresence for crossfade between states
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={status}
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.8 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="shrink-0"
      >
        {renderIcon()}
      </motion.div>
    </AnimatePresence>
  )
}

interface ActivityRowProps {
  activity: ActivityItem
  /** Callback to open activity details in Monaco */
  onOpenDetails?: () => void
  /** Whether this is the last child at its depth level (for └ corner in tree view) */
  isLastChild?: boolean
  /** Session folder path for stripping from file paths in tool display */
  sessionFolderPath?: string
  /** Display mode: 'detailed' shows all info, 'informative' hides MCP/API names and params */
  displayMode?: 'informative' | 'detailed'
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
function ActivityRow({ activity, onOpenDetails, isLastChild, sessionFolderPath, displayMode = 'detailed' }: ActivityRowProps) {
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
  // - DisplayName: From toolDisplayMeta (embedded in message) or LLM-generated or fallback
  // - Intent: For MCP tools (activity.intent), for Bash (toolInput.description)
  // - Params: Remaining tool input summary
  const toolDisplay = formatToolDisplay(activity)
  const fullDisplayName = toolDisplay.name
    || (activity.type === 'thinking' ? 'Thinking' : 'Processing')

  // Detect MCP/API tools (toolName starts with "mcp__")
  const isMcpOrApiTool = activity.toolName?.startsWith('mcp__') ?? false

  // For MCP/API tools, extract source name and tool slug
  // e.g., "ClickUp: clickup_search" -> sourceName="ClickUp", toolSlug="clickup_search"
  let sourceName = fullDisplayName
  let toolSlug: string | undefined = undefined
  if (isMcpOrApiTool) {
    const colonIndex = fullDisplayName.indexOf(':')
    if (colonIndex > 0) {
      sourceName = fullDisplayName.substring(0, colonIndex).trim()
      toolSlug = fullDisplayName.substring(colonIndex + 1).trim()
    }
  }

  // For non-MCP tools or informative mode, use the appropriate display name
  const displayedName: string = isMcpOrApiTool ? sourceName : fullDisplayName

  // Intent for MCP tools, description for Bash commands
  const intentOrDescription = activity.intent || (activity.toolInput?.description as string | undefined)
  const inputSummary = formatToolInput(activity.toolInput, activity.toolName, sessionFolderPath)
  const diffStats = computeEditWriteDiffStats(activity.toolName, activity.toolInput)
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
        <ActivityStatusIcon status={activity.status} toolName={activity.toolName} customIcon={toolDisplay.icon} />
        {/* MCP/API tools: Source name (shrink-0) then error badge (if any) then compound label (flex-1) */}
        {isMcpOrApiTool && !isBackgrounded && (
          <>
            <span className="shrink-0">{sourceName}</span>
            {/* Error badge for MCP/API tools */}
            {activity.status === 'error' && activity.error && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="px-1.5 py-0.5 bg-[color-mix(in_oklab,var(--destructive)_4%,var(--background))] shadow-tinted rounded-[4px] text-[10px] text-destructive font-medium cursor-default shrink-0"
                    style={{ '--shadow-color': 'var(--destructive-rgb)' } as React.CSSProperties}
                  >
                    Error
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[400px]">
                  {activity.error}
                </TooltipContent>
              </Tooltip>
            )}
            {/* Model badge for LLM Query */}
            {activity.toolName === 'mcp__session__call_llm' && activity.toolInput?.model && (
              <span className="px-1.5 py-0.5 bg-background shadow-minimal rounded-[4px] text-[10px] text-foreground/60 shrink-0">
                {String(activity.toolInput.model)}
              </span>
            )}
            {(intentOrDescription || (displayMode === 'detailed' && (toolSlug || inputSummary))) && (
              <span className={cn("truncate flex-1 min-w-0", onOpenDetails && isComplete && "group-hover/row:underline")}>
                {intentOrDescription && (
                  <>
                    <span className="opacity-60"> · </span>
                    <span>{intentOrDescription}</span>
                  </>
                )}
                {displayMode === 'detailed' && toolSlug && (
                  <>
                    <span className="opacity-60"> · </span>
                    <span className="opacity-70">{toolSlug}</span>
                  </>
                )}
                {displayMode === 'detailed' && inputSummary && (
                  <>
                    <span className="opacity-60"> · </span>
                    <span className="opacity-50">{inputSummary}</span>
                  </>
                )}
              </span>
            )}
          </>
        )}
        {/* Native tools: Tool name (shrink-0) */}
        {!isMcpOrApiTool && (
          <span className={cn("shrink-0", onOpenDetails && isComplete && "group-hover/row:underline")}>{displayedName}</span>
        )}
        {/* Diff stats and filename badges - after tool name */}
        {!isMcpOrApiTool && !isBackgrounded && diffStats && (
          <span className="flex items-center gap-1.5 text-[10px] shrink-0">
            {diffStats.deletions > 0 && (
              <span
                className="px-1.5 py-0.5 bg-[color-mix(in_oklab,var(--destructive)_5%,var(--background))] shadow-tinted rounded-[4px] text-destructive"
                style={{ '--shadow-color': 'var(--destructive-rgb)' } as React.CSSProperties}
              >{diffStats.deletions}</span>
            )}
            {diffStats.additions > 0 && (
              <span
                className="px-1.5 py-0.5 bg-[color-mix(in_oklab,var(--success)_5%,var(--background))] shadow-tinted rounded-[4px] text-success"
                style={{ '--shadow-color': 'var(--success-rgb)' } as React.CSSProperties}
              >{diffStats.additions}</span>
            )}
            {/* Filename badge - supports both Claude Code and Codex formats */}
            {(() => {
              // Claude Code format: file_path
              if (typeof activity.toolInput?.file_path === 'string') {
                return (
                  <span className="px-1.5 py-0.5 bg-background shadow-minimal rounded-[4px] text-[11px] text-foreground/70">
                    {normalizePath(activity.toolInput.file_path).split('/').pop()}
                  </span>
                )
              }
              // Codex format: changes[0].path
              if (Array.isArray(activity.toolInput?.changes)) {
                const firstChange = activity.toolInput.changes[0] as { path?: string } | undefined
                if (firstChange?.path) {
                  return (
                    <span className="px-1.5 py-0.5 bg-background shadow-minimal rounded-[4px] text-[11px] text-foreground/70">
                      {normalizePath(firstChange.path).split('/').pop()}
                    </span>
                  )
                }
              }
              return null
            })()}
          </span>
        )}
        {/* Filename badge for Read tool (no diff stats) */}
        {!isMcpOrApiTool && !isBackgrounded && !diffStats && activity.toolName === 'Read' && typeof activity.toolInput?.file_path === 'string' && (
          <span className="flex items-center gap-1.5 text-[10px] shrink-0">
            <span className="px-1.5 py-0.5 bg-background shadow-minimal rounded-[4px] text-[11px] text-foreground/70">
              {normalizePath(activity.toolInput.file_path).split('/').pop()}
            </span>
          </span>
        )}
        {/* Error badge for native tools */}
        {!isMcpOrApiTool && activity.status === 'error' && activity.error && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="px-1.5 py-0.5 bg-[color-mix(in_oklab,var(--destructive)_4%,var(--background))] shadow-tinted rounded-[4px] text-[10px] text-destructive font-medium cursor-default shrink-0"
                style={{ '--shadow-color': 'var(--destructive-rgb)' } as React.CSSProperties}
              >
                Error
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[400px]">
              {activity.error}
            </TooltipContent>
          </Tooltip>
        )}
        {/* Native tools: Compound label with description + params (flex-1) */}
        {/* In informative mode, hide inputSummary (command details) - only show description */}
        {!isMcpOrApiTool && !isBackgrounded && (intentOrDescription || (displayMode === 'detailed' && inputSummary)) && (
          <span className={cn("truncate flex-1 min-w-0", onOpenDetails && isComplete && "group-hover/row:underline")}>
            {intentOrDescription && (
              <>
                <span className="opacity-60"> · </span>
                <span>{intentOrDescription}</span>
              </>
            )}
            {displayMode === 'detailed' && inputSummary && (
              <>
                <span className="opacity-60"> · </span>
                <span className="opacity-50">{inputSummary}</span>
              </>
            )}
          </span>
        )}
        {/* Background task info (task/shell ID + elapsed time) */}
        {backgroundInfo && (
          <>
            <span className="opacity-60 shrink-0">·</span>
            <span className="truncate min-w-0 max-w-[300px] text-accent">{backgroundInfo}</span>
          </>
        )}
        {/* No spacer needed - both MCP/API and native tools now have flex-1 on their compound spans */}
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
  /** Session folder path for stripping from file paths in tool display */
  sessionFolderPath?: string
  /** Display mode: 'detailed' shows all info, 'informative' hides MCP/API names and params */
  displayMode?: 'informative' | 'detailed'
}

/**
 * Renders a Task subagent with its child activities grouped together.
 * Provides visual containment and collapsible children.
 */
function ActivityGroupRow({ group, expandedGroups: externalExpandedGroups, onExpandedGroupsChange, onOpenActivityDetails, animationIndex = 0, sessionFolderPath, displayMode = 'detailed' }: ActivityGroupRowProps) {
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
        <ActivityStatusIcon status={group.parent.status} toolName={group.parent.toolName} />

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
                    sessionFolderPath={sessionFolderPath}
                    displayMode={displayMode}
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
  /** Card variant - 'response' for AI messages, 'plan' for plan messages */
  variant?: 'response' | 'plan'
  /** Underlying message ID for annotation actions */
  messageId?: string
  /** Persisted annotations for this response */
  annotations?: AnnotationV1[]
  /** Callback when user accepts the plan (plan variant only) */
  onAccept?: () => void
  /** Callback when user accepts the plan with compaction (compact first, then execute) */
  onAcceptWithCompact?: () => void
  /** Whether this is the last response in the session (shows Accept Plan button only for last response) */
  isLastResponse?: boolean
  /** Whether to show the Accept Plan button (default: true) */
  showAcceptPlan?: boolean
  /** Hide footer for compact embedding (EditPopover) */
  compactMode?: boolean
  /** Callback to branch the session from this response */
  onBranch?: (options?: { newPanel?: boolean }) => void
  /** Callback to add annotation from selected text */
  onAddAnnotation?: (messageId: string, annotation: AnnotationV1) => void
  /** Callback to remove persisted annotation */
  onRemoveAnnotation?: (messageId: string, annotationId: string) => void
  /** Callback to update persisted annotation */
  onUpdateAnnotation?: (messageId: string, annotationId: string, patch: Partial<AnnotationV1>) => void
  /** Input send key behavior used by follow-up editor */
  sendMessageKey?: 'enter' | 'cmd-enter'
}

interface BranchDropdownProps {
  onBranch: (options?: { newPanel?: boolean }) => void
}

function BranchDropdown({ onBranch }: BranchDropdownProps) {
  const handleBranchClick = () => {
    onBranch({ newPanel: true })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Branch options"
          title="Branch"
          className={cn(
            "p-1 rounded-[4px] transition-colors select-none",
            "text-muted-foreground hover:text-foreground hover:bg-foreground/5",
            "data-[state=open]:text-foreground data-[state=open]:bg-foreground/5",
            "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          )}
        >
          <GitBranch className={SIZE_CONFIG.iconSize} />
        </button>
      </DropdownMenuTrigger>

      <StyledDropdownMenuContent align="end" minWidth="min-w-64" sideOffset={6}>
        <StyledDropdownMenuItem onClick={handleBranchClick} className="items-start py-2">
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] leading-tight">Branch From This message</span>
            <span className="max-w-[220px] whitespace-normal text-xs leading-tight text-muted-foreground">
              Explore an alternate direction without disrupting this conversation’s flow.
            </span>
          </div>
        </StyledDropdownMenuItem>
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}

const MAX_HEIGHT = 540

const ANNOTATION_PREFIX_SUFFIX_WINDOW = 24
const SELECTION_MENU_VIEWPORT_PADDING = 12
const SELECTION_MENU_DEFAULT_WIDTH_ESTIMATE = 192
const SELECTION_POINTER_MAX_AGE_MS = 1500
const SELECTION_MENU_DEFAULT_START_SCALE = 0.25
const SELECTION_MENU_MIN_ENTRY_DISTANCE = 20
const SELECTION_MENU_MAX_ENTRY_DISTANCE = 132
const SELECTION_MENU_FALLBACK_ENTRY_DISTANCE = 44
const SELECTION_MENU_SPEED_TO_DISTANCE_FACTOR = 0.065

type SelectionMenuView = 'compact' | 'confirm-follow-up'

type PointerSnapshot = {
  x: number
  y: number
  ts: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function buildSelectionEntryTransition(from: PointerSnapshot | null, to: PointerSnapshot | null): IslandTransitionConfig {
  if (!from || !to) {
    return {
      entryAngleDeg: 90,
      entryDistancePx: SELECTION_MENU_FALLBACK_ENTRY_DISTANCE,
      entryStartScale: SELECTION_MENU_DEFAULT_START_SCALE,
    }
  }

  const dx = to.x - from.x
  const dy = to.y - from.y
  const distancePx = Math.hypot(dx, dy)
  const deltaMs = Math.max(12, to.ts - from.ts)
  const speedPxPerSec = distancePx / (deltaMs / 1000)

  // Pointer deltas use screen coordinates (Y grows downward). Flip Y to avoid vertical mirroring,
  // then add 180° so the island comes from *behind* the drag direction ("catching up" effect).
  // Example: drag left -> right => origin from left.
  const angleDeg = (Math.atan2(-dy, dx) * 180 / Math.PI + 540) % 360
  const derivedDistancePx = clamp(
    speedPxPerSec * SELECTION_MENU_SPEED_TO_DISTANCE_FACTOR,
    SELECTION_MENU_MIN_ENTRY_DISTANCE,
    SELECTION_MENU_MAX_ENTRY_DISTANCE,
  )

  return {
    entryAngleDeg: Number.isFinite(angleDeg) ? angleDeg : 90,
    entryDistancePx: Number.isFinite(derivedDistancePx) ? derivedDistancePx : SELECTION_MENU_FALLBACK_ENTRY_DISTANCE,
    entryStartScale: SELECTION_MENU_DEFAULT_START_SCALE,
  }
}

function buildAnnotationChipEntryTransition(): IslandTransitionConfig {
  return {
    entryAngleDeg: 90,
    entryDistancePx: 64,
    entryStartScale: SELECTION_MENU_DEFAULT_START_SCALE,
  }
}

type ActiveAnnotationDetail = {
  annotationId: string
  index: number
  anchorX: number
  anchorY: number
}

type PendingTextAnnotationSelection = {
  start: number
  end: number
  selectedText: string
  prefix: string
  suffix: string
  anchorX: number
  anchorY: number
}

type AnnotationOverlayRect = {
  id: string
  left: number
  top: number
  width: number
  height: number
  color: string
}

type AnnotationOverlayChip = {
  id: string
  index: number
  left: number
  top: number
}

function hasExistingTextRangeAnnotation(
  annotations: AnnotationV1[] | undefined,
  start: number,
  end: number,
): boolean {
  return (annotations ?? []).some(annotation => {
    const pos = annotation.target.selectors.find(s => s.type === 'text-position') as Extract<
      AnnotationV1['target']['selectors'][number],
      { type: 'text-position' }
    > | undefined
    return pos?.start === start && pos?.end === end
  })
}

function createSelectionPreviewAnnotation(
  messageId: string,
  selection: Omit<PendingTextAnnotationSelection, 'anchorX' | 'anchorY'>,
): AnnotationV1 {
  return {
    id: '__pending-selection-preview__',
    schemaVersion: 1,
    createdAt: Date.now(),
    intent: 'highlight',
    body: [{ type: 'highlight' }],
    target: {
      source: {
        sessionId: '',
        messageId,
      },
      selectors: [
        { type: 'text-position', start: selection.start, end: selection.end },
        {
          type: 'text-quote',
          exact: selection.selectedText,
          prefix: selection.prefix,
          suffix: selection.suffix,
        },
      ],
    },
    style: { color: 'yellow' },
    meta: {
      ephemeral: true,
      source: 'follow-up-selection-preview',
    },
  }
}

function createTextSelectionAnnotation(
  messageId: string,
  selection: Omit<PendingTextAnnotationSelection, 'anchorX' | 'anchorY'>,
  followUpNote?: string,
): AnnotationV1 {
  const note = followUpNote?.trim() ?? ''
  const hasNote = note.length > 0

  return {
    id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    schemaVersion: 1,
    createdAt: Date.now(),
    intent: hasNote ? 'comment' : 'highlight',
    body: hasNote
      ? [{ type: 'highlight' }, { type: 'note', text: note, format: 'plain' }]
      : [{ type: 'highlight' }],
    target: {
      source: {
        sessionId: '',
        messageId,
      },
      selectors: [
        { type: 'text-position', start: selection.start, end: selection.end },
        {
          type: 'text-quote',
          exact: selection.selectedText,
          prefix: selection.prefix,
          suffix: selection.suffix,
        },
      ],
    },
    style: { color: 'yellow' },
    ...(hasNote
      ? {
          meta: {
            followUp: {
              text: note,
              createdAt: Date.now(),
            },
          },
        }
      : {}),
  }
}

function clampSelectionMenuAnchorX(anchorX: number, islandWidth: number): number {
  const safeWidth = Math.max(1, islandWidth)
  const halfWidth = safeWidth / 2
  const minX = SELECTION_MENU_VIEWPORT_PADDING + halfWidth
  const maxX = window.innerWidth - SELECTION_MENU_VIEWPORT_PADDING - halfWidth

  if (maxX < minX) {
    return window.innerWidth / 2
  }

  return Math.min(Math.max(anchorX, minX), maxX)
}

function annotationColorToCss(color?: string): string {
  switch (color) {
    case 'green':
      return 'rgba(74, 222, 128, 0.10)'
    case 'blue':
      return 'rgba(96, 165, 250, 0.10)'
    case 'pink':
      return 'rgba(244, 114, 182, 0.10)'
    case 'yellow':
    default:
      return 'color-mix(in srgb, var(--info) 10%, transparent)'
  }
}

function collectTextSegments(root: HTMLElement): Array<{ node: Text; start: number; end: number }> {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const segments: Array<{ node: Text; start: number; end: number }> = []
  let cursor = 0
  let current = walker.nextNode()
  while (current) {
    const node = current as Text
    const parent = node.parentElement

    // Ignore synthetic annotation overlay/index content in text/offset math.
    if (parent?.closest('[data-ca-annotation-overlay]') || parent?.closest('[data-ca-annotation-index]')) {
      current = walker.nextNode()
      continue
    }

    const len = node.nodeValue?.length ?? 0
    segments.push({ node, start: cursor, end: cursor + len })
    cursor += len
    current = walker.nextNode()
  }
  return segments
}

function getCanonicalText(root: HTMLElement): string {
  return collectTextSegments(root)
    .map(segment => segment.node.nodeValue || '')
    .join('')
}

function resolveNodeOffset(root: HTMLElement, targetNode: Node, nodeOffset: number): number | null {
  const segments = collectTextSegments(root)
  for (const segment of segments) {
    if (segment.node === targetNode) {
      return segment.start + nodeOffset
    }
  }

  // Fallback: range boundaries may land on element nodes (common with reverse drags).
  // In that case, derive character offset by measuring canonical text length
  // from root start to the boundary, excluding synthetic annotation index badges.
  try {
    const probe = document.createRange()
    probe.selectNodeContents(root)
    probe.setEnd(targetNode, nodeOffset)

    const fragment = probe.cloneContents()
    fragment.querySelectorAll('[data-ca-annotation-index]').forEach(node => node.remove())
    return (fragment.textContent || '').length
  } catch {
    return null
  }
}

function resolveRangeFromOffsets(root: HTMLElement, start: number, end: number): Range | null {
  if (end <= start) return null

  const segments = collectTextSegments(root)
  if (segments.length === 0) return null

  let startNode: Text | null = null
  let startOffset = 0
  let endNode: Text | null = null
  let endOffset = 0

  for (const segment of segments) {
    const segmentLength = segment.end - segment.start

    if (!startNode && start >= segment.start && start <= segment.end) {
      startNode = segment.node
      startOffset = Math.min(Math.max(0, start - segment.start), segmentLength)
    }

    if (!endNode && end >= segment.start && end <= segment.end) {
      endNode = segment.node
      endOffset = Math.min(Math.max(0, end - segment.start), segmentLength)
    }

    if (startNode && endNode) break
  }

  if (!startNode || !endNode) return null

  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  return range
}

function getClientRectsForOffsets(root: HTMLElement, start: number, end: number): DOMRect[] {
  if (end <= start) return []

  const segments = collectTextSegments(root)
  const rects: DOMRect[] = []

  for (const segment of segments) {
    if (segment.end <= start || segment.start >= end) continue

    const localStart = Math.max(start, segment.start) - segment.start
    const localEnd = Math.min(end, segment.end) - segment.start
    if (localEnd <= localStart) continue

    const segmentRange = document.createRange()
    segmentRange.setStart(segment.node, localStart)
    segmentRange.setEnd(segment.node, localEnd)

    rects.push(...Array.from(segmentRange.getClientRects()))
  }

  return rects.filter((rect) => rect.width > 0 && rect.height > 0)
}

function consolidateRectsByLine(rects: AnnotationOverlayRect[]): AnnotationOverlayRect[] {
  if (rects.length <= 1) return rects

  const sorted = rects.slice().sort((a, b) => (Math.abs(a.top - b.top) <= 2 ? a.left - b.left : a.top - b.top))
  const rows: Array<{ top: number; rects: AnnotationOverlayRect[] }> = []

  for (const rect of sorted) {
    const row = rows.find(candidate => Math.abs(candidate.top - rect.top) <= 2)
    if (row) {
      row.rects.push(rect)
    } else {
      rows.push({ top: rect.top, rects: [rect] })
    }
  }

  const consolidated: AnnotationOverlayRect[] = []
  for (const row of rows) {
    const rowRects = row.rects.slice().sort((a, b) => a.left - b.left)
    const first = rowRects[0]
    const last = rowRects[rowRects.length - 1]
    if (!first || !last) continue

    const top = Math.min(...rowRects.map(rect => rect.top))
    const height = Math.max(...rowRects.map(rect => rect.height))
    consolidated.push({
      id: first.id,
      color: first.color,
      left: first.left,
      top,
      width: (last.left + last.width) - first.left,
      height,
    })
  }

  return consolidated
}

function clearAnnotationMarks(root: HTMLElement): void {
  const annotatedInlineCodeNodes = root.querySelectorAll<HTMLElement>('code[data-ca-annotation-inline-code="true"]')
  annotatedInlineCodeNodes.forEach((codeNode) => {
    codeNode.removeAttribute('data-ca-annotation-inline-code')
    codeNode.style.backgroundColor = ''
    codeNode.style.boxShadow = ''
  })

  const marks = root.querySelectorAll('span[data-ca-annotation-id]')
  marks.forEach(mark => {
    const parent = mark.parentNode
    if (!parent) return

    const badge = mark.querySelector('[data-ca-annotation-index]')
    if (badge) badge.remove()

    parent.replaceChild(document.createTextNode(mark.textContent || ''), mark)
    parent.normalize()
  })
}

function createAnnotationIndexBadge(index: number): HTMLSpanElement {
  const chip = document.createElement('span')
  chip.setAttribute('data-ca-annotation-index', String(index))
  chip.textContent = String(index)
  chip.style.position = 'absolute'
  chip.style.top = '-7px'
  chip.style.right = '-7px'
  chip.style.minWidth = '16px'
  chip.style.height = '15px'
  chip.style.padding = '0 3px'
  chip.style.borderRadius = '9999px'
  chip.style.backgroundColor = 'var(--info)'
  chip.style.color = 'rgba(15, 23, 42, 0.95)'
  chip.style.fontSize = '10px'
  chip.style.fontWeight = '600'
  chip.style.lineHeight = '15px'
  chip.style.textAlign = 'center'
  chip.classList.add('shadow-tinted')
  chip.style.setProperty('--shadow-color', 'var(--info-rgb)')
  chip.style.pointerEvents = 'none'
  chip.style.userSelect = 'none'
  return chip
}

function applyTextHighlightRange(
  root: HTMLElement,
  range: { start: number; end: number },
  annotation: AnnotationV1,
  annotationIndex?: number,
): void {
  if (range.end <= range.start) return

  // Avoid visually highlighting trailing/leading hard newlines.
  // Those can produce extra apparent blank lines at line boundaries.
  const fullText = getCanonicalText(root)
  let displayStart = range.start
  let displayEnd = range.end
  while (displayStart < displayEnd && /[\n\r]/.test(fullText[displayStart] ?? '')) displayStart += 1
  while (displayEnd > displayStart && /[\n\r]/.test(fullText[displayEnd - 1] ?? '')) displayEnd -= 1
  if (displayEnd <= displayStart) return

  const segments = collectTextSegments(root)
  const createdMarks: HTMLSpanElement[] = []

  for (const segment of segments) {
    if (segment.end <= displayStart || segment.start >= displayEnd) continue

    const localStart = Math.max(displayStart, segment.start) - segment.start
    const localEnd = Math.min(displayEnd, segment.end) - segment.start
    if (localEnd <= localStart) continue

    const source = segment.node
    const after = source.splitText(localEnd)
    const selected = source.splitText(localStart)

    const inlineCodeParent = selected.parentElement?.closest<HTMLElement>('code')
    if (inlineCodeParent) {
      inlineCodeParent.setAttribute('data-ca-annotation-inline-code', 'true')
      inlineCodeParent.style.backgroundColor = annotationColorToCss(annotation.style?.color)
      inlineCodeParent.style.boxShadow = 'none'
    }

    const mark = document.createElement('span')
    mark.setAttribute('data-ca-annotation-id', annotation.id)
    mark.style.backgroundColor = annotationColorToCss(annotation.style?.color)
    mark.style.borderRadius = '0'
    mark.style.padding = '0'
    mark.style.margin = '0'
    mark.style.position = 'relative'
    selected.parentNode?.replaceChild(mark, selected)
    mark.appendChild(selected)
    createdMarks.push(mark)

    // Keep reference alive for TS and clarity
    void after
  }

  if (createdMarks.length > 0) {
    type RowBucket = { top: number; marks: HTMLSpanElement[] }
    const rows: RowBucket[] = []

    for (const mark of createdMarks) {
      const rect = mark.getBoundingClientRect()
      const row = rows.find(candidate => Math.abs(candidate.top - rect.top) <= 2)
      if (row) {
        row.marks.push(mark)
      } else {
        rows.push({ top: rect.top, marks: [mark] })
      }
    }

    for (const row of rows) {
      const rowMarks = row.marks
      const first = rowMarks[0]
      const last = rowMarks[rowMarks.length - 1]
      if (!first || !last) continue

      first.style.borderTopLeftRadius = '6px'
      first.style.borderBottomLeftRadius = '6px'
      last.style.borderTopRightRadius = '6px'
      last.style.borderBottomRightRadius = '6px'
    }
  }

  if (annotationIndex != null && createdMarks.length > 0) {
    // Prefer placing the index badge on non-code marks, then choose the top-right-most
    // mark on the first visible row for stable placement.
    const nonCodeMarks = createdMarks.filter(mark => !mark.closest('code'))
    const badgePool = nonCodeMarks.length > 0 ? nonCodeMarks : createdMarks

    const preferredInitial = badgePool[0]
    if (!preferredInitial) return

    let preferredMark = preferredInitial
    let preferredRect = preferredMark.getBoundingClientRect()

    for (const mark of badgePool.slice(1)) {
      const rect = mark.getBoundingClientRect()
      const isHigherRow = rect.top < preferredRect.top - 1
      const sameRow = Math.abs(rect.top - preferredRect.top) <= 2
      const isMoreRight = rect.right > preferredRect.right

      if (isHigherRow || (sameRow && isMoreRight)) {
        preferredMark = mark
        preferredRect = rect
      }
    }

    preferredMark.appendChild(createAnnotationIndexBadge(annotationIndex))
  }
}

function clearBlockAnnotationMarkers(root: HTMLElement): void {
  const blocks = root.querySelectorAll<HTMLElement>('[data-ca-block-annotated="true"]')
  blocks.forEach((block) => {
    block.removeAttribute('data-ca-block-annotated')
    block.style.boxShadow = ''
    block.style.borderRadius = ''
  })
}

function applyBlockAnnotationMarker(root: HTMLElement, annotation: AnnotationV1): void {
  const blockSelector = annotation.target.selectors.find(s => s.type === 'block') as Extract<
    AnnotationV1['target']['selectors'][number],
    { type: 'block' }
  > | undefined

  if (!blockSelector) return

  const selector = blockSelector.blockId
    ? `[data-ca-block-id="${CSS.escape(blockSelector.blockId)}"]`
    : `[data-ca-block-path="${CSS.escape(blockSelector.path)}"]`

  const target = root.querySelector<HTMLElement>(selector)
  if (!target) return

  target.setAttribute('data-ca-block-annotated', 'true')
  const markerColor = annotationColorToCss(annotation.style?.color)
  target.style.boxShadow = [
    `inset 3px 0 0 ${markerColor}`,
    `inset 0 1px 0 ${markerColor}`,
    `inset 0 -1px 0 ${markerColor}`,
  ].join(', ')
  target.style.borderRadius = '6px'
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
  variant = 'response',
  messageId,
  annotations,
  onAccept,
  onAcceptWithCompact,
  isLastResponse = true,
  showAcceptPlan = true,
  compactMode = false,
  onBranch,
  onAddAnnotation,
  onRemoveAnnotation,
  onUpdateAnnotation,
  sendMessageKey = 'enter',
}: ResponseCardProps) {
  // Throttled content for display - updates every CONTENT_THROTTLE_MS during streaming
  const [displayedText, setDisplayedText] = useState(text)
  const lastUpdateRef = useRef(Date.now())
  // Copy to clipboard state
  const [copied, setCopied] = useState(false)
  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState(false)
  // Dark mode detection - scroll fade only shown in dark mode
  const [isDarkMode, setIsDarkMode] = useState(false)
  // Pending text selection waiting for explicit follow-up action
  const [pendingSelection, setPendingSelection] = useState<PendingTextAnnotationSelection | null>(null)
  const [selectionMenuView, setSelectionMenuView] = useState<SelectionMenuView>('compact')
  const [followUpDraft, setFollowUpDraft] = useState('')
  const [activeAnnotationDetail, setActiveAnnotationDetail] = useState<ActiveAnnotationDetail | null>(null)
  const [activeSelectionMenuSize, setActiveSelectionMenuSize] = useState<IslandActiveViewSize | null>(null)
  const [selectionMenuRenderAnchor, setSelectionMenuRenderAnchor] = useState<{ x: number; y: number } | null>(null)
  const [selectionMenuRenderSourceKey, setSelectionMenuRenderSourceKey] = useState('none')
  const [isSelectionMenuVisible, setIsSelectionMenuVisible] = useState(false)
  const [selectionMenuTransitionConfig, setSelectionMenuTransitionConfig] = useState<IslandTransitionConfig>(
    buildAnnotationChipEntryTransition()
  )
  const [annotationOverlay, setAnnotationOverlay] = useState<{ rects: AnnotationOverlayRect[]; chips: AnnotationOverlayChip[] }>({ rects: [], chips: [] })
  const contentRef = useRef<HTMLDivElement>(null)
  const contentLayerRef = useRef<HTMLDivElement>(null)
  const selectionMenuRef = useRef<HTMLDivElement>(null)
  const lastPointerRef = useRef<PointerSnapshot | null>(null)
  const dragStartPointerRef = useRef<PointerSnapshot | null>(null)
  const selectionStartedInContentRef = useRef(false)

  // Detect dark mode from document class and listen for changes
  useEffect(() => {
    const checkDarkMode = () => {
      setIsDarkMode(document.documentElement.classList.contains('dark'))
    }
    checkDarkMode()

    // Observe class changes on documentElement for theme switches
    const observer = new MutationObserver(checkDarkMode)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  const closeSelectionMenu = useCallback(() => {
    setPendingSelection(null)
    setSelectionMenuView('compact')
    setFollowUpDraft('')
    setActiveAnnotationDetail(null)
  }, [])

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [text])

  const renderedAnnotations = useMemo(() => {
    const persisted = annotations ?? []

    if (!pendingSelection || selectionMenuView !== 'confirm-follow-up' || !messageId) {
      return persisted
    }

    if (hasExistingTextRangeAnnotation(persisted, pendingSelection.start, pendingSelection.end)) {
      return persisted
    }

    return [
      ...persisted,
      createSelectionPreviewAnnotation(messageId, pendingSelection),
    ]
  }, [annotations, pendingSelection, selectionMenuView, messageId])

  const activeAnnotation = useMemo(() => {
    if (!activeAnnotationDetail) return null
    return (annotations ?? []).find(annotation => annotation.id === activeAnnotationDetail.annotationId) ?? null
  }, [annotations, activeAnnotationDetail])

  useEffect(() => {
    if (!activeAnnotationDetail) return
    if (!activeAnnotation) {
      closeSelectionMenu()
    }
  }, [activeAnnotationDetail, activeAnnotation, closeSelectionMenu])

  useEffect(() => {
    const root = contentLayerRef.current
    if (!root) {
      setAnnotationOverlay({ rects: [], chips: [] })
      return
    }

    const recomputeOverlay = () => {
      clearAnnotationMarks(root)
      clearBlockAnnotationMarkers(root)

      if (!renderedAnnotations.length) {
        setAnnotationOverlay({ rects: [], chips: [] })
        return
      }

      const fullText = getCanonicalText(root)
      const resolution = resolveTextAnnotations(fullText, renderedAnnotations)
      const annotationIndexById = new Map((annotations ?? []).map((annotation, idx) => [annotation.id, idx + 1]))
      const rootRect = root.getBoundingClientRect()

      const rects: AnnotationOverlayRect[] = []
      const chips: AnnotationOverlayChip[] = []

      for (const item of resolution.resolved) {
        const rawRects = getClientRectsForOffsets(root, item.range.start, item.range.end)
          .map(rect => ({
            id: item.annotation.id,
            left: rect.left - rootRect.left,
            top: rect.top - rootRect.top,
            width: rect.width,
            height: rect.height,
            color: annotationColorToCss(item.annotation.style?.color),
          }))

        const lineRects = consolidateRectsByLine(rawRects)
        rects.push(...lineRects)

        const annotationIndex = annotationIndexById.get(item.annotation.id)
        if (annotationIndex != null && lineRects.length > 0) {
          const minTop = Math.min(...lineRects.map(rect => rect.top))
          const topRowRects = lineRects.filter(rect => Math.abs(rect.top - minTop) <= 2)
          const anchorRect = topRowRects.reduce((best, rect) => {
            const bestRight = best.left + best.width
            const rectRight = rect.left + rect.width
            return rectRight > bestRight ? rect : best
          })

          chips.push({
            id: item.annotation.id,
            index: annotationIndex,
            left: anchorRect.left + anchorRect.width,
            top: anchorRect.top,
          })
        }
      }

      for (const annotation of renderedAnnotations) {
        applyBlockAnnotationMarker(root, annotation)
      }

      setAnnotationOverlay({ rects, chips })

      if (process.env.NODE_ENV !== 'production' && resolution.unresolved.length > 0) {
        console.debug('[annotations] unresolved annotations', {
          count: resolution.unresolved.length,
          ids: resolution.unresolved.map(item => item.annotation.id),
          reasons: resolution.unresolved.map(item => item.reason),
        })
      }
    }

    recomputeOverlay()
    window.addEventListener('resize', recomputeOverlay)
    return () => {
      window.removeEventListener('resize', recomputeOverlay)
    }
  }, [annotations, renderedAnnotations, text, displayedText, isStreaming])

  useEffect(() => {
    if (variant !== 'response' || isStreaming || !messageId) {
      closeSelectionMenu()
    }
  }, [variant, isStreaming, messageId, closeSelectionMenu])

  useEffect(() => {
    if (!pendingSelection && !activeAnnotationDetail) return

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (selectionMenuRef.current?.contains(target)) return
      closeSelectionMenu()
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return

      if (selectionMenuView !== 'compact') {
        event.preventDefault()
        setSelectionMenuView('compact')
        setFollowUpDraft('')
        setActiveAnnotationDetail(null)
        return
      }

      closeSelectionMenu()
    }

    const handleScroll = (event: Event) => {
      const target = event.target as Node | null

      // Never auto-dismiss while in expanded island views.
      if (selectionMenuView !== 'compact') {
        return
      }

      // Ignore scroll events originating from inside the island.
      if (target && selectionMenuRef.current?.contains(target)) {
        return
      }

      closeSelectionMenu()
    }

    const handleSelectionChange = () => {
      const root = contentLayerRef.current
      if (!root) {
        closeSelectionMenu()
        return
      }

      const selection = window.getSelection()
      // Keep the island open if selection was programmatically cleared by a render update.
      // This happens during streaming/DOM reconciliation and should not dismiss follow-up UI.
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        return
      }

      const range = selection.getRangeAt(0)
      const common = range.commonAncestorContainer
      const commonElement = common.nodeType === Node.ELEMENT_NODE
        ? common as Element
        : common.parentElement

      // Selecting text inside the island (e.g. follow-up textarea) should not close it.
      if (commonElement && selectionMenuRef.current?.contains(commonElement)) {
        return
      }

      if (!root.contains(common)) {
        closeSelectionMenu()
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    window.addEventListener('scroll', handleScroll, true)
    document.addEventListener('selectionchange', handleSelectionChange)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
      window.removeEventListener('scroll', handleScroll, true)
      document.removeEventListener('selectionchange', handleSelectionChange)
    }
  }, [pendingSelection, activeAnnotationDetail, closeSelectionMenu, selectionMenuView])

  const handleSelectionMenuMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null
    if (target?.closest('textarea, input, [contenteditable="true"], [role="textbox"]')) {
      return
    }

    event.preventDefault()
  }, [])

  const handleOpenFollowUpView = useCallback(() => {
    if (!pendingSelection) return

    // Native browser selection steals typing focus from the follow-up textarea.
    // Keep semantic selection in pendingSelection and clear only the DOM selection.
    window.getSelection()?.removeAllRanges()
    setActiveAnnotationDetail(null)
    setSelectionMenuView('confirm-follow-up')
  }, [pendingSelection])

  const handleSubmitFollowUp = useCallback((note: string) => {
    const normalizedNote = note.trim()

    if (!messageId) return

    if (activeAnnotationDetail) {
      if (!onUpdateAnnotation || !activeAnnotation) {
        closeSelectionMenu()
        return
      }

      const existingOtherBodies = activeAnnotation.body.filter(body => body.type !== 'highlight' && body.type !== 'note')
      const nextBody: AnnotationV1['body'] = [
        { type: 'highlight' },
        ...(normalizedNote.length > 0 ? [{ type: 'note', text: normalizedNote, format: 'plain' } as const] : []),
        ...existingOtherBodies,
      ]

      const nextMeta = { ...(activeAnnotation.meta ?? {}) }
      delete nextMeta.followUp

      onUpdateAnnotation(messageId, activeAnnotationDetail.annotationId, {
        body: nextBody,
        intent: normalizedNote.length > 0 ? 'comment' : 'highlight',
        updatedAt: Date.now(),
        meta: normalizedNote.length > 0
          ? {
              ...nextMeta,
              followUp: {
                text: normalizedNote,
                updatedAt: Date.now(),
              },
            }
          : (Object.keys(nextMeta).length > 0 ? nextMeta : undefined),
      })

      closeSelectionMenu()
      return
    }

    if (!onAddAnnotation || !pendingSelection) return

    if (hasExistingTextRangeAnnotation(annotations, pendingSelection.start, pendingSelection.end)) {
      closeSelectionMenu()
      return
    }

    const annotation = createTextSelectionAnnotation(messageId, pendingSelection, normalizedNote)
    onAddAnnotation(messageId, annotation)
    closeSelectionMenu()
    window.getSelection()?.removeAllRanges()
  }, [
    messageId,
    activeAnnotationDetail,
    activeAnnotation,
    onUpdateAnnotation,
    onAddAnnotation,
    pendingSelection,
    annotations,
    closeSelectionMenu,
  ])

  const handleCancelFollowUp = useCallback(() => {
    setFollowUpDraft('')

    if (!pendingSelection) {
      closeSelectionMenu()
      return
    }

    setSelectionMenuView('compact')
    setActiveAnnotationDetail(null)

    if (typeof window === 'undefined') {
      return
    }

    window.requestAnimationFrame(() => {
      const root = contentLayerRef.current
      if (!root) return

      const range = resolveRangeFromOffsets(root, pendingSelection.start, pendingSelection.end)
      if (!range) return

      const selection = window.getSelection()
      if (!selection) return

      selection.removeAllRanges()
      selection.addRange(range)
    })
  }, [pendingSelection, closeSelectionMenu])

  const handleOpenAnnotationDetail = useCallback((annotationId: string, index: number, anchorX: number, anchorY: number) => {
    const annotation = (annotations ?? []).find(item => item.id === annotationId)
    const noteBody = annotation?.body.find(body => body.type === 'note') as Extract<
      AnnotationV1['body'][number],
      { type: 'note' }
    > | undefined

    setSelectionMenuTransitionConfig(buildAnnotationChipEntryTransition())
    setPendingSelection(null)
    setFollowUpDraft(noteBody?.text ?? '')
    setActiveAnnotationDetail({ annotationId, index, anchorX, anchorY })
    setSelectionMenuView('confirm-follow-up')
  }, [annotations])

  const handleDeleteActiveAnnotation = useCallback(() => {
    if (!onRemoveAnnotation || !messageId || !activeAnnotationDetail) return

    onRemoveAnnotation(messageId, activeAnnotationDetail.annotationId)
    closeSelectionMenu()
  }, [onRemoveAnnotation, messageId, activeAnnotationDetail, closeSelectionMenu])

  const handleSelectionPointerDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    selectionStartedInContentRef.current = true
    const snapshot = {
      x: event.clientX,
      y: event.clientY,
      ts: Date.now(),
    }

    dragStartPointerRef.current = snapshot
    lastPointerRef.current = snapshot
  }, [])

  const showSelectionMenuFromCurrentSelection = useCallback(() => {
    const root = contentLayerRef.current
    if (!root) return

    requestAnimationFrame(() => {
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        closeSelectionMenu()
        return
      }

      const range = selection.getRangeAt(0)
      if (!root.contains(range.commonAncestorContainer)) {
        closeSelectionMenu()
        return
      }

      const start = resolveNodeOffset(root, range.startContainer, range.startOffset)
      const end = resolveNodeOffset(root, range.endContainer, range.endOffset)
      if (start == null || end == null || end <= start) {
        closeSelectionMenu()
        return
      }

      const selectedText = range.toString()
      if (!selectedText || !/\S/.test(selectedText)) {
        closeSelectionMenu()
        return
      }

      if (hasExistingTextRangeAnnotation(annotations, start, end)) {
        closeSelectionMenu()
        return
      }

      const fullText = getCanonicalText(root)
      const prefix = fullText.slice(Math.max(0, start - ANNOTATION_PREFIX_SUFFIX_WINDOW), start)
      const suffix = fullText.slice(end, end + ANNOTATION_PREFIX_SUFFIX_WINDOW)

      // Prefer fragmented client rects over union bounds for wrapped selections.
      // The union rect often produces an x-axis anchor that feels detached.
      const rects = Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0)
      const pointer = lastPointerRef.current
      const hasRecentPointer = Boolean(pointer && (Date.now() - pointer.ts) <= SELECTION_POINTER_MAX_AGE_MS)
      const pointerX = hasRecentPointer && pointer ? pointer.x : null
      const pointerY = hasRecentPointer && pointer ? pointer.y : null

      let anchorRect: DOMRect
      if (rects.length > 0) {
        if (pointerY != null) {
          const rowCandidates = rects.filter(rect => pointerY >= rect.top && pointerY <= rect.bottom)

          if (rowCandidates.length > 0) {
            if (pointerX != null) {
              const xContaining = rowCandidates.filter(rect => pointerX >= rect.left && pointerX <= rect.right)
              if (xContaining.length > 0) {
                anchorRect = xContaining.reduce((best, rect) => (rect.width > best.width ? rect : best))
              } else {
                anchorRect = rowCandidates.reduce((best, rect) => {
                  const bestDistance = Math.min(Math.abs(pointerX - best.left), Math.abs(pointerX - best.right))
                  const rectDistance = Math.min(Math.abs(pointerX - rect.left), Math.abs(pointerX - rect.right))
                  return rectDistance < bestDistance ? rect : best
                })
              }
            } else {
              anchorRect = rowCandidates.reduce((best, rect) => (rect.width > best.width ? rect : best))
            }
          } else {
            anchorRect = rects.reduce((best, rect) => {
              const bestDistance = Math.abs((best.top + best.bottom) / 2 - pointerY)
              const rectDistance = Math.abs((rect.top + rect.bottom) / 2 - pointerY)
              return rectDistance < bestDistance ? rect : best
            })
          }
        } else {
          anchorRect = rects.reduce((best, rect) => (rect.top < best.top ? rect : best))
        }
      } else {
        anchorRect = range.getBoundingClientRect()
      }

      const anchorX = (pointerX != null && pointerX >= anchorRect.left && pointerX <= anchorRect.right)
        ? pointerX
        : anchorRect.left + (anchorRect.width / 2)
      const anchorY = anchorRect.top - 8

      setSelectionMenuTransitionConfig(buildSelectionEntryTransition(dragStartPointerRef.current, pointer))
      setSelectionMenuView('compact')
      setFollowUpDraft('')
      setActiveSelectionMenuSize(null)
      setPendingSelection({
        start,
        end,
        selectedText,
        prefix,
        suffix,
        anchorX,
        anchorY,
      })
      dragStartPointerRef.current = null
    })
  }, [annotations, closeSelectionMenu])

  const handleTextSelection = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!onAddAnnotation || !messageId || variant !== 'response' || isStreaming) return
    const root = contentLayerRef.current
    if (!root) return

    const targetElement = event.target instanceof Element ? event.target : null
    if (targetElement?.closest('[data-ca-annotation-index]')) {
      selectionStartedInContentRef.current = false
      return
    }

    // Mouseup location reflects the user's final intent for popup anchoring.
    lastPointerRef.current = {
      x: event.clientX,
      y: event.clientY,
      ts: Date.now(),
    }

    // Block annotation gesture: Shift+click on a block wrapper
    if (event.shiftKey) {
      const targetElement = event.target instanceof Element ? event.target : null
      const blockElement = targetElement?.closest<HTMLElement>('[data-ca-block-path]')
      if (blockElement) {
        const blockPath = blockElement.getAttribute('data-ca-block-path') || ''
        const blockType = blockElement.getAttribute('data-ca-block-type') || 'paragraph'
        const blockId = blockElement.getAttribute('data-ca-block-id') || undefined

        if (blockPath) {
          const alreadyExists = (annotations ?? []).some(annotation => {
            const blockSelector = annotation.target.selectors.find(s => s.type === 'block') as Extract<
              AnnotationV1['target']['selectors'][number],
              { type: 'block' }
            > | undefined
            if (!blockSelector) return false
            if (blockId && blockSelector.blockId) return blockSelector.blockId === blockId
            return blockSelector.path === blockPath
          })

          if (!alreadyExists) {
            const annotation: AnnotationV1 = {
              id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              schemaVersion: 1,
              createdAt: Date.now(),
              intent: 'highlight',
              body: [{ type: 'highlight' }],
              target: {
                source: {
                  sessionId: '',
                  messageId,
                },
                selectors: [
                  {
                    type: 'block',
                    blockType: blockType as Extract<AnnotationV1['target']['selectors'][number], { type: 'block' }>['blockType'],
                    path: blockPath,
                    ...(blockId ? { blockId } : {}),
                  },
                ],
              },
              style: { color: 'yellow' },
            }
            onAddAnnotation(messageId, annotation)
          }
        }
      }
      selectionStartedInContentRef.current = false
      closeSelectionMenu()
      return
    }

    selectionStartedInContentRef.current = false
    showSelectionMenuFromCurrentSelection()
  }, [onAddAnnotation, messageId, variant, isStreaming, annotations, showSelectionMenuFromCurrentSelection, closeSelectionMenu])

  useEffect(() => {
    if (!onAddAnnotation || !messageId || variant !== 'response' || isStreaming) return

    const handleDocumentMouseUp = (event: MouseEvent) => {
      if (!selectionStartedInContentRef.current) return
      selectionStartedInContentRef.current = false

      // Mouseup location reflects the user's final intent for popup anchoring.
      lastPointerRef.current = {
        x: event.clientX,
        y: event.clientY,
        ts: Date.now(),
      }

      const root = contentLayerRef.current
      if (!root) return

      const target = event.target as Node | null
      if (target && root.contains(target)) {
        // In-bounds mouseup is already handled by onMouseUp on the content container.
        return
      }

      showSelectionMenuFromCurrentSelection()
    }

    document.addEventListener('mouseup', handleDocumentMouseUp)
    return () => {
      document.removeEventListener('mouseup', handleDocumentMouseUp)
    }
  }, [onAddAnnotation, messageId, variant, isStreaming, showSelectionMenuFromCurrentSelection])

  const activeMenuAnchor = useMemo(() => {
    if (pendingSelection) {
      return { x: pendingSelection.anchorX, y: pendingSelection.anchorY }
    }

    if (activeAnnotationDetail) {
      return { x: activeAnnotationDetail.anchorX, y: activeAnnotationDetail.anchorY }
    }

    return null
  }, [pendingSelection, activeAnnotationDetail])

  const selectionMenuSourceKey = useMemo(() => {
    if (pendingSelection) {
      return `selection:${pendingSelection.start}:${pendingSelection.end}`
    }

    if (activeAnnotationDetail) {
      return `annotation:${activeAnnotationDetail.annotationId}`
    }

    return 'none'
  }, [pendingSelection, activeAnnotationDetail])

  useEffect(() => {
    if (activeMenuAnchor) {
      setSelectionMenuRenderAnchor(activeMenuAnchor)
      setSelectionMenuRenderSourceKey(selectionMenuSourceKey)
      setIsSelectionMenuVisible(true)
      return
    }

    setIsSelectionMenuVisible(false)
  }, [activeMenuAnchor, selectionMenuSourceKey])

  const handleSelectionMenuExitComplete = useCallback(() => {
    if (activeMenuAnchor) return
    setSelectionMenuRenderAnchor(null)
    setSelectionMenuRenderSourceKey('none')
    setActiveSelectionMenuSize(null)
  }, [activeMenuAnchor])

  const selectionMenuAnchorX = useMemo(() => {
    if (typeof window === 'undefined') {
      return 0
    }

    if (!selectionMenuRenderAnchor) {
      return window.innerWidth / 2
    }

    const activeWidth = activeSelectionMenuSize?.width ?? SELECTION_MENU_DEFAULT_WIDTH_ESTIMATE
    return clampSelectionMenuAnchorX(selectionMenuRenderAnchor.x, activeWidth)
  }, [selectionMenuRenderAnchor, activeSelectionMenuSize])

  const selectionMenu = selectionMenuRenderAnchor
    ? ReactDOM.createPortal(
        <div
          ref={selectionMenuRef}
          className="fixed z-50"
          style={{
            left: selectionMenuAnchorX,
            top: Math.max(36, selectionMenuRenderAnchor.y),
            transform: 'translate(-50%, -100%)',
          }}
          onMouseDown={handleSelectionMenuMouseDown}
        >
          <Island
            key={selectionMenuRenderSourceKey}
            activeViewId={selectionMenuView}
            radius={12}
            className="border-border/40 bg-background/75 backdrop-blur-xl backdrop-saturate-150 shadow-strong"
            onActiveViewSizeChange={setActiveSelectionMenuSize}
            isVisible={isSelectionMenuVisible}
            onExitComplete={handleSelectionMenuExitComplete}
            transitionConfig={selectionMenuTransitionConfig}
          >
            <IslandContentView id="compact" anchorX="center" anchorY="bottom">
              <div className="p-1 flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleOpenFollowUpView}
                  className={cn(
                    "h-[30px] px-2.5 rounded-[8px] text-[13px] font-medium inline-flex items-center gap-1.5",
                    "text-foreground/85 hover:text-foreground hover:bg-foreground/5",
                    "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  )}
                >
                  <CornerDownRight className="h-3.5 w-3.5" />
                  <span>Follow up</span>
                </button>
              </div>
            </IslandContentView>

            <IslandFollowUpContentView
              id="confirm-follow-up"
              value={followUpDraft}
              onValueChange={setFollowUpDraft}
              onCancel={handleCancelFollowUp}
              onSubmit={handleSubmitFollowUp}
              onDelete={activeAnnotationDetail ? handleDeleteActiveAnnotation : undefined}
              title={activeAnnotationDetail
                ? `Annotation ${activeAnnotationDetail.index ? `#${activeAnnotationDetail.index}` : ''}`
                : 'Follow up'}
              submitLabel={activeAnnotationDetail ? 'Save' : 'Continue'}
              placeholder="Add comments the agent should consider in the next turn…"
              maxInputHeight={320}
              sendMessageKey={sendMessageKey}
              lockScroll
            />

          </Island>
        </div>,
        document.body,
      )
    : null

  const annotationOverlayLayer = (annotationOverlay.rects.length > 0 || annotationOverlay.chips.length > 0)
    ? (
      <div data-ca-annotation-overlay className="pointer-events-none absolute inset-0 z-[2]">
        {annotationOverlay.rects.map((rect, idx) => (
          <div
            key={`rect-${rect.id}-${idx}`}
            className="absolute shadow-tinted"
            style={{
              left: rect.left - 4,
              top: rect.top - 1,
              width: rect.width + 8,
              height: rect.height + 2,
              backgroundColor: rect.color,
              borderRadius: '4px',
              ['--shadow-color' as string]: 'var(--info-rgb)',
              ['--shadow-border-opacity' as string]: '0.14',
              ['--shadow-blur-opacity' as string]: '0.10',
            }}
          />
        ))}
        {annotationOverlay.chips.map((chip) => (
          <button
            key={`chip-${chip.id}`}
            type="button"
            data-ca-annotation-index={String(chip.index)}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              handleOpenAnnotationDetail(chip.id, chip.index, rect.left + rect.width / 2, rect.top - 8)
            }}
            className="absolute shadow-tinted pointer-events-auto cursor-pointer hover:bg-foreground/10 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            style={{
              left: chip.left,
              top: chip.top,
              transform: 'translate(-2px, -8px)',
              minWidth: '16px',
              height: '15px',
              padding: '0 3px',
              borderRadius: '4px',
              backgroundColor: 'color-mix(in srgb, var(--info) 30%, var(--background))',
              color: 'rgba(15, 23, 42, 0.95)',
              fontSize: '10px',
              fontWeight: '600',
              lineHeight: '15px',
              textAlign: 'center',
              userSelect: 'none',
              position: 'absolute',
              ['--shadow-color' as string]: 'var(--info-rgb)',
              ['--shadow-border-opacity' as string]: '0.14',
              ['--shadow-blur-opacity' as string]: '0.10',
            }}
          >
            {chip.index}
          </button>
        ))}
      </div>
    )
    : null

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
              "absolute top-2 right-2 p-1 rounded-[6px] transition-all z-10 select-none",
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
                "px-4 py-2 border-b border-border/30 flex items-center gap-2 bg-success/5 select-none",
                SIZE_CONFIG.fontSize
              )}
            >
              <ListTodo className={cn(SIZE_CONFIG.iconSize, "text-success")} />
              <span className="font-medium text-success">Plan</span>
            </div>
          )}

          {/* Scrollable content area with subtle fade at edges (dark mode only) */}
          <div
            ref={contentRef}
            onMouseDown={handleSelectionPointerDown}
            onMouseUp={handleTextSelection}
            className="pl-[22px] pr-[16px] py-3 text-sm overflow-y-auto scrollbar-hover"
            style={{
              maxHeight: MAX_HEIGHT,
              // Subtle fade at top and bottom edges (16px) - only in dark mode for better contrast
              ...(isDarkMode && {
                maskImage: 'linear-gradient(to bottom, transparent 0%, black 16px, black calc(100% - 16px), transparent 100%)',
                WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 16px, black calc(100% - 16px), transparent 100%)',
              }),
            }}
          >
            <div ref={contentLayerRef} className="relative">
              <Markdown
                mode="minimal"
                onUrlClick={onOpenUrl}
                onFileClick={onOpenFile}
              >
                {text}
              </Markdown>
              {annotationOverlayLayer}
            </div>
          </div>

          {/* Footer with actions - hidden in compact mode */}
          {!compactMode && (
            <div className={cn(
              "pl-4 pr-2.5 py-2 border-t border-border/30 flex items-center justify-between bg-muted/20",
              SIZE_CONFIG.fontSize
            )}>
              {/* Left side - Copy, View as Markdown, Annotation hint */}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleCopy}
                  className={cn(
                    "flex items-center gap-1.5 transition-colors select-none",
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
                      "flex items-center gap-1.5 transition-colors select-none",
                      "text-muted-foreground hover:text-foreground",
                      "focus:outline-none focus-visible:underline"
                    )}
                  >
                    <FileText className={SIZE_CONFIG.iconSize} />
                    <span>Markdown</span>
                  </button>
                )}
              </div>

              {/* Right side */}
              <div className="flex items-center gap-3">
                {/* Accept Plan dropdown (plan variant only, last response) */}
                {isPlan && showAcceptPlan && onAccept && onAcceptWithCompact && (
                  <div
                    className={cn(
                      "flex items-center gap-3 transition-all duration-200",
                      isLastResponse
                        ? "opacity-100 translate-x-0"
                        : "opacity-0 translate-x-2 pointer-events-none"
                    )}
                  >
                    <AcceptPlanDropdown
                      onAccept={onAccept}
                      onAcceptWithCompact={onAcceptWithCompact}
                    />
                  </div>
                )}
                {onBranch && <BranchDropdown onBranch={onBranch} />}
              </div>
            </div>
          )}
        </div>

        {/* Fullscreen overlay for reading response/plan */}
        <DocumentFormattedMarkdownOverlay
          content={text}
          isOpen={isFullscreen}
          onClose={() => setIsFullscreen(false)}
          variant={isPlan ? 'plan' : undefined}
          onOpenUrl={onOpenUrl}
          onOpenFile={onOpenFile}
        />
        {selectionMenu}
      </>
    )
  }

  // Streaming response - show throttled content with spinner
  return (
    <>
      <div className="bg-background shadow-minimal rounded-[8px] overflow-hidden group">
        {/* Content area - uses displayedText (throttled) for performance */}
        {/* Subtle fade at top and bottom edges (dark mode only) */}
        <div
          ref={contentRef}
          onMouseDown={handleSelectionPointerDown}
          onMouseUp={handleTextSelection}
          className="pl-[22px] pr-4 py-3 text-sm overflow-y-auto scrollbar-hover"
          style={{
            maxHeight: MAX_HEIGHT,
            // Subtle fade at top and bottom edges (16px) - only in dark mode for better contrast
            ...(isDarkMode && {
              maskImage: 'linear-gradient(to bottom, transparent 0%, black 16px, black calc(100% - 16px), transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 16px, black calc(100% - 16px), transparent 100%)',
            }),
          }}
        >
          <div ref={contentLayerRef} className="relative">
            <Markdown
              mode="minimal"
              onUrlClick={onOpenUrl}
              onFileClick={onOpenFile}
            >
              {displayedText}
            </Markdown>
            {annotationOverlayLayer}
          </div>
        </div>

        {/* Footer - hidden in compact mode */}
        {!compactMode && (
          <div className={cn("px-4 py-2 border-t border-border/30 flex items-center bg-muted/20", SIZE_CONFIG.fontSize)}>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Spinner className={SIZE_CONFIG.spinnerSize} />
              <span>Streaming...</span>
            </div>
          </div>
        )}
      </div>
      {selectionMenu}
    </>
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
      return <CircleCheck className={cn(SIZE_CONFIG.iconSize, "shrink-0 text-accent")} />
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
  onAcceptPlanWithCompact,
  isLastResponse,
  sessionFolderPath,
  displayMode = 'detailed',
  animateResponse = false,
  compactMode = false,
  onBranch,
  onAddAnnotation,
  onRemoveAnnotation,
  onUpdateAnnotation,
  sendMessageKey = 'enter',
}: TurnCardProps) {
  // Derive the turn phase from props using the state machine.
  // This provides a single source of truth for lifecycle state,
  // replacing the old ad-hoc boolean combinations.
  const turnPhase = useMemo(() => {
    // Construct a minimal turn-like object for deriveTurnPhase
    const turnData: Pick<AssistantTurn, 'isComplete' | 'response' | 'activities'> = {
      isComplete,
      response,
      activities,
    }
    return deriveTurnPhase(turnData as AssistantTurn)
  }, [isComplete, response, activities])

  // Use local state if no controlled state provided
  const [localExpandedTurns, setLocalExpandedTurns] = useState<Set<string>>(() => defaultExpanded ? new Set([turnId]) : new Set())
  const isExpanded = externalIsExpanded ?? localExpandedTurns.has(turnId)

  // Track if user has toggled expansion (skip animation on initial mount)
  const hasUserToggled = useRef(false)

  // Ref for scrollable activities container (to scroll to bottom on expand)
  const activitiesContainerRef = useRef<HTMLDivElement>(null)

  // Track if component has mounted (enable fade-in for new activities after mount)
  const hasMounted = useRef(false)
  useEffect(() => {
    hasMounted.current = true
  }, [])

  const toggleExpanded = useCallback(() => {
    hasUserToggled.current = true
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

  // Scroll to bottom of activities list when user manually expands
  // This shows the most recent step instead of the oldest
  useEffect(() => {
    if (isExpanded && hasUserToggled.current && activitiesContainerRef.current) {
      // Wait for expansion animation to complete (250ms) before scrolling
      const timer = setTimeout(() => {
        activitiesContainerRef.current?.scrollTo({
          top: activitiesContainerRef.current.scrollHeight,
          behavior: 'smooth'
        })
      }, 260)
      return () => clearTimeout(timer)
    }
  }, [isExpanded])

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
  const allSortedActivities = useMemo(
    () => [...activities].sort((a, b) => a.timestamp - b.timestamp),
    [activities]
  )

  // Separate plan activities from regular activities
  // Plans are rendered as full ResponseCards, not in the collapsible activities section
  const planActivities = useMemo(
    () => allSortedActivities.filter(a => a.type === 'plan'),
    [allSortedActivities]
  )
  const sortedActivities = useMemo(
    () => allSortedActivities.filter(a => a.type !== 'plan'),
    [allSortedActivities]
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

  // Don't render turns that were interrupted before any meaningful work happened.
  // Hide the turn if:
  // - All tool activities are errors (nothing completed successfully)
  // - Any intermediate activities have no meaningful content (empty or just whitespace)
  // - No response text to show
  // - No plan activities
  // The "Response interrupted" info banner alone is sufficient feedback.
  const hasNoMeaningfulWork = activities.length > 0
    && activities.every(a => {
      // Tool activities must be errors (interrupted/failed)
      if (a.type === 'tool') return a.status === 'error'
      // Intermediate activities must have no meaningful content
      if (a.type === 'intermediate') return !a.content?.trim()
      // Plan activities are meaningful work
      if (a.type === 'plan') return false
      // Other activity types - consider as no meaningful work
      return true
    })
    && !response
  if (hasNoMeaningfulWork) {
    return null
  }

  // Only count non-plan activities for the collapsible section
  const hasActivities = sortedActivities.length > 0

  // Determine if thinking indicator should show using the phase-based state machine.
  // This properly handles the "gap" state (awaiting) between tool completion and next action,
  // which was previously causing the turn card to "disappear".
  const isThinking = shouldShowThinkingIndicator(turnPhase, isBuffering)

  return (
    <div className="space-y-1">
      {/* Activity Section - excluded from search highlighting (matches ripgrep behavior) */}
      {hasActivities && (
        <div className="group select-none" data-search-exclude="true">
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
                  ref={activitiesContainerRef}
                  className={cn(
                    "pl-4 pr-2 py-0 space-y-0.5 border-l-2 border-muted ml-[13px]",
                    sortedActivities.length > SIZE_CONFIG.maxVisibleActivities && "rounded-r-md overflow-y-auto scrollbar-hover py-1.5"
                  )}
                  style={{
                    maxHeight: sortedActivities.length > SIZE_CONFIG.maxVisibleActivities
                      ? SIZE_CONFIG.maxVisibleActivities * SIZE_CONFIG.activityRowHeight
                      : undefined
                  }}
                >
                  <AnimatePresence mode="sync">
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
                          sessionFolderPath={sessionFolderPath}
                          displayMode={displayMode}
                        />
                      ) : (
                        <motion.div
                          key={item.id}
                          initial={
                            hasUserToggled.current || hasMounted.current
                              ? { opacity: 0, x: -8 }
                              : false
                          }
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: hasUserToggled.current ? (index < SIZE_CONFIG.staggeredAnimationLimit ? index * 0.03 : SIZE_CONFIG.staggeredAnimationLimit * 0.03) : 0 }}
                        >
                          <ActivityRow
                            activity={item}
                            onOpenDetails={onOpenActivityDetails ? () => onOpenActivityDetails(item) : undefined}
                            sessionFolderPath={sessionFolderPath}
                            displayMode={displayMode}
                          />
                        </motion.div>
                      )
                    ))
                  ) : (
                    /* Flat view for simple tool calls */
                    sortedActivities.map((activity, index) => (
                      <motion.div
                        key={activity.id}
                        initial={
                          hasUserToggled.current || hasMounted.current
                            ? { opacity: 0, x: -8 }
                            : false
                        }
                        animate={{ opacity: 1, x: 0 }}
                        // Only animate on user toggle, not initial mount
                        transition={{ delay: hasUserToggled.current ? (index < SIZE_CONFIG.staggeredAnimationLimit ? index * 0.03 : SIZE_CONFIG.staggeredAnimationLimit * 0.03) : 0 }}
                      >
                        <ActivityRow
                          activity={activity}
                          onOpenDetails={onOpenActivityDetails ? () => onOpenActivityDetails(activity) : undefined}
                          isLastChild={lastChildSet.has(activity.id)}
                          sessionFolderPath={sessionFolderPath}
                          displayMode={displayMode}
                        />
                      </motion.div>
                    ))
                  )}
                  {/* Thinking/Buffering indicator - shown while waiting for response */}
                  {isThinking && !animateResponse && (
                    <motion.div
                      key="thinking"
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{
                        delay: Math.min(sortedActivities.length, SIZE_CONFIG.staggeredAnimationLimit) * 0.03,
                        duration: 0.3,
                        ease: "easeOut"
                      }}
                      className={cn("flex items-center gap-2 py-0.5 text-muted-foreground/70", SIZE_CONFIG.fontSize)}
                    >
                      <Spinner className={SIZE_CONFIG.spinnerSize} />
                      <span>{isBuffering ? 'Preparing response...' : 'Thinking...'}</span>
                    </motion.div>
                  )}
                  </AnimatePresence>
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
      {!hasActivities && isThinking && !animateResponse && (
        <div className={cn("flex items-center gap-2 px-3 py-1.5 text-muted-foreground", SIZE_CONFIG.fontSize)}>
          <Spinner className={SIZE_CONFIG.spinnerSize} />
          <span>{isBuffering ? 'Preparing response...' : 'Thinking...'}</span>
        </div>
      )}

      {/* Plan Activities - rendered as full ResponseCards, time-sorted with other activities */}
      {planActivities.map((planActivity, index) => (
        <div key={planActivity.id} className={cn("select-text", (hasActivities || index > 0) && "mt-2")}>
          <ResponseCard
            text={planActivity.content || ''}
            isStreaming={false}
            onOpenFile={onOpenFile}
            onOpenUrl={onOpenUrl}
            onPopOut={onPopOut ? () => onPopOut(planActivity.content || '') : undefined}
            variant="plan"
            onAccept={onAcceptPlan}
            onAcceptWithCompact={onAcceptPlanWithCompact}
            isLastResponse={isLastResponse && index === planActivities.length - 1}
            compactMode={compactMode}
            onBranch={onBranch ? (options?: { newPanel?: boolean }) => onBranch(planActivity.id, options) : undefined}
            sendMessageKey={sendMessageKey}
          />
        </div>
      ))}

      {/* Response Section - only shown when not buffering */}
      {/* Animated version for playground demos */}
      {animateResponse && (
        <AnimatePresence>
          {response && !isBuffering && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className={cn("select-text", hasActivities && "mt-2")}
            >
              <ResponseCard
                text={response.text}
                isStreaming={response.isStreaming}
                streamStartTime={response.streamStartTime}
                onOpenFile={onOpenFile}
                onOpenUrl={onOpenUrl}
                onPopOut={onPopOut ? () => onPopOut(response.text) : undefined}
                variant={response.isPlan ? 'plan' : 'response'}
                messageId={response.messageId}
                annotations={response.annotations}
                onAddAnnotation={onAddAnnotation}
                onRemoveAnnotation={onRemoveAnnotation}
                onUpdateAnnotation={onUpdateAnnotation}
                onAccept={onAcceptPlan}
                onAcceptWithCompact={onAcceptPlanWithCompact}
                isLastResponse={isLastResponse}
                compactMode={compactMode}
                onBranch={onBranch && response.messageId ? (options?: { newPanel?: boolean }) => onBranch(response.messageId!, options) : undefined}
                sendMessageKey={sendMessageKey}
              />
            </motion.div>
          )}
        </AnimatePresence>
      )}
      {/* Non-animated version for regular app use */}
      {!animateResponse && response && !isBuffering && (
        <div className={cn("select-text", hasActivities && "mt-2")}>
          <ResponseCard
            text={response.text}
            isStreaming={response.isStreaming}
            streamStartTime={response.streamStartTime}
            onOpenFile={onOpenFile}
            onOpenUrl={onOpenUrl}
            onPopOut={onPopOut ? () => onPopOut(response.text) : undefined}
            variant={response.isPlan ? 'plan' : 'response'}
            messageId={response.messageId}
            annotations={response.annotations}
            onAddAnnotation={onAddAnnotation}
            onRemoveAnnotation={onRemoveAnnotation}
            onUpdateAnnotation={onUpdateAnnotation}
            onAccept={onAcceptPlan}
            onAcceptWithCompact={onAcceptPlanWithCompact}
            isLastResponse={isLastResponse}
            compactMode={compactMode}
            onBranch={onBranch && response.messageId ? (options?: { newPanel?: boolean }) => onBranch(response.messageId!, options) : undefined}
            sendMessageKey={sendMessageKey}
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

  // Re-render if isLastResponse changed (for Accept Plan button visibility)
  if (prev.isLastResponse !== next.isLastResponse) return false

  // Re-render if displayMode changed
  if (prev.displayMode !== next.displayMode) return false

  // Re-render if activities changed (important for playground/testing scenarios)
  if (prev.activities !== next.activities) return false

  // Re-render when response object changes (e.g., annotation updates)
  if (prev.response !== next.response) return false

  // For complete, non-streaming turns: skip re-render if same turn
  // These are static and safe to cache
  return prev.turnId === next.turnId
})
