import * as React from "react"
import { useEffect, useState, useMemo, useCallback } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  ExternalLink,
  Info,
  PenLine,
  X,
} from "lucide-react"
import { motion, AnimatePresence } from "motion/react"

import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { Markdown, CollapsibleMarkdownProvider, StreamingMarkdown, type RenderMode } from "@/components/markdown"
import { AnimatedCollapsibleContent } from "@/components/ui/collapsible"
import {
  Spinner,
  parseReadResult,
  parseBashResult,
  parseGrepResult,
  parseGlobResult,
  extractOverlayData,
  CodePreviewOverlay,
  MultiDiffPreviewOverlay,
  TerminalPreviewOverlay,
  GenericOverlay,
  JSONPreviewOverlay,
  DocumentFormattedMarkdownOverlay,
  detectLanguage,
  type ActivityItem,
  type OverlayData,
  type FileChange,
  type DiffViewerSettings,
} from "@craft-agent/ui"
import { useFocusZone } from "@/hooks/keyboard"
import { useTheme } from "@/hooks/useTheme"
import type { Session, Message, FileAttachment, StoredAttachment, PermissionRequest, CredentialRequest, CredentialResponse, LoadedSource, LoadedSkill } from "../../../shared/types"
import type { PermissionMode } from "@craft-agent/shared/agent/modes"
import type { ThinkingLevel } from "@craft-agent/shared/agent/thinking-levels"
import { TurnCard, UserMessageBubble, groupMessagesByTurn, formatTurnAsMarkdown, formatActivityAsMarkdown, type Turn, type AssistantTurn, type UserTurn, type SystemTurn, type AuthRequestTurn } from "@craft-agent/ui"
import { MemoizedAuthRequestCard } from "@/components/chat/AuthRequestCard"
import { ActiveOptionBadges } from "./ActiveOptionBadges"
import { InputContainer, type StructuredInputState, type StructuredResponse, type PermissionResponse } from "./input"
import type { RichTextInputHandle } from "@/components/ui/rich-text-input"
import { useBackgroundTasks } from "@/hooks/useBackgroundTasks"
import { useTurnCardExpansion } from "@/hooks/useTurnCardExpansion"
import type { SessionMeta } from "@/atoms/sessions"
import { CHAT_LAYOUT } from "@/config/layout"
import { flattenLabels } from "@craft-agent/shared/labels"

// ============================================================================
// Overlay State Types
// ============================================================================

/** State for multi-diff overlay (Edit/Write activities) */
interface MultiDiffOverlayState {
  type: 'multi-diff'
  changes: FileChange[]
  consolidated: boolean
  focusedChangeId?: string
}

/** State for markdown overlay (pop-out, turn details, generic activities) */
interface MarkdownOverlayState {
  type: 'markdown'
  content: string
  title: string
  /** When true, show raw markdown source in code viewer instead of rendered preview */
  forceCodeView?: boolean
}

/** Union of all overlay states, or null for no overlay */
type OverlayState =
  | { type: 'activity'; activity: ActivityItem }
  | MultiDiffOverlayState
  | MarkdownOverlayState
  | null

/**
 * Checks if a file path is in a plans folder and is a markdown file.
 * Used to conditionally show the PLAN header in DocumentFormattedMarkdownOverlay.
 */
function isPlanFilePath(filePath: string | undefined): boolean {
  if (!filePath) return false
  return (filePath.includes('/plans/') || filePath.startsWith('plans/')) &&
         filePath.endsWith('.md')
}

interface ChatDisplayProps {
  session: Session | null
  onSendMessage: (message: string, attachments?: FileAttachment[], skillSlugs?: string[]) => void
  onOpenFile: (path: string) => void
  onOpenUrl: (url: string) => void
  // Model selection
  currentModel: string
  onModelChange: (model: string, connection?: string) => void
  // Connection selection (locked after first message)
  /** Callback when LLM connection changes (only works when session is empty) */
  onConnectionChange?: (connectionSlug: string) => void
  /** Ref for the input, used for external focus control */
  textareaRef?: React.RefObject<RichTextInputHandle>
  /** When true, disables input (e.g., when agent needs activation) */
  disabled?: boolean
  /** Pending permission request for this session */
  pendingPermission?: PermissionRequest
  /** Callback to respond to permission request */
  onRespondToPermission?: (sessionId: string, requestId: string, allowed: boolean, alwaysAllow: boolean) => void
  /** Pending credential request for this session */
  pendingCredential?: CredentialRequest
  /** Callback to respond to credential request */
  onRespondToCredential?: (sessionId: string, requestId: string, response: CredentialResponse) => void
  // Thinking level (session-level setting)
  /** Current thinking level ('off', 'think', 'max') */
  thinkingLevel?: ThinkingLevel
  /** Callback when thinking level changes */
  onThinkingLevelChange?: (level: ThinkingLevel) => void
  // Advanced options
  /** Enable ultrathink mode for extended reasoning */
  ultrathinkEnabled?: boolean
  onUltrathinkChange?: (enabled: boolean) => void
  /** Current permission mode */
  permissionMode?: PermissionMode
  onPermissionModeChange?: (mode: PermissionMode) => void
  /** Enabled permission modes for Shift+Tab cycling */
  enabledModes?: PermissionMode[]
  // Input value preservation (controlled from parent)
  /** Current input value - preserved across mode switches and conversation changes */
  inputValue?: string
  /** Callback when input value changes */
  onInputChange?: (value: string) => void
  // Source selection
  /** Available sources (enabled only) */
  sources?: LoadedSource[]
  /** Callback when source selection changes */
  onSourcesChange?: (slugs: string[]) => void
  // Skill selection (for @mentions)
  /** Available skills for @mention autocomplete */
  skills?: LoadedSkill[]
  // Label selection (for #labels)
  /** Available label configs (tree) for label menu and badge display */
  labels?: import('@craft-agent/shared/labels').LabelConfig[]
  /** Callback when labels change */
  onLabelsChange?: (labels: string[]) => void
  // State/status selection (for # menu and ActiveOptionBadges)
  /** Available workflow states */
  todoStates?: import('@/config/todo-states').TodoState[]
  /** Callback when session state changes */
  onTodoStateChange?: (stateId: string) => void
  /** Workspace ID for loading skill icons */
  workspaceId?: string
  // Working directory (per session)
  /** Current working directory for this session */
  workingDirectory?: string
  /** Callback when working directory changes */
  onWorkingDirectoryChange?: (path: string) => void
  /** Session folder path (for "Reset to Session Root" option) */
  sessionFolderPath?: string
  // Lazy loading
  /** When true, messages are still loading - show spinner in messages area */
  messagesLoading?: boolean
  // Tutorial
  /** Disable send action (for tutorial guidance) */
  disableSend?: boolean
  // Search highlighting (from session list search)
  /** Search query for highlighting matches - passed from session list */
  searchQuery?: string
  /** Whether search mode is active (prevents focus stealing to chat input) */
  isSearchModeActive?: boolean
  /** Callback when match count changes - used by session list for navigation */
  onMatchCountChange?: (count: number) => void
  /** Callback when match info (count and index) changes - for immediate UI updates */
  onMatchInfoChange?: (info: { count: number; index: number }) => void
  // Compact mode (for EditPopover embedding)
  /** Enable compact mode - hides non-essential UI elements for popover embedding */
  compactMode?: boolean
  /** Custom placeholder for input (used in compact mode for edit context) */
  placeholder?: string | string[]
  /** Label shown as empty state in compact mode (e.g., "Permission Settings") */
  emptyStateLabel?: string
  /** When true, the session's locked connection has been removed - disables send and shows unavailable state */
  connectionUnavailable?: boolean
}

/**
 * Imperative handle exposed via forwardRef for navigation between matches
 */
export interface ChatDisplayHandle {
  goToNextMatch: () => void
  goToPrevMatch: () => void
  matchCount: number
  currentMatchIndex: number
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
  /** Override cycling messages with explicit status (e.g., "Compacting...") */
  statusMessage?: string
}

/**
 * ProcessingIndicator - Shows cycling status messages with elapsed time
 * Matches TurnCard header layout for visual continuity
 */
function ProcessingIndicator({ startTime, statusMessage }: ProcessingIndicatorProps) {
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

  // Cycle through messages every 10 seconds (only when not showing status)
  React.useEffect(() => {
    if (statusMessage) return  // Don't cycle when showing status
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
  }, [statusMessage])

  // Use status message if provided, otherwise cycle through default messages
  const displayMessage = statusMessage || PROCESSING_MESSAGES[messageIndex]

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
            key={displayMessage}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: 'easeInOut' }}
          >
            {displayMessage}
          </motion.span>
        </AnimatePresence>
        {elapsed >= 1 && (
          <span className="text-muted-foreground/60 ml-1 tabular-nums">
            {formatElapsed(elapsed)}
          </span>
        )}
      </span>
    </div>
  )
}

/**
 * Scrolls to target element on mount, before browser paint.
 * Uses useLayoutEffect to ensure scroll happens before content is visible.
 */
function ScrollOnMount({
  targetRef,
  onScroll,
  skip = false
}: {
  targetRef: React.RefObject<HTMLDivElement | null>
  onScroll?: () => void
  skip?: boolean
}) {
  React.useLayoutEffect(() => {
    if (skip) return
    targetRef.current?.scrollIntoView({ behavior: 'instant' })
    onScroll?.()
  }, [skip])
  return null
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
export const ChatDisplay = React.forwardRef<ChatDisplayHandle, ChatDisplayProps>(function ChatDisplay({
  session,
  onSendMessage,
  onOpenFile,
  onOpenUrl,
  currentModel,
  onModelChange,
  onConnectionChange,
  textareaRef: externalTextareaRef,
  disabled = false,
  pendingPermission,
  onRespondToPermission,
  pendingCredential,
  onRespondToCredential,
  // Thinking level
  thinkingLevel = 'think',
  onThinkingLevelChange,
  // Advanced options
  ultrathinkEnabled = false,
  onUltrathinkChange,
  permissionMode = 'ask',
  onPermissionModeChange,
  enabledModes,
  // Input value preservation
  inputValue,
  onInputChange,
  // Sources
  sources,
  onSourcesChange,
  // Skills (for @mentions)
  skills,
  // Labels (for #labels)
  labels,
  onLabelsChange,
  // States (for # menu and badge)
  todoStates,
  onTodoStateChange,
  workspaceId,
  // Working directory
  workingDirectory,
  onWorkingDirectoryChange,
  sessionFolderPath,
  // Lazy loading
  messagesLoading = false,
  // Tutorial
  disableSend = false,
  // Search highlighting
  searchQuery: externalSearchQuery,
  isSearchModeActive = false,
  onMatchCountChange,
  onMatchInfoChange,
  // Compact mode (for EditPopover embedding)
  compactMode = false,
  placeholder,
  emptyStateLabel,
  // Connection unavailable
  connectionUnavailable = false,
}, ref) {
  // Input is only disabled when explicitly disabled (e.g., agent needs activation)
  // User can type during streaming - submitting will stop the stream and send
  const isInputDisabled = disabled
  const messagesEndRef = React.useRef<HTMLDivElement>(null)
  const scrollViewportRef = React.useRef<HTMLDivElement>(null)
  const prevSessionIdRef = React.useRef<string | null>(null)
  // Reverse pagination: show last N turns initially, load more on scroll up
  const TURNS_PER_PAGE = 20
  const [visibleTurnCount, setVisibleTurnCount] = React.useState(TURNS_PER_PAGE)
  // Sticky-bottom: When true, auto-scroll on content changes. Toggled by user scroll behavior.
  const isStickToBottomRef = React.useRef(true)
  // Skip smooth scroll briefly after session switch (instant scroll already happened)
  const skipSmoothScrollUntilRef = React.useRef(0)
  const internalTextareaRef = React.useRef<RichTextInputHandle>(null)
  const textareaRef = externalTextareaRef || internalTextareaRef

  // Get isDark from useTheme hook for overlay theme
  // This accounts for scenic themes (like Haze) that force dark mode
  const { isDark } = useTheme()

  // Register as focus zone - when zone gains focus, focus the textarea
  const { zoneRef, isFocused } = useFocusZone({
    zoneId: 'chat',
    focusFirst: () => {
      textareaRef.current?.focus()
    },
  })

  // Background tasks management
  const { tasks: backgroundTasks, killTask } = useBackgroundTasks({
    sessionId: session?.id ?? ''
  })

  // TurnCard expansion state — persisted to localStorage across session switches
  const {
    expandedTurns,
    toggleTurn,
    expandedActivityGroups,
    setExpandedActivityGroups,
  } = useTurnCardExpansion(session?.id)

  // Track which label should auto-open its value popover after being added via # menu.
  // Set when a valued label is selected, cleared once the popover opens.
  const [autoOpenLabelId, setAutoOpenLabelId] = useState<string | null>(null)

  // ============================================================================
  // Search Highlighting (from session list search)
  // ============================================================================
  // Current match index for navigation (internal state, exposed via ref)
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0)
  const turnRefs = React.useRef<Map<string, HTMLDivElement>>(new Map())
  // Track actual match IDs created in DOM (state so it triggers re-renders)
  const [actualMatchIds, setActualMatchIds] = useState<Set<string>>(new Set())
  // Track which turn IDs have been highlighted (to avoid re-highlighting on pagination)
  const highlightedTurnIdsRef = React.useRef<Set<string>>(new Set())
  // Track previous search/session to detect when to clear vs accumulate highlights
  const prevHighlightContextRef = React.useRef<{ searchQuery: string; sessionId: string | null }>({ searchQuery: '', sessionId: null })
  // Flag to control when scrolling to matches should happen
  // Only scroll when: session changes with search active, or user clicks navigation
  const shouldScrollToMatchRef = React.useRef(false)
  const prevSessionIdForScrollRef = React.useRef<string | null>(null)

  // Use the external search query from props
  const searchQuery = externalSearchQuery || ''
  const isSearchActive = Boolean(searchQuery.trim())

  // Focus textarea when zone gains focus via keyboard (Tab, Cmd+3, ArrowRight)
  // Requires isFocused to be true - respects zone architecture
  // Does NOT auto-focus just because session changed (that would steal focus from SessionList)
  // Uses isSearchModeActive (prop) instead of isSearchActive (query-based) to prevent
  // focus stealing when search is open but query is empty
  useEffect(() => {
    if (session && !isSearchModeActive && isFocused) {
      textareaRef.current?.focus()
    }
  }, [session?.id, isFocused, isSearchModeActive])

  // Reset match state when session or search query changes
  useEffect(() => {
    const isSessionSwitch = prevSessionIdForScrollRef.current !== null && prevSessionIdForScrollRef.current !== session?.id
    prevSessionIdForScrollRef.current = session?.id ?? null

    // If session switched with search active, trigger scroll to first match
    if (isSessionSwitch && isSearchActive) {
      shouldScrollToMatchRef.current = true
    }

    setCurrentMatchIndex(0)
    setActualMatchIds(new Set()) // Clear stale match IDs to prevent incorrect counts
  }, [session?.id, searchQuery, isSearchActive])

  // Helper to count occurrences of a substring
  const countOccurrences = useCallback((text: string, query: string): number => {
    const lowerText = text.toLowerCase()
    const lowerQuery = query.toLowerCase()
    let count = 0
    let pos = 0
    while ((pos = lowerText.indexOf(lowerQuery, pos)) !== -1) {
      count++
      pos += lowerQuery.length
    }
    return count
  }, [])

  // Find ALL individual match occurrences (not just turns)
  // Returns array with unique matchId for each occurrence
  const matchingOccurrences = useMemo(() => {
    if (!searchQuery.trim() || !session?.messages) return []
    const startTime = performance.now()
    const query = searchQuery.toLowerCase()
    const turns = groupMessagesByTurn(session.messages)
    const matches: { matchId: string; turnId: string; turnIndex: number; matchIndexInTurn: number }[] = []

    for (let turnIndex = 0; turnIndex < turns.length; turnIndex++) {
      const turn = turns[turnIndex]
      let textContent = ''
      let turnId = ''

      if (turn.type === 'user') {
        turnId = `user-${turn.message.id}`
        // Extract text content from user message
        const content = turn.message.content as unknown
        if (typeof content === 'string') {
          textContent = content
        } else if (Array.isArray(content)) {
          textContent = content
            .filter((block: { type?: string }) => block.type === 'text')
            .map((block: { text?: string }) => block.text || '')
            .join('\n')
        }
      } else if (turn.type === 'assistant') {
        turnId = `turn-${turn.turnId}`
        // Extract text content from assistant response
        // turn.response is { text: string, isStreaming: boolean } object
        if (turn.response?.text) {
          textContent = turn.response.text
        }
      } else if (turn.type === 'system') {
        turnId = `system-${turn.message.id}`
        textContent = turn.message.content
      }

      // Count occurrences in this turn's text content
      const occurrenceCount = countOccurrences(textContent, query)
      for (let i = 0; i < occurrenceCount; i++) {
        matches.push({
          matchId: `${turnId}-match-${i}`,
          turnId,
          turnIndex,
          matchIndexInTurn: i,
        })
      }
    }
    return matches
  }, [searchQuery, session?.messages, countOccurrences])

  // Auto-expand pagination when search is active to show all matching turns
  // This ensures match count is stable and all matches are highlightable from the start
  useEffect(() => {
    if (!isSearchActive || matchingOccurrences.length === 0) return

    // Find the earliest matching turn index
    const earliestMatchTurnIndex = Math.min(...matchingOccurrences.map(m => m.turnIndex))
    const totalTurns = groupMessagesByTurn(session?.messages || []).length

    // Calculate how many turns we need to show to include all matches
    // totalTurns - visibleTurnCount = startIndex, so we need visibleTurnCount = totalTurns - earliestMatchTurnIndex + buffer
    const requiredVisibleCount = totalTurns - earliestMatchTurnIndex + 5 // +5 buffer for context

    if (requiredVisibleCount > visibleTurnCount) {
      setVisibleTurnCount(requiredVisibleCount)
    }
  }, [isSearchActive, matchingOccurrences, session?.messages, visibleTurnCount])

  // Extract unique turn IDs that have matches (for highlighting)
  const matchingTurnIds = useMemo(() => {
    const uniqueTurnIds = new Set(matchingOccurrences.map(m => m.turnId))
    return Array.from(uniqueTurnIds)
  }, [matchingOccurrences])

  // Filter to only valid matches that exist in DOM (actualMatchIds is updated after highlighting)
  const validMatches = useMemo(() => {
    // Before highlighting runs, show all potential matches
    // After highlighting, filter to only matches that exist in DOM
    if (actualMatchIds.size === 0) return matchingOccurrences
    return matchingOccurrences.filter(m => actualMatchIds.has(m.matchId))
  }, [matchingOccurrences, actualMatchIds])

  // Auto-scroll to match ONLY when there's exactly one match
  // Multiple matches: user navigates with chevrons to avoid jarring scroll
  useEffect(() => {
    if (validMatches.length === 1 && isSearchActive) {
      shouldScrollToMatchRef.current = true
    }
  }, [validMatches.length, isSearchActive])

  // Scroll to current match (with delay to wait for DOM rendering)
  // Only scrolls when shouldScrollToMatchRef is true (single match auto-scroll or nav button click)
  useEffect(() => {
    // Only scroll if explicitly requested (session change or navigation click)
    if (!shouldScrollToMatchRef.current) return

    if (validMatches.length > 0 && currentMatchIndex < validMatches.length) {
      const matchData = validMatches[currentMatchIndex]
      const { matchId, turnIndex } = matchData
      const totalTurns = totalTurnCountRef.current

      // Calculate current visible range
      const currentStartIndex = Math.max(0, totalTurns - visibleTurnCount)

      // Check if the match is outside the visible range
      if (turnIndex < currentStartIndex) {
        // Expand visible turns to include this match (with some buffer)
        const newVisibleCount = totalTurns - turnIndex + 5 // Add 5 turns buffer
        setVisibleTurnCount(newVisibleCount)
        // Keep shouldScroll true - will scroll on next effect run after DOM updates
        return
      }

      // Use multiple attempts to ensure DOM is ready (highlights are applied)
      let attempts = 0
      const maxAttempts = 5

      const tryScroll = () => {
        const matchEl = document.getElementById(matchId) as HTMLElement | null
        if (matchEl) {
          // Only scroll if match is not comfortably visible on screen (with 128px edge buffer)
          const rect = matchEl.getBoundingClientRect()
          const buffer = 128
          const isVisible = rect.top >= buffer && rect.bottom <= window.innerHeight - buffer
          if (!isVisible) {
            matchEl.scrollIntoView({ behavior: 'instant', block: 'center' })
          }
          // Add active styling to current match (prominent yellow with shadow and ring)
          // Using ring instead of border to avoid layout shift
          matchEl.classList.remove('bg-yellow-300/30')
          matchEl.classList.add('bg-yellow-300', 'shadow-tinted', 'text-black/90', 'ring-1', 'ring-yellow-500')
          ;(matchEl as HTMLElement).style.setProperty('--shadow-color', '90, 50, 5') // dark amber for stronger shadow
          // Remove active styling from other matches (revert to passive)
          document.querySelectorAll('mark.search-highlight.bg-yellow-300').forEach(el => {
            if (el.id !== matchId) {
              el.classList.remove('bg-yellow-300', 'shadow-tinted', 'text-black/90', 'ring-1', 'ring-yellow-500')
              el.classList.add('bg-yellow-300/30')
              ;(el as HTMLElement).style.removeProperty('--shadow-color')
            }
          })
          shouldScrollToMatchRef.current = false
        } else if (attempts < maxAttempts) {
          attempts++
          setTimeout(tryScroll, 50)
        } else {
          // Give up - validMatches should only contain valid matches, but timing can cause this
          shouldScrollToMatchRef.current = false
        }
      }

      // Start with requestAnimationFrame for initial attempt
      const rafId = requestAnimationFrame(tryScroll)
      return () => cancelAnimationFrame(rafId)
    }
  }, [validMatches, currentMatchIndex, session?.id, visibleTurnCount])

  // Text highlighting within messages
  // Uses DOM manipulation after render to highlight matching text
  useEffect(() => {
    // Clear previous highlights
    const clearHighlights = () => {
      const existingMarks = document.querySelectorAll('mark.search-highlight')
      existingMarks.forEach(mark => {
        const parent = mark.parentNode
        if (parent) {
          parent.replaceChild(document.createTextNode(mark.textContent || ''), mark)
          parent.normalize() // Merge adjacent text nodes
        }
      })
    }

    // Detect if search/session changed (need full clear) vs just pagination (accumulate)
    const prevContext = prevHighlightContextRef.current
    const contextChanged = prevContext.searchQuery !== searchQuery || prevContext.sessionId !== session?.id
    prevHighlightContextRef.current = { searchQuery, sessionId: session?.id ?? null }

    // Only clear highlights and reset state when search/session changes
    // When just pagination changes, we accumulate new highlights
    if (contextChanged) {
      clearHighlights()
      setActualMatchIds(new Set())
      highlightedTurnIdsRef.current = new Set()
    }

    if (!searchQuery.trim() || !isSearchActive) return

    const query = searchQuery.toLowerCase()
    const createdMatchIds: string[] = [] // Collect IDs as we create marks

    // Highlighting function - applies highlights only to MATCHING turn refs
    // Assigns unique IDs to each mark for navigation
    const applyHighlights = () => {
      // Only highlight in turns that actually match, not all visible turns
      const matchingTurnIdSet = new Set(matchingTurnIds)
      // Track match counter per turn for unique IDs
      const turnMatchCounters = new Map<string, number>()

      turnRefs.current.forEach((container, turnId) => {
        // Skip turns that don't contain matches
        if (!matchingTurnIdSet.has(turnId)) return

        // Skip turns that have already been highlighted (pagination case)
        if (highlightedTurnIdsRef.current.has(turnId)) return

        // Mark this turn as highlighted
        highlightedTurnIdsRef.current.add(turnId)

        // Initialize counter for this turn
        turnMatchCounters.set(turnId, 0)

        // Find all text nodes within the container
        const walker = document.createTreeWalker(
          container,
          NodeFilter.SHOW_TEXT,
          {
            acceptNode: (node) => {
              // Skip nodes in script, style, or already marked
              const parent = node.parentElement
              if (!parent) return NodeFilter.FILTER_REJECT
              const tagName = parent.tagName.toLowerCase()
              if (tagName === 'script' || tagName === 'style' || tagName === 'mark') {
                return NodeFilter.FILTER_REJECT
              }
              // Skip nodes within elements marked as search-excluded (e.g., tool activities)
              // This matches ripgrep behavior which only searches user/assistant text
              if (parent.closest('[data-search-exclude="true"]')) {
                return NodeFilter.FILTER_REJECT
              }
              // Only process nodes that contain the search text
              if (node.textContent?.toLowerCase().includes(query)) {
                return NodeFilter.FILTER_ACCEPT
              }
              return NodeFilter.FILTER_REJECT
            }
          }
        )

        const textNodes: Text[] = []
        let currentNode: Node | null
        while ((currentNode = walker.nextNode())) {
          textNodes.push(currentNode as Text)
        }

        // Process text nodes in FORWARD order to assign IDs correctly
        // (but we need to be careful about DOM manipulation)
        // Actually, let's collect all matches first, then apply
        const allMatches: { textNode: Text; start: number; end: number }[] = []
        for (const textNode of textNodes) {
          const text = textNode.textContent || ''
          const lowerText = text.toLowerCase()
          let pos = 0
          let matchPos = lowerText.indexOf(query, pos)
          while (matchPos !== -1) {
            allMatches.push({ textNode, start: matchPos, end: matchPos + query.length })
            pos = matchPos + query.length
            matchPos = lowerText.indexOf(query, pos)
          }
        }

        // Process text nodes in reverse order to avoid invalidating positions
        // But we need to assign IDs in forward order, so use a reverse counter
        const totalMatchesInTurn = allMatches.length
        let reverseCounter = totalMatchesInTurn - 1

        for (let i = textNodes.length - 1; i >= 0; i--) {
          const textNode = textNodes[i]
          const text = textNode.textContent || ''
          const lowerText = text.toLowerCase()

          // Find matches in this node (in reverse order for DOM manipulation)
          const nodeMatches: number[] = []
          let pos = 0
          let matchPos = lowerText.indexOf(query, pos)
          while (matchPos !== -1) {
            nodeMatches.push(matchPos)
            pos = matchPos + query.length
            matchPos = lowerText.indexOf(query, pos)
          }

          if (nodeMatches.length === 0) continue

          // Process in reverse to maintain positions
          let lastIndex = text.length
          const fragments: (string | HTMLElement)[] = []

          for (let j = nodeMatches.length - 1; j >= 0; j--) {
            const matchStart = nodeMatches[j]
            const matchEnd = matchStart + query.length

            // Text after match
            if (matchEnd < lastIndex) {
              fragments.unshift(text.slice(matchEnd, lastIndex))
            }

            // Highlighted match with unique ID
            const mark = document.createElement('mark')
            const matchIdIndex = reverseCounter - (nodeMatches.length - 1 - j)
            const markId = `${turnId}-match-${matchIdIndex}`
            mark.id = markId
            // All highlights start as passive (subtle 30% opacity yellow)
            mark.className = 'search-highlight bg-yellow-300/30 rounded-[2px]'
            mark.textContent = text.slice(matchStart, matchEnd)
            fragments.unshift(mark)
            createdMatchIds.push(markId)

            lastIndex = matchStart
          }

          // Update reverse counter
          reverseCounter -= nodeMatches.length

          // Text before first match
          if (lastIndex > 0) {
            fragments.unshift(text.slice(0, lastIndex))
          }

          // Replace text node with fragments
          if (fragments.length > 0 && textNode.parentNode) {
            const parent = textNode.parentNode
            fragments.forEach(frag => {
              if (typeof frag === 'string') {
                parent.insertBefore(document.createTextNode(frag), textNode)
              } else {
                parent.insertBefore(frag, textNode)
              }
            })
            parent.removeChild(textNode)
          }
        }
      })
    }

    // Retry logic: if no refs available yet, wait and try again
    let attempts = 0
    const maxAttempts = 5
    let highlightTimeoutId: ReturnType<typeof setTimeout> | null = null

    const tryHighlight = () => {
      // If no turns to highlight, don't retry - there's nothing to wait for
      if (matchingTurnIds.length === 0) {
        return
      }

      // Only count turns that are in refs AND not already highlighted
      const unhighlightedMatchingInRefs = matchingTurnIds.filter(id =>
        turnRefs.current.has(id) && !highlightedTurnIdsRef.current.has(id)
      ).length
      if (unhighlightedMatchingInRefs > 0) {
        applyHighlights()
        // Accumulate match IDs (for pagination - adds new matches to existing)
        setActualMatchIds(prev => {
          const merged = new Set(prev)
          createdMatchIds.forEach(id => merged.add(id))
          return merged
        })
      } else if (attempts < maxAttempts) {
        // Refs not ready yet - retry with increasing delay
        attempts++
        highlightTimeoutId = setTimeout(tryHighlight, 100)
      }
    }

    // Start with initial delay for DOM rendering
    const timeoutId = setTimeout(tryHighlight, 50)

    // Cleanup function - only clear timeouts, not highlights
    // Highlights are cleared in the effect body when search/session changes (contextChanged)
    return () => {
      clearTimeout(timeoutId)
      if (highlightTimeoutId) clearTimeout(highlightTimeoutId)
    }
  }, [searchQuery, isSearchActive, matchingTurnIds, session?.id, visibleTurnCount]) // Added visibleTurnCount to re-highlight after pagination

  // Navigate to next match (no looping - stops at last match)
  const goToNextMatch = useCallback(() => {
    if (validMatches.length === 0) return
    setCurrentMatchIndex(prev => {
      // Don't loop - stop at last match
      if (prev >= validMatches.length - 1) return prev
      shouldScrollToMatchRef.current = true
      return prev + 1
    })
  }, [validMatches])

  // Navigate to previous match (no looping - stops at first match)
  const goToPrevMatch = useCallback(() => {
    if (validMatches.length === 0) return
    setCurrentMatchIndex(prev => {
      // Don't loop - stop at first match
      if (prev <= 0) return prev
      shouldScrollToMatchRef.current = true
      return prev - 1
    })
  }, [validMatches])

  // Expose navigation via imperative handle (for session list navigation controls)
  React.useImperativeHandle(ref, () => ({
    goToNextMatch,
    goToPrevMatch,
    matchCount: validMatches.length,
    currentMatchIndex,
  }), [goToNextMatch, goToPrevMatch, validMatches.length, currentMatchIndex])

  // Notify parent when match count changes
  useEffect(() => {
    onMatchCountChange?.(validMatches.length)
  }, [validMatches.length, onMatchCountChange])

  // Notify parent when match info (count and index) changes
  useEffect(() => {
    onMatchInfoChange?.({ count: validMatches.length, index: currentMatchIndex })
  }, [validMatches.length, currentMatchIndex, session?.id, onMatchInfoChange])

  // ============================================================================
  // Overlay State Management
  // ============================================================================

  // Overlay state - controls which overlay is shown (if any)
  const [overlayState, setOverlayState] = useState<OverlayState>(null)

  // Diff viewer settings - loaded from user preferences on mount, persisted on change
  // These settings are stored in ~/.craft-agent/preferences.json (not localStorage)
  const [diffViewerSettings, setDiffViewerSettings] = useState<Partial<DiffViewerSettings>>({})

  // Load diff viewer settings from preferences on mount
  useEffect(() => {
    window.electronAPI.readPreferences().then(({ content }) => {
      try {
        const prefs = JSON.parse(content)
        if (prefs.diffViewer) {
          setDiffViewerSettings(prefs.diffViewer)
        }
      } catch {
        // Ignore parse errors, use defaults
      }
    })
  }, [])

  // Persist diff viewer settings to preferences when changed
  const handleDiffViewerSettingsChange = useCallback((settings: DiffViewerSettings) => {
    setDiffViewerSettings(settings)
    // Read current preferences, merge in new settings, write back
    window.electronAPI.readPreferences().then(({ content }) => {
      try {
        const prefs = JSON.parse(content)
        prefs.diffViewer = settings
        prefs.updatedAt = Date.now()
        window.electronAPI.writePreferences(JSON.stringify(prefs, null, 2))
      } catch {
        // If preferences malformed, create fresh with just diffViewer
        window.electronAPI.writePreferences(JSON.stringify({ diffViewer: settings, updatedAt: Date.now() }, null, 2))
      }
    })
  }, [])

  // Close overlay handler
  const handleCloseOverlay = useCallback(() => {
    setOverlayState(null)
  }, [])

  // Extract overlay data for activity-based overlays
  // Uses the shared extractOverlayData parser from @craft-agent/ui
  const overlayData: OverlayData | null = useMemo(() => {
    if (!overlayState || overlayState.type !== 'activity') return null
    return extractOverlayData(overlayState.activity)
  }, [overlayState])

  // Pop-out handler - opens message in overlay (read-only markdown)
  const handlePopOut = useCallback((message: Message) => {
    if (!session) return
    setOverlayState({
      type: 'markdown',
      content: message.content,
      title: 'Message Preview',
    })
  }, [session])

  // Helper to collect Edit/Write activities into FileChange array
  // Used by both onOpenActivityDetails and onOpenMultiFileDiff
  // Supports both Claude Code format (file_path, old_string, new_string) and
  // Codex format (changes array with path and diff fields)
  const collectFileChanges = useCallback((activities: ActivityItem[]): FileChange[] => {
    const changes: FileChange[] = []
    for (const a of activities) {
      const input = a.toolInput as Record<string, unknown> | undefined
      if (a.toolName === 'Edit' && input) {
        // Check for Codex format: { changes: Array<{ path, kind, diff }> }
        if (input.changes && Array.isArray(input.changes)) {
          // Codex fileChange format - extract each change
          for (const codexChange of input.changes as Array<{ path?: string; kind?: unknown; diff?: string }>) {
            changes.push({
              id: `${a.id}-${codexChange.path || 'unknown'}`,
              filePath: codexChange.path || 'unknown',
              toolType: 'Edit',
              original: '',
              modified: '',
              unifiedDiff: codexChange.diff,
              error: a.error || undefined,
            })
          }
        } else {
          // Claude Code format: { file_path, old_string, new_string }
          changes.push({
            id: a.id,
            filePath: (input.file_path as string) || 'unknown',
            toolType: 'Edit',
            original: (input.old_string as string) || '',
            modified: (input.new_string as string) || '',
            error: a.error || undefined,
          })
        }
      } else if (a.toolName === 'Write' && input) {
        changes.push({
          id: a.id,
          filePath: (input.file_path as string) || 'unknown',
          toolType: 'Write',
          original: '',
          modified: (input.content as string) || '',
          error: a.error || undefined,
        })
      }
    }
    return changes
  }, [])

  // Ref to track total turn count for scroll handler
  const totalTurnCountRef = React.useRef(0)

  // Track scroll position to toggle sticky-bottom behavior
  // - User scrolls up → unstick (stop auto-scrolling)
  // - User scrolls back to bottom → re-stick (resume auto-scrolling)
  // Also handles loading more turns when scrolling near top
  const handleScroll = React.useCallback(() => {
    const viewport = scrollViewportRef.current
    if (!viewport) return
    const { scrollTop, scrollHeight, clientHeight } = viewport
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight
    // 20px threshold for "at bottom" detection
    isStickToBottomRef.current = distanceFromBottom < 20

    // Load more turns when scrolling near top (within 100px)
    if (scrollTop < 100) {
      setVisibleTurnCount(prev => {
        // Check if there are more turns to load
        const currentStartIndex = Math.max(0, totalTurnCountRef.current - prev)
        if (currentStartIndex <= 0) return prev // Already showing all

        // Remember scroll height before adding more items
        const prevScrollHeight = viewport.scrollHeight

        // Schedule scroll position adjustment after render
        requestAnimationFrame(() => {
          const newScrollHeight = viewport.scrollHeight
          viewport.scrollTop = newScrollHeight - prevScrollHeight + scrollTop
        })

        return prev + TURNS_PER_PAGE
      })
    }
  }, [])

  // Set up scroll event listener
  React.useEffect(() => {
    const viewport = scrollViewportRef.current
    if (!viewport) return
    viewport.addEventListener('scroll', handleScroll)
    return () => viewport.removeEventListener('scroll', handleScroll)
  }, [handleScroll])

  // Auto-scroll using ResizeObserver for streaming content
  // Initial scroll is handled by ScrollOnMount (useLayoutEffect, before paint)
  React.useEffect(() => {
    const viewport = scrollViewportRef.current
    if (!viewport) return

    const isSessionSwitch = prevSessionIdRef.current !== session?.id
    prevSessionIdRef.current = session?.id ?? null

    // On session switch: reset UI state (scroll handled by ScrollOnMount)
    if (isSessionSwitch) {
      isStickToBottomRef.current = true
      setVisibleTurnCount(TURNS_PER_PAGE)
    }

    // Debounced scroll for streaming - waits for layout to settle
    let debounceTimer: ReturnType<typeof setTimeout> | null = null

    const resizeObserver = new ResizeObserver(() => {
      if (!isStickToBottomRef.current) return

      // Clear pending scroll and wait for layout to settle
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        // Skip smooth scroll if we just did an instant scroll (session switch/lazy load)
        if (Date.now() < skipSmoothScrollUntilRef.current) return
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
  // Backend handles interruption and queueing if currently processing
  const handleSubmit = (message: string, attachments?: FileAttachment[], skillSlugs?: string[]) => {
    // Force stick-to-bottom when user sends a message
    isStickToBottomRef.current = true
    onSendMessage(message, attachments, skillSlugs)

    // Immediately scroll to bottom after sending - use requestAnimationFrame
    // to ensure the DOM has updated with the new message
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    })
  }

  // Handle stop request from InputContainer
  // silent=true when redirecting (sending new message), silent=false when user clicks Stop button
  const handleStop = (silent = false) => {
    if (!session?.isProcessing) return
    window.electronAPI.cancelProcessing(session.id, silent).catch(error => {
      console.error('[ChatDisplay] Failed to cancel processing:', error)
    })
  }

  // Per-frame scroll compensation during input height animation
  // Only compensate when user is "stuck to bottom" - otherwise let them control their scroll position
  const handleAnimatedHeightChange = React.useCallback((delta: number) => {
    if (!isStickToBottomRef.current) return
    const viewport = scrollViewportRef.current
    if (!viewport) return
    // Adjust scroll to maintain position relative to content
    viewport.scrollTop += delta
  }, [])

  // Handle structured input responses (permissions and credentials)
  const handleStructuredResponse = (response: StructuredResponse) => {
    if (response.type === 'permission' && pendingPermission && onRespondToPermission) {
      const permResponse = response as PermissionResponse
      onRespondToPermission(
        pendingPermission.sessionId,
        pendingPermission.requestId,
        permResponse.allowed,
        permResponse.alwaysAllow
      )
    } else if (response.type === 'credential' && pendingCredential && onRespondToCredential) {
      const credResponse = response as CredentialResponse
      onRespondToCredential(
        pendingCredential.sessionId,
        pendingCredential.requestId,
        credResponse
      )
    }
  }

  // Build structured input state from pending requests (permissions take priority)
  const structuredInput: StructuredInputState | undefined = React.useMemo(() => {
    if (pendingPermission) {
      return { type: 'permission', data: pendingPermission }
    }
    if (pendingCredential) {
      return { type: 'credential', data: pendingCredential }
    }
    return undefined
  }, [pendingPermission, pendingCredential])

  // Memoize turn grouping - avoids O(n) iteration on every render/keystroke
  const allTurns = React.useMemo(() => {
    if (!session) return []
    return groupMessagesByTurn(session.messages)
  }, [session?.messages])

  // Keep ref in sync for scroll handler
  totalTurnCountRef.current = allTurns.length

  // Reverse pagination: only render last N turns for fast initial render
  const startIndex = Math.max(0, allTurns.length - visibleTurnCount)
  const turns = allTurns.slice(startIndex)
  const hasMoreAbove = startIndex > 0

  // Compute if we should skip scroll-to-bottom (when search is active on session switch)
  // At render time, prevSessionIdForScrollRef still has the OLD session ID, so we can detect the switch
  const isSessionSwitchForScroll = prevSessionIdForScrollRef.current !== null && prevSessionIdForScrollRef.current !== session?.id
  const skipScrollToBottom = isSessionSwitchForScroll && isSearchActive

  return (
    <div ref={zoneRef} className="flex h-full flex-col min-w-0" data-focus-zone="chat">
      {session ? (
        <div className="flex flex-1 flex-col min-h-0 min-w-0 relative">
          {/* Content layer */}
          <div className="flex flex-1 flex-col min-h-0 min-w-0 relative z-10">
          {/* === MESSAGES AREA: Scrollable list of message bubbles === */}
          <div className="relative flex-1 min-h-0">
            {/* Mask wrapper - fades content at top and bottom over transparent/image backgrounds */}
            <div
              className="h-full"
              style={{
                maskImage: 'linear-gradient(to bottom, transparent 0%, black 32px, black calc(100% - 32px), transparent 100%)',
                WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 32px, black calc(100% - 32px), transparent 100%)'
              }}
            >
              <ScrollArea className="h-full min-w-0" viewportRef={scrollViewportRef}>
              <div className={cn(CHAT_LAYOUT.maxWidth, "mx-auto", CHAT_LAYOUT.containerPadding, CHAT_LAYOUT.messageSpacing, "min-w-0")}>
                {/* Session-level AnimatePresence: Prevents layout jump when switching sessions */}
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={session?.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.1, ease: 'easeOut' }}
                  >
                    {/* Loading/Content AnimatePresence: Handles spinner ↔ content transition */}
                    <AnimatePresence mode="wait" initial={false}>
                    {messagesLoading ? (
                      /* Loading State: Show spinner while messages are being lazy loaded */
                      <motion.div
                        key="loading"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.1 }}
                        className="flex items-center justify-center h-64"
                      >
                        <Spinner className="text-foreground/30" />
                      </motion.div>
                    ) : (
                    /* Turn-based Message Display - memoized to avoid re-grouping on every render */
                    /* AnimatePresence handles the fade-in animation when transitioning from loading */
                    <motion.div
                      key={`loaded-${session?.id}`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.1, ease: 'easeOut' }}
                    >
                  {/* Scroll to bottom before paint - fires via useLayoutEffect */}
                  {/* Skip when search is active on session switch - scroll to first match instead */}
                  <ScrollOnMount
                    targetRef={messagesEndRef}
                    skip={skipScrollToBottom}
                    onScroll={() => {
                      skipSmoothScrollUntilRef.current = Date.now() + 500
                    }}
                  />
                  {/* Empty state for compact mode - inviting conversational prompt, centered in full popover */}
                  {compactMode && turns.length === 0 && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center select-none gap-1 pointer-events-none">
                      <span className="text-sm text-muted-foreground">What would you like to change?</span>
                      <span className="text-xs text-muted-foreground/50">Just describe it — I'll handle the rest</span>
                    </div>
                  )}
                  {/* Load more indicator - shown when there are older messages */}
                  {hasMoreAbove && (
                    <div className="text-center text-muted-foreground/60 text-xs py-3 select-none">
                      ↑ Scroll up for earlier messages ({startIndex} more)
                    </div>
                  )}
                  {turns.map((turn, index) => {
                    // Compute turn key and check if it's a search match
                    const getTurnKey = () => {
                      if (turn.type === 'user') return `user-${turn.message.id}`
                      if (turn.type === 'system') return `system-${turn.message.id}`
                      if (turn.type === 'auth-request') return `auth-${turn.message.id}`
                      return `turn-${turn.turnId}-${turn.timestamp}`
                    }
                    const turnKey = getTurnKey()
                    const isCurrentMatch = isSearchActive && matchingTurnIds[currentMatchIndex] === turnKey
                    const isAnyMatch = isSearchActive && matchingTurnIds.includes(turnKey)

                    // User turns - render with MemoizedMessageBubble
                    // Extra padding creates visual separation from AI responses
                    if (turn.type === 'user') {
                      return (
                        <div
                          key={turnKey}
                          ref={el => { if (el) turnRefs.current.set(turnKey, el); else turnRefs.current.delete(turnKey) }}
                          className={cn(
                            CHAT_LAYOUT.userMessagePadding,
                            "rounded-lg transition-all duration-200",
                            isCurrentMatch && "ring-2 ring-info ring-offset-2 ring-offset-background",
                            isAnyMatch && !isCurrentMatch && "ring-1 ring-info/30"
                          )}
                        >
                          <MemoizedMessageBubble
                            message={turn.message}
                            onOpenFile={onOpenFile}
                            onOpenUrl={onOpenUrl}
                            compactMode={compactMode}
                          />
                        </div>
                      )
                    }

                    // System turns (error, status, info, warning) - render with MemoizedMessageBubble
                    if (turn.type === 'system') {
                      return (
                        <div
                          key={turnKey}
                          ref={el => { if (el) turnRefs.current.set(turnKey, el); else turnRefs.current.delete(turnKey) }}
                          className={cn(
                            "rounded-lg transition-all duration-200",
                            isCurrentMatch && "ring-2 ring-info ring-offset-2 ring-offset-background",
                            isAnyMatch && !isCurrentMatch && "ring-1 ring-info/30"
                          )}
                        >
                          <MemoizedMessageBubble
                            message={turn.message}
                            onOpenFile={onOpenFile}
                            onOpenUrl={onOpenUrl}
                          />
                        </div>
                      )
                    }

                    // Auth-request turns - render inline auth UI
                    // mt-2 matches ResponseCard spacing for visual consistency
                    if (turn.type === 'auth-request') {
                      // Interactive only if no user message follows
                      const isAuthInteractive = !turns.slice(index + 1).some(t => t.type === 'user')
                      return (
                        <div
                          key={turnKey}
                          ref={el => { if (el) turnRefs.current.set(turnKey, el); else turnRefs.current.delete(turnKey) }}
                          className={cn(
                            "mt-2 rounded-lg transition-all duration-200",
                            isCurrentMatch && "ring-2 ring-info ring-offset-2 ring-offset-background",
                            isAnyMatch && !isCurrentMatch && "ring-1 ring-info/30"
                          )}
                        >
                          <MemoizedAuthRequestCard
                            message={turn.message}
                            sessionId={session.id}
                            onRespondToCredential={onRespondToCredential}
                            isInteractive={isAuthInteractive}
                          />
                        </div>
                      )
                    }

                    // Check if this is the last response (for Accept Plan button visibility)
                    const isLastResponse = index === turns.length - 1 || !turns.slice(index + 1).some(t => t.type === 'user')

                    // Assistant turns - render with TurnCard (buffered streaming)
                    return (
                      <div
                        key={turnKey}
                        ref={el => { if (el) turnRefs.current.set(turnKey, el); else turnRefs.current.delete(turnKey) }}
                        className={cn(
                          "rounded-lg transition-all duration-200",
                          isCurrentMatch && "ring-2 ring-info ring-offset-2 ring-offset-background",
                          isAnyMatch && !isCurrentMatch && "ring-1 ring-info/30"
                        )}
                      >
                      <TurnCard
                        sessionId={session.id}
                        sessionFolderPath={session.sessionFolderPath}
                        turnId={turn.turnId}
                        activities={turn.activities}
                        response={turn.response}
                        intent={turn.intent}
                        isStreaming={turn.isStreaming}
                        isComplete={turn.isComplete}
                        isExpanded={expandedTurns.has(turn.turnId)}
                        onExpandedChange={(expanded) => toggleTurn(turn.turnId, expanded)}
                        expandedActivityGroups={expandedActivityGroups}
                        onExpandedActivityGroupsChange={setExpandedActivityGroups}
                        todos={turn.todos}
                        onOpenFile={onOpenFile}
                        onOpenUrl={onOpenUrl}
                        isLastResponse={isLastResponse}
                        compactMode={compactMode}
                        onAcceptPlan={() => {
                          window.dispatchEvent(new CustomEvent('craft:approve-plan', {
                            detail: { text: 'Plan approved, please execute.', sessionId: session?.id }
                          }))
                        }}
                        onAcceptPlanWithCompact={() => {
                          // Find the most recent plan message to get its path
                          // After compaction, Claude needs to know which plan file to read
                          const planMessage = session?.messages.findLast(m => m.role === 'plan')
                          const planPath = planMessage?.planPath

                          // Dispatch event to compact conversation first, then execute plan
                          // FreeFormInput handles this by sending /compact, waiting for completion,
                          // then sending a message with the plan path for Claude to read and execute
                          window.dispatchEvent(new CustomEvent('craft:approve-plan-with-compact', {
                            detail: { sessionId: session?.id, planPath }
                          }))
                        }}
                        onPopOut={(text) => {
                          // Open raw markdown source in code viewer
                          setOverlayState({
                            type: 'markdown',
                            content: text,
                            title: 'Response Preview',
                            forceCodeView: true,
                          })
                        }}
                        onOpenDetails={() => {
                          // Open turn details in markdown overlay
                          const markdown = formatTurnAsMarkdown(turn)
                          setOverlayState({
                            type: 'markdown',
                            content: markdown,
                            title: 'Turn Details',
                          })
                        }}
                        onOpenActivityDetails={(activity) => {
                          // Write tool for .md/.txt → Document overlay (rendered markdown)
                          // rather than multi-diff, since these are better viewed as formatted documents
                          const isDocumentWrite = activity.toolName === 'Write' && (() => {
                            const actInput = activity.toolInput as Record<string, unknown> | undefined
                            const fp = (actInput?.file_path as string) || ''
                            const ext = fp.split('.').pop()?.toLowerCase()
                            return ext === 'md' || ext === 'txt'
                          })()

                          // Edit/Write tool → Multi-file diff overlay (ungrouped, focused on this change)
                          // Exception: Write to .md/.txt files goes to document overlay instead
                          if ((activity.toolName === 'Edit' || activity.toolName === 'Write') && !isDocumentWrite) {
                            const changes = collectFileChanges(turn.activities)
                            if (changes.length > 0) {
                              setOverlayState({
                                type: 'multi-diff',
                                changes,
                                consolidated: false, // Ungrouped mode - show individual changes
                                focusedChangeId: activity.id, // Focus on clicked activity
                              })
                            }
                          } else {
                            // All other tools → Use extractOverlayData for appropriate overlay
                            setOverlayState({ type: 'activity', activity })
                          }
                        }}
                        hasEditOrWriteActivities={turn.activities.some(a =>
                          a.toolName === 'Edit' || a.toolName === 'Write'
                        )}
                        onOpenMultiFileDiff={() => {
                          const changes = collectFileChanges(turn.activities)
                          if (changes.length > 0) {
                            setOverlayState({
                              type: 'multi-diff',
                              changes,
                              consolidated: true, // Consolidated mode - group by file
                            })
                          }
                        }}
                      />
                      </div>
                    )
                  })}
                    </motion.div>
                    )}
                    </AnimatePresence>
                  </motion.div>
                </AnimatePresence>
                {/* Processing Indicator - always visible while processing */}
                {session.isProcessing && (() => {
                  // Find the last user message timestamp for accurate elapsed time
                  const lastUserMsg = [...session.messages].reverse().find(m => m.role === 'user')
                  return (
                    <ProcessingIndicator
                      startTime={lastUserMsg?.timestamp}
                      statusMessage={session.currentStatus?.message}
                    />
                  )
                })()}
                {/* Scroll Anchor: For auto-scroll to bottom */}
                <div ref={messagesEndRef} />
              </div>
              </ScrollArea>
            </div>
          </div>

          {/* === INPUT CONTAINER: FreeForm or Structured Input === */}
          <div className={cn(
            CHAT_LAYOUT.maxWidth,
            "mx-auto w-full px-4 mt-1",
            compactMode ? "pb-4" : "pb-4"
          )}>
            {/* Active option badges and tasks - positioned above input */}
            {!compactMode && (
            <ActiveOptionBadges
              ultrathinkEnabled={ultrathinkEnabled}
              onUltrathinkChange={onUltrathinkChange}
              permissionMode={permissionMode}
              onPermissionModeChange={onPermissionModeChange}
              tasks={backgroundTasks}
              sessionId={session.id}
              onKillTask={(taskId) => killTask(taskId, backgroundTasks.find(t => t.id === taskId)?.type ?? 'shell')}
              onInsertMessage={onInputChange}
              sessionLabels={session.labels}
              labels={labels}
              onLabelsChange={onLabelsChange}
              onRemoveLabel={(labelId) => {
                // Remove label from session and persist (legacy fallback)
                const newLabels = (session.labels || []).filter(id => id !== labelId)
                onLabelsChange?.(newLabels)
              }}
              autoOpenLabelId={autoOpenLabelId}
              onAutoOpenConsumed={() => setAutoOpenLabelId(null)}
              todoStates={todoStates}
              currentTodoState={session.todoState || 'todo'}
              onTodoStateChange={onTodoStateChange}
            />
            )}
            <InputContainer
              compactMode={compactMode}
              placeholder={placeholder}
              disabled={isInputDisabled}
              isProcessing={session.isProcessing}
              onAnimatedHeightChange={handleAnimatedHeightChange}
              onSubmit={handleSubmit}
              onStop={handleStop}
              textareaRef={textareaRef}
              currentModel={currentModel}
              onModelChange={onModelChange}
              thinkingLevel={thinkingLevel}
              onThinkingLevelChange={onThinkingLevelChange}
              ultrathinkEnabled={ultrathinkEnabled}
              onUltrathinkChange={onUltrathinkChange}
              permissionMode={permissionMode}
              onPermissionModeChange={onPermissionModeChange}
              enabledModes={enabledModes}
              structuredInput={structuredInput}
              onStructuredResponse={handleStructuredResponse}
              inputValue={inputValue}
              onInputChange={onInputChange}
              sources={sources}
              enabledSourceSlugs={session.enabledSourceSlugs}
              onSourcesChange={onSourcesChange}
              skills={skills}
              labels={labels}
              sessionLabels={session.labels}
              onLabelAdd={(labelId) => {
                // Add label to session (prevent duplicates) and persist
                const current = session.labels || []
                if (!current.includes(labelId)) {
                  onLabelsChange?.([...current, labelId])
                  // If the label has a valueType, auto-open its popover so the user
                  // can set the value immediately without an extra click.
                  const flat = flattenLabels(labels || [])
                  const config = flat.find(l => l.id === labelId)
                  if (config?.valueType) {
                    setAutoOpenLabelId(labelId)
                  }
                }
              }}
              workspaceId={workspaceId}
              workingDirectory={workingDirectory}
              onWorkingDirectoryChange={onWorkingDirectoryChange}
              sessionFolderPath={sessionFolderPath}
              sessionId={session.id}
              currentTodoState={session.todoState || 'todo'}
              disableSend={disableSend || connectionUnavailable}
              connectionUnavailable={connectionUnavailable}
              isEmptySession={session.messages.length === 0}
              currentConnection={session.llmConnection}
              onConnectionChange={onConnectionChange}
              contextStatus={{
                isCompacting: session.currentStatus?.statusType === 'compacting',
                inputTokens: session.tokenUsage?.inputTokens,
                contextWindow: session.tokenUsage?.contextWindow,
              }}
            />
          </div>
          </div>
        </div>
      ) : null}

      {/* ================================================================== */}
      {/* Preview Overlays - Rendered outside the main chat flow            */}
      {/* ================================================================== */}

      {/* Code preview overlay (Read tool) */}
      {overlayData?.type === 'code' && (
        <CodePreviewOverlay
          isOpen={!!overlayState}
          onClose={handleCloseOverlay}
          content={overlayData.content}
          filePath={overlayData.filePath}
          mode={overlayData.mode}
          startLine={overlayData.startLine}
          totalLines={overlayData.totalLines}
          numLines={overlayData.numLines}
          theme={isDark ? 'dark' : 'light'}
          error={overlayData.error}
          command={overlayData.command}
        />
      )}

      {/* Multi-diff preview overlay (Edit/Write tools) */}
      {overlayState?.type === 'multi-diff' && (
        <MultiDiffPreviewOverlay
          isOpen={true}
          onClose={handleCloseOverlay}
          changes={overlayState.changes}
          consolidated={overlayState.consolidated}
          focusedChangeId={overlayState.focusedChangeId}
          theme={isDark ? 'dark' : 'light'}
          diffViewerSettings={diffViewerSettings}
          onDiffViewerSettingsChange={handleDiffViewerSettingsChange}
        />
      )}

      {/* Terminal preview overlay (Bash/Grep/Glob tools) */}
      {overlayData?.type === 'terminal' && (
        <TerminalPreviewOverlay
          isOpen={!!overlayState}
          onClose={handleCloseOverlay}
          command={overlayData.command}
          output={overlayData.output}
          exitCode={overlayData.exitCode}
          toolType={overlayData.toolType}
          description={overlayData.description}
          theme={isDark ? 'dark' : 'light'}
          error={overlayData.error}
        />
      )}

      {/* JSON preview overlay (MCP tools, WebSearch, etc.) */}
      {overlayData?.type === 'json' && (
        <JSONPreviewOverlay
          isOpen={!!overlayState}
          onClose={handleCloseOverlay}
          data={overlayData.data}
          title={overlayData.title}
          theme={isDark ? 'dark' : 'light'}
          error={overlayData.error}
        />
      )}

      {/* Document overlay (Write tool → .md/.txt files) — rendered markdown with tool badge */}
      {overlayData?.type === 'document' && (
        <DocumentFormattedMarkdownOverlay
          isOpen={!!overlayState}
          onClose={handleCloseOverlay}
          content={overlayData.content}
          filePath={overlayData.filePath}
          typeBadge={{ icon: PenLine, label: overlayData.toolName, variant: 'write' }}
          onOpenUrl={onOpenUrl}
          onOpenFile={onOpenFile}
          error={overlayData.error}
          variant={isPlanFilePath(overlayData.filePath) ? 'plan' : 'response'}
        />
      )}

      {/* Markdown preview overlay (pop-out, turn details) */}
      {/* forceCodeView: show raw markdown source in code viewer (used by "View as Markdown" button) */}
      {/* otherwise: render formatted markdown (used by turn details, etc.) */}
      {overlayState?.type === 'markdown' && (
        overlayState.forceCodeView ? (
          <CodePreviewOverlay
            isOpen={true}
            onClose={handleCloseOverlay}
            content={overlayState.content}
            filePath="response.md"
            language="markdown"
            mode="read"
            theme={isDark ? 'dark' : 'light'}
          />
        ) : (
          <DocumentFormattedMarkdownOverlay
            isOpen={true}
            onClose={handleCloseOverlay}
            content={overlayState.content}
            onOpenUrl={onOpenUrl}
            onOpenFile={onOpenFile}
          />
        )
      )}

      {/* Generic overlay for unknown tool types - route markdown to fullscreen viewer */}
      {overlayData?.type === 'generic' && (
        detectLanguage(overlayData.content) === 'markdown' ? (
          <DocumentFormattedMarkdownOverlay
            isOpen={true}
            onClose={handleCloseOverlay}
            content={overlayData.content}
            onOpenUrl={onOpenUrl}
            onOpenFile={onOpenFile}
            error={overlayData.error}
          />
        ) : (
          <GenericOverlay
            isOpen={!!overlayState}
            onClose={handleCloseOverlay}
            content={overlayData.content}
            title={overlayData.title}
            theme={isDark ? 'dark' : 'light'}
            error={overlayData.error}
          />
        )
      )}
    </div>
  )
})

/**
 * MessageBubble - Renders a single message based on its role
 *
 * Message Roles & Styles:
 * - user:      Right-aligned, blue (bg-foreground), white text
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
  /** Compact mode - reduces padding for popover embedding */
  compactMode?: boolean
}

/**
 * ErrorMessage - Separate component for error messages to allow useState hook
 */
function ErrorMessage({ message }: { message: Message }) {
  const hasDetails = (message.errorDetails && message.errorDetails.length > 0) || message.errorOriginal
  const [detailsOpen, setDetailsOpen] = React.useState(false)

  return (
    <div className="flex justify-start mt-4">
      {/* Subtle bg (3% opacity) + tinted shadow for softer error appearance */}
      <div
        className="max-w-[80%] shadow-tinted rounded-[8px] pl-5 pr-4 pt-2 pb-2.5 break-words"
        style={{
          backgroundColor: 'oklch(from var(--destructive) l c h / 0.03)',
          '--shadow-color': 'var(--destructive-rgb)',
        } as React.CSSProperties}
      >
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
  compactMode,
}: MessageBubbleProps) {
  // === USER MESSAGE: Right-aligned bubble with attachments above ===
  if (message.role === 'user') {
    return (
      <UserMessageBubble
        content={message.content}
        attachments={message.attachments}
        badges={message.badges}
        isPending={message.isPending}
        isQueued={message.isQueued}
        ultrathink={message.ultrathink}
        onUrlClick={onOpenUrl}
        onFileClick={onOpenFile}
        compactMode={compactMode}
      />
    )
  }

  // === ASSISTANT MESSAGE: Left-aligned gray bubble with markdown rendering ===
  if (message.role === 'assistant') {
    return (
      <div className="flex justify-start group">
        <div className="relative max-w-[90%] bg-background shadow-minimal rounded-[8px] pl-6 pr-4 py-3 break-words min-w-0 select-text">
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
    // Compaction complete message - render as horizontal rule with centered label
    // This persists after reload to show where context was compacted
    if (message.statusType === 'compaction_complete') {
      return (
        <div className="flex items-center gap-3 my-12 px-3">
          <div className="flex-1 h-px bg-border" />
          <span className="text-sm text-muted-foreground/70 select-none">
            Conversation Compacted
          </span>
          <div className="flex-1 h-px bg-border" />
        </div>
      )
    }

    const level = message.infoLevel || 'info'
    const config = {
      info: { icon: Info, className: 'text-muted-foreground' },
      warning: { icon: AlertTriangle, className: 'text-info' },
      error: { icon: CircleAlert, className: 'text-destructive' },
      success: { icon: CheckCircle2, className: 'text-success' },
    }[level]
    const Icon = config.icon

    return (
      <div className={cn('flex items-center gap-2 px-3 py-1 text-[13px] select-none', config.className)}>
        <div className="w-3 h-3 flex items-center justify-center shrink-0">
          <Icon className="w-3 h-3" />
        </div>
        <span>{message.content}</span>
      </div>
    )
  }

  // === WARNING MESSAGE: Info themed bubble ===
  if (message.role === 'warning') {
    return (
      <div className="flex justify-start">
        <div className="max-w-[80%] bg-info/10 rounded-[8px] pl-5 pr-4 pt-2 pb-2.5 break-words select-none">
          <div className="text-xs text-info/50 mb-0.5 font-semibold">
            Warning
          </div>
          <p className="text-sm text-info">{message.content}</p>
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
    prev.message.role === next.message.role &&
    prev.compactMode === next.compactMode
  )
})
