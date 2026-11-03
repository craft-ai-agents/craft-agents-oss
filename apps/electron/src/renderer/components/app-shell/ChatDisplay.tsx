import * as React from "react"
import { useTranslation } from "react-i18next"
import { useEffect, useState, useMemo, useCallback } from "react"
import { Bot, Info } from "lucide-react"
import { toast } from "sonner"

import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { coerceInputText, appendRestoredInput } from "@/lib/input-text"
import { useDelayedLoading } from "@/hooks/useDelayedLoading"
import {
  parseReadResult,
  parseBashResult,
  parseGrepResult,
  parseGlobResult,
  extractOverlayData,
  extractOverlayCards,
  ActivityCardsOverlay,
  CodePreviewOverlay,
  MultiDiffPreviewOverlay,
  TerminalPreviewOverlay,
  GenericOverlay,
  JSONPreviewOverlay,
  DocumentFormattedMarkdownOverlay,
  detectLanguage,
  type ActivityItem,
  type FileChange,
  type DiffViewerSettings,
  RunCommandProvider,
} from "@craft-agent/ui"
import { useFocusZone } from "@/hooks/keyboard"
import { useTheme } from "@/hooks/useTheme"
import type { Session, Message, FileAttachment, StoredAttachment, PermissionRequest, CredentialRequest, CredentialResponse, LoadedSource, LoadedSkill } from "../../../shared/types"
import type { PermissionMode } from "@craft-agent/shared/agent/modes"
import type { ThinkingLevel } from "@craft-agent/shared/agent/thinking-levels"
import {
  TurnCard,
  groupMessagesByTurn,
  formatTurnAsMarkdown,
  formatActivityAsMarkdown,
  getAssistantTurnUiKey,
  asRecord,
  getAnnotationNoteText,
  isAnnotationFollowUpSent,
  extractAnnotationSelectedText,
  normalizeFollowUpText,
  type Turn,
  type AssistantTurn,
  type UserTurn,
  type SystemTurn,
  type AuthRequestTurn,
} from "@craft-agent/ui"
import { MemoizedAuthRequestCard } from "@/components/chat/AuthRequestCard"
import { ChatInputZone, type StructuredInputState, type StructuredResponse, type PermissionResponse, type AdminApprovalResponse } from "./input"
import type { RichTextInputHandle } from "@/components/ui/rich-text-input"
import { useBackgroundTasks } from "@/hooks/useBackgroundTasks"
import type { BackgroundTask } from "@/atoms/sessions"
import type { BackgroundTaskOutput } from "@craft-agent/shared/protocol"
import { agentDocument } from "./BackgroundTaskChip"
import { runCommandMessage } from "@/lib/run-command-message"
import { useTurnCardExpansion } from "@/hooks/useTurnCardExpansion"
import { useNavigation } from "@/contexts/NavigationContext"
import { useAppShellContext } from "@/context/AppShellContext"
import { navigate, routes } from "@/lib/navigate"
import { CHAT_LAYOUT } from "@/config/layout"
import { collectFileChangesFromActivities, getFirstFileChangeIdForActivity } from "@/lib/file-changes"
import { resolveBranchNewPanelOption } from "./branching"
import { MemoizedMessageBubble } from "./chat-display/MessageBubble"
import { ProcessingIndicator } from "./chat-display/ProcessingIndicator"
import { ScrollOnMount } from "./chat-display/ScrollOnMount"
import { TurnFrame } from "./chat-display/TurnFrame"
import { NewChatSuggestions } from "./chat-display/NewChatSuggestions"
import { TaskBriefState } from "./chat-display/TaskBrief"
import { newChatSuggestionMentions, newChatSuggestionMessage, pickNewChatSuggestions, pickCustomSuggestions, type NewChatSuggestion } from "./chat-display/new-chat-suggestions"
import {
  CompactEmptyState,
  NewChatEmptyState,
  EarlierMessagesHint,
  NoRenderableMessages,
  TranscriptLoadError,
  TranscriptSkeleton,
} from "./chat-display/TranscriptStates"

// ============================================================================
// CSS Custom Highlight API helper
// ============================================================================

/** Access CSS.highlights lazily — avoids stale ref from module-init / HMR timing */
function getCSSHighlights(): Map<string, Highlight> | undefined {
  try {
    return (CSS as any).highlights as Map<string, Highlight> | undefined
  } catch {
    return undefined
  }
}

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

/** State for a background task's full output (the task chip's card → Open) */
interface TaskOutputOverlayState {
  type: 'task-output'
  title: string
  output: BackgroundTaskOutput
}

/** Union of all overlay states, or null for no overlay */
type OverlayState =
  | { type: 'activity'; activity: ActivityItem }
  | MultiDiffOverlayState
  | MarkdownOverlayState
  | TaskOutputOverlayState
  | null

function isStackedActivityTool(activity: ActivityItem): boolean {
  const toolName = activity.toolName?.toLowerCase() || ''
  return toolName === 'bash' || toolName.startsWith('mcp__') || toolName.startsWith('browser_')
}

function getTurnKey(turn: Turn): string {
  if (turn.type === 'user') return `user-${turn.message.id}`
  if (turn.type === 'system') return `system-${turn.message.id}`
  if (turn.type === 'auth-request') return `auth-${turn.message.id}`
  return `turn-${turn.turnId}-${turn.timestamp}`
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
  onRespondToPermission?: (
    sessionId: string,
    requestId: string,
    allowed: boolean,
    alwaysAllow: boolean,
    options?: import('../../../shared/types').PermissionResponseOptions
  ) => void
  /** Pending credential request for this session */
  pendingCredential?: CredentialRequest
  /** Callback to respond to credential request */
  onRespondToCredential?: (sessionId: string, requestId: string, response: CredentialResponse) => void
  // Thinking level (session-level setting)
  /** Current thinking level ('off', 'think', 'max') */
  thinkingLevel?: ThinkingLevel
  /** Callback when thinking level changes */
  onThinkingLevelChange?: (level: ThinkingLevel) => void
  // Coding mode (session-level, fixed once the conversation starts)
  /** Coding mode is on: lean coding prompt and session tools */
  codingMode?: boolean
  /** Toggle coding mode (only before the first message) */
  onCodingModeChange?: (enabled: boolean) => void
  // Advanced options
  /** Current permission mode */
  permissionMode?: PermissionMode
  /** Mode before the last change (plan approval returns to Guarded from it) */
  previousPermissionMode?: PermissionMode
  onPermissionModeChange?: (mode: PermissionMode) => void
  /** Enabled permission modes for Shift+Tab cycling */
  enabledModes?: PermissionMode[]
  // Input value preservation (controlled from parent)
  /** Current input value - preserved across mode switches and conversation changes */
  inputValue?: string
  /** Callback when input value changes */
  onInputChange?: (value: string) => void
  /** Persisted attachment draft for this session (hydrated from disk in ChatPage) */
  attachmentsValue?: FileAttachment[]
  /** Callback when attachment draft changes (add, remove, clear on send) */
  onAttachmentsChange?: (attachments: FileAttachment[]) => void
  // Source selection
  /** Available sources (enabled only) */
  sources?: LoadedSource[]
  /** User-defined chat starters from workspace config; replaces auto-generated suggestions when non-empty. */
  chatStarters?: Array<{ label: string; prompt: string }>
  /** Callback when source selection changes */
  onSourcesChange?: (slugs: string[]) => void
  // Skill selection (for @mentions)
  /** Available skills for @mention autocomplete */
  skills?: LoadedSkill[]
  // Label selection (for the composer's # menu; the chips themselves live in the chat header)
  /** Available label configs (tree) for the label menu */
  labels?: import('@craft-agent/shared/labels').LabelConfig[]
  /** Callback when labels change */
  onLabelsChange?: (labels: string[]) => void
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
  /** Message load failure shown instead of an infinite spinner */
  messagesLoadError?: string | null
  /** Whether a retry is currently in flight */
  messagesRetrying?: boolean
  /** Retry lazy-loading the session transcript */
  onRetryMessagesLoad?: () => void
  // Tutorial
  /** Disable send action (for tutorial guidance) */
  disableSend?: boolean
  // Search highlighting (from session list search)
  /** Search query for highlighting matches - passed from session list */
  searchQuery?: string
  /** Whether search mode is active (prevents focus stealing to chat input) */
  isSearchModeActive?: boolean
  /** Callback when match info changes - for immediate UI updates */
  onMatchInfoChange?: (info: { count: number; index: number; isHighlighting: boolean; sessionId: string | null }) => void
  // Compact mode (for EditPopover embedding and auto-compact / WebUI mobile)
  /** Enable compact mode - hides non-essential UI elements for popover embedding */
  compactMode?: boolean
  /**
   * When compactMode is true, enable the compact (drawer-based) model selector
   * next to the permission-mode pill. Defaults to false so EditPopover keeps
   * its current behavior; ChatPage opts in when in auto-compact / mobile.
   */
  enableCompactModelPicker?: boolean
  /** Custom placeholder for input (used in compact mode for edit context) */
  placeholder?: string | string[]
  /** Label shown as empty state in compact mode (e.g., "Permission Settings") */
  emptyStateLabel?: string
  /** When true, the session's locked connection has been removed - disables send and shows unavailable state */
  connectionUnavailable?: boolean
}

import {
  formatFollowUpSection,
  normalizeFollowUpsMarkdown,
  truncateForChipTooltip,
  type PendingFollowUpAnnotation,
} from './ChatDisplay.follow-ups'

/**
 * Imperative handle exposed via forwardRef for navigation between matches
 */
export interface ChatDisplayHandle {
  goToNextMatch: () => void
  goToPrevMatch: () => void
  matchCount: number
  currentMatchIndex: number
  isHighlighting: boolean
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
  thinkingLevel = 'medium',
  onThinkingLevelChange,
  codingMode = false,
  onCodingModeChange,
  // Advanced options
  permissionMode = 'ask',
  previousPermissionMode,
  onPermissionModeChange,
  enabledModes,
  // Input value preservation
  inputValue,
  onInputChange,
  attachmentsValue,
  onAttachmentsChange,
  // Sources
  sources,
  chatStarters,
  onSourcesChange,
  // Skills (for @mentions)
  skills,
  // Labels (for #labels)
  labels,
  onLabelsChange,
  workspaceId,
  // Working directory
  workingDirectory,
  onWorkingDirectoryChange,
  sessionFolderPath,
  // Lazy loading
  messagesLoading = false,
  messagesLoadError,
  messagesRetrying = false,
  onRetryMessagesLoad,
  // Tutorial
  disableSend = false,
  // Search highlighting
  searchQuery: externalSearchQuery,
  isSearchModeActive = false,
  onMatchInfoChange,
  // Compact mode (for EditPopover embedding and auto-compact / WebUI mobile)
  compactMode = false,
  enableCompactModelPicker = false,
  placeholder,
  emptyStateLabel,
  // Connection unavailable
  connectionUnavailable = false,
}, ref) {
  const { t } = useTranslation()

  // Panel focus state (for multi-panel auto-scroll behavior)
  const appShellContext = useAppShellContext()
  const isFocusedPanel = appShellContext?.isFocusedPanel ?? true

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
  // Mirror isFocusedPanel into a ref so the ResizeObserver closure reads the latest value
  const isFocusedPanelRef = React.useRef(isFocusedPanel)
  isFocusedPanelRef.current = isFocusedPanel
  // Skip smooth scroll briefly after session switch (instant scroll already happened)
  const skipSmoothScrollUntilRef = React.useRef(0)
  // Track message commit boundaries so we can auto-scroll when a new user message
  // actually lands in state (important when attachments delay optimistic insertion).
  const prevLastMessageIdRef = React.useRef<string | null>(null)
  const prevMessageCountRef = React.useRef(0)
  const prevSessionIdForCommitScrollRef = React.useRef<string | null>(null)
  const internalTextareaRef = React.useRef<RichTextInputHandle>(null)
  const textareaRef = externalTextareaRef || internalTextareaRef
  const [sendMessageKey, setSendMessageKey] = useState<'enter' | 'cmd-enter'>('enter')
  const [openAnnotationRequest, setOpenAnnotationRequest] = React.useState<{
    messageId: string
    annotationId: string
    mode: 'view' | 'edit'
    anchorX?: number
    anchorY?: number
    nonce: number
  } | null>(null)
  const followUpOpenNonceRef = React.useRef(0)

  // Navigation for session branching
  const { navigate } = useNavigation()

  // Get isDark from useTheme hook for overlay theme
  // This accounts for scenic themes (like Haze) that force dark mode
  const { isDark } = useTheme()

  // Register as focus zone - when zone gains focus, focus the textarea
  // Guard with isFocusedPanelRef so only the focused panel responds in multi-panel layouts
  const { zoneRef, isFocused } = useFocusZone({
    zoneId: 'chat',
    enabled: isFocusedPanel,
    focusFirst: () => {
      if (isFocusedPanelRef.current) {
        textareaRef.current?.focus()
      }
    },
  })

  // Background tasks management
  const { tasks: backgroundTasks, stopTask, dismissTask } = useBackgroundTasks({
    sessionId: session?.id ?? ''
  })

  // TurnCard expansion state — persisted to localStorage across session switches
  const {
    expandedTurns,
    toggleTurn,
    expandedActivityGroups,
    setExpandedActivityGroups,
  } = useTurnCardExpansion(session?.id)


  // ============================================================================
  // Search Highlighting (from session list search)
  // ============================================================================
  // Current match index for navigation (internal state, exposed via ref)
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0)
  const turnRefs = React.useRef<Map<string, HTMLDivElement>>(new Map())
  const registerTurnRef = useCallback((turnKey: string, el: HTMLDivElement | null) => {
    if (el) turnRefs.current.set(turnKey, el)
    else turnRefs.current.delete(turnKey)
  }, [])
  // Inject ::highlight() styles at runtime to avoid LightningCSS build warnings
  // (the optimizer doesn't recognize ::highlight as a valid pseudo-element yet)
  React.useEffect(() => {
    const id = 'search-highlight-styles'
    if (document.getElementById(id)) return
    const style = document.createElement('style')
    style.id = id
    style.textContent = `
      ::highlight(search-passive) { background-color: rgb(253 224 71 / 0.3); color: inherit; }
      ::highlight(search-active) { background-color: rgb(253 224 71); color: rgb(0 0 0 / 0.9); }
    `
    document.head.appendChild(style)
  }, [])
  // Flag to control when scrolling to matches should happen
  // Only scroll when: session changes with search active, or user clicks navigation
  const shouldScrollToMatchRef = React.useRef(false)
  const prevSessionIdForScrollRef = React.useRef<string | null>(null)

  // Use the external search query from props
  const searchQuery = externalSearchQuery || ''
  // Require 2+ characters to activate in-chat search (aligned with session list isSearchMode)
  const isSearchActive = searchQuery.trim().length >= 2

  // Focus textarea when zone gains focus via keyboard (Tab, Cmd+3, ArrowRight)
  // Requires isFocused to be true - respects zone architecture
  // Does NOT auto-focus just because session changed (that would steal focus from SessionList)
  // Uses isSearchModeActive (prop) instead of isSearchActive (query-based) to prevent
  // focus stealing when search is open but query is empty
  // In multi-panel layouts, only the focused panel should auto-focus its textarea
  useEffect(() => {
    if (session && !isSearchModeActive && isFocused && isFocusedPanel) {
      textareaRef.current?.focus()
    }
  }, [session?.id, isFocused, isSearchModeActive, isFocusedPanel])

  useEffect(() => {
    let isMounted = true

    const loadSendMessageKey = async () => {
      if (!window.electronAPI) return

      try {
        const key = await window.electronAPI.getSendMessageKey()
        if (!isMounted) return
        setSendMessageKey(key ?? 'enter')
      } catch (error) {
        console.error('Failed to load send message key for follow-up view:', error)
      }
    }

    loadSendMessageKey()

    return () => {
      isMounted = false
    }
  }, [])

  // Reset match state when session or search query changes
  useEffect(() => {
    const isSessionSwitch = prevSessionIdForScrollRef.current !== null && prevSessionIdForScrollRef.current !== session?.id
    prevSessionIdForScrollRef.current = session?.id ?? null

    // If session switched with search active, trigger scroll to first match
    if (isSessionSwitch && isSearchActive) {
      shouldScrollToMatchRef.current = true
    }

    setCurrentMatchIndex(0)
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
    const turns = groupMessagesByTurn(session.messages, { isSessionProcessing: session.isProcessing })
    const matches: { matchId: string; turnId: string; turnIndex: number; matchIndexInTurn: number }[] = []

    for (let turnIndex = 0; turnIndex < turns.length; turnIndex++) {
      const turn = turns[turnIndex]
      let textContent = ''
      let turnId = ''

      // Use getTurnKey() for consistent IDs between text scan and DOM refs
      turnId = getTurnKey(turn)

      if (turn.type === 'user') {
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
        if (turn.response?.text) {
          textContent = turn.response.text
        }
      } else if (turn.type === 'system') {
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
  }, [searchQuery, session?.messages, session?.isProcessing, countOccurrences])

  // Auto-expand pagination when search is active to show all matching turns
  // This ensures match count is stable and all matches are highlightable from the start
  useEffect(() => {
    if (!isSearchActive || matchingOccurrences.length === 0) return

    // Find the earliest matching turn index (reduce to avoid RangeError on large arrays)
    const earliestMatchTurnIndex = matchingOccurrences.reduce(
      (min, m) => m.turnIndex < min ? m.turnIndex : min,
      matchingOccurrences[0]!.turnIndex
    )
    const totalTurns = groupMessagesByTurn(session?.messages || [], { isSessionProcessing: session?.isProcessing }).length

    // Calculate how many turns we need to show to include all matches
    // totalTurns - visibleTurnCount = startIndex, so we need visibleTurnCount = totalTurns - earliestMatchTurnIndex + buffer
    const requiredVisibleCount = totalTurns - earliestMatchTurnIndex + 5 // +5 buffer for context

    if (requiredVisibleCount > visibleTurnCount) {
      setVisibleTurnCount(requiredVisibleCount)
    }
  }, [isSearchActive, matchingOccurrences, session?.messages, session?.isProcessing, visibleTurnCount])

  // Extract unique turn IDs that have matches (for highlighting)
  const matchingTurnIds = useMemo(() => {
    const uniqueTurnIds = new Set(matchingOccurrences.map(m => m.turnId))
    return Array.from(uniqueTurnIds)
  }, [matchingOccurrences])

  // With CSS Custom Highlight API, navigation is driven by logical matches — no DOM verification needed.
  const validMatches = matchingOccurrences

  // Auto-scroll to match ONLY when there's exactly one match
  // Multiple matches: user navigates with chevrons to avoid jarring scroll
  useEffect(() => {
    if (validMatches.length === 1 && isSearchActive) {
      shouldScrollToMatchRef.current = true
    }
  }, [validMatches.length, isSearchActive])

  // Scroll to current match turn
  // Only scrolls when shouldScrollToMatchRef is true (single match auto-scroll or nav button click)
  useEffect(() => {
    if (!shouldScrollToMatchRef.current) return

    if (validMatches.length > 0 && currentMatchIndex < validMatches.length) {
      const matchData = validMatches[currentMatchIndex]
      const { turnId, turnIndex } = matchData
      const totalTurns = totalTurnCountRef.current

      // Check if the match is outside the visible range
      const currentStartIndex = Math.max(0, totalTurns - visibleTurnCount)
      if (turnIndex < currentStartIndex) {
        const newVisibleCount = totalTurns - turnIndex + 5
        setVisibleTurnCount(newVisibleCount)
        return
      }

      // Scroll the turn into view
      const turnEl = turnRefs.current.get(turnId)
      if (turnEl) {
        const rect = turnEl.getBoundingClientRect()
        const buffer = 128
        const isVisible = rect.top >= buffer && rect.bottom <= window.innerHeight - buffer
        if (!isVisible) {
          turnEl.scrollIntoView({ behavior: 'instant', block: 'center' })
        }
      }
      shouldScrollToMatchRef.current = false
    }
  }, [validMatches, currentMatchIndex, session?.id, visibleTurnCount])

  // ---------------------------------------------------------------------------
  // CSS Custom Highlight API — non-destructive text highlighting
  // Creates browser-native highlight ranges over matching text without
  // modifying the DOM tree. Safe with React re-renders and streaming.
  // Uses cross-node matching: concatenates text across node boundaries
  // to find matches that span multiple DOM nodes (e.g. Shiki-split tokens).
  // ---------------------------------------------------------------------------

  const MAX_HIGHLIGHT_RANGES = 5000
  // Store computed ranges so the active-match effect can restyle without re-walking the DOM
  const highlightRangesRef = React.useRef<Range[]>([])

  // Effect 1: Walk DOM and collect highlight ranges when search/session/pagination changes
  useEffect(() => {
    const cssHighlights = getCSSHighlights()
    highlightRangesRef.current = []

    // Clear previous highlights
    try {
      cssHighlights?.delete('search-passive')
      cssHighlights?.delete('search-active')
    } catch { /* API unavailable — no-op */ }

    if (!searchQuery.trim() || !isSearchActive || !cssHighlights) return

    const query = searchQuery.toLowerCase()
    const matchingTurnIdSet = new Set(matchingTurnIds)
    if (matchingTurnIdSet.size === 0) return

    const rafId = requestAnimationFrame(() => {
      const allRanges: Range[] = []

      turnRefs.current.forEach((container, turnKey) => {
        if (allRanges.length >= MAX_HIGHLIGHT_RANGES) return
        if (!matchingTurnIdSet.has(turnKey)) return

        // For assistant turns, narrow search to response content root
        const searchRoot = container.querySelector('[data-search-root="response"]') || container

        // Collect ALL eligible text nodes (no query filter — needed for cross-node matching)
        const walker = document.createTreeWalker(
          searchRoot,
          NodeFilter.SHOW_TEXT,
          {
            acceptNode: (node) => {
              const parent = node.parentElement
              if (!parent) return NodeFilter.FILTER_REJECT
              const tag = parent.tagName.toLowerCase()
              if (tag === 'script' || tag === 'style') return NodeFilter.FILTER_REJECT
              if (parent.closest('[data-search-exclude="true"]')) return NodeFilter.FILTER_REJECT
              return NodeFilter.FILTER_ACCEPT
            },
          }
        )

        // Build concatenated string with node offset mapping for cross-node matching
        const textNodes: Text[] = []
        let currentNode: Node | null
        while ((currentNode = walker.nextNode())) {
          textNodes.push(currentNode as Text)
        }
        if (textNodes.length === 0) return

        const nodeOffsets: { node: Text; start: number; end: number }[] = []
        let totalLength = 0
        for (const node of textNodes) {
          const text = node.textContent || ''
          nodeOffsets.push({ node, start: totalLength, end: totalLength + text.length })
          totalLength += text.length
        }
        const concatenated = textNodes.map(n => n.textContent || '').join('')
        const lowerConcatenated = concatenated.toLowerCase()

        // Find all matches in the concatenated string
        let searchPos = 0
        while (searchPos < lowerConcatenated.length && allRanges.length < MAX_HIGHLIGHT_RANGES) {
          const idx = lowerConcatenated.indexOf(query, searchPos)
          if (idx === -1) break
          const matchEnd = idx + query.length

          // Create a Range spanning the match (may cross node boundaries)
          try {
            const range = new Range()
            let startSet = false

            for (const offset of nodeOffsets) {
              if (offset.end <= idx) continue
              if (offset.start >= matchEnd) break

              if (!startSet) {
                range.setStart(offset.node, idx - offset.start)
                startSet = true
              }
              range.setEnd(offset.node, Math.min(offset.end - offset.start, matchEnd - offset.start))
            }

            if (startSet) {
              allRanges.push(range)
            }
          } catch {
            // Range creation can fail if node was removed during walk
          }

          searchPos = matchEnd
        }
      })

      // Store ranges for the active-match effect to use
      highlightRangesRef.current = allRanges

      if (allRanges.length === 0 && matchingTurnIdSet.size > 0) {
        console.warn('[search-highlight] 0 ranges from', matchingTurnIdSet.size, 'matching turns — possible turn ID mismatch')
      }

      if (allRanges.length === 0) return

      try {
        // Apply all ranges as passive initially — the active-match effect will restyle
        cssHighlights.set('search-passive', new Highlight(...allRanges))
      } catch {
        // Highlight API call failed — degrade gracefully
      }
    })

    return () => cancelAnimationFrame(rafId)
  }, [searchQuery, isSearchActive, matchingTurnIds, session?.id, visibleTurnCount])

  // Effect 2: Update active/passive highlight split when navigation index changes
  // Lightweight — just reshuffles existing Range objects between two Highlight instances
  useEffect(() => {
    const cssHighlights = getCSSHighlights()
    const allRanges = highlightRangesRef.current
    if (!cssHighlights || allRanges.length === 0) return

    try {
      const activeRange = allRanges[currentMatchIndex]
      if (activeRange) {
        const passiveRanges = allRanges.filter((_, i) => i !== currentMatchIndex)
        cssHighlights.set('search-passive', new Highlight(...passiveRanges))
        cssHighlights.set('search-active', new Highlight(activeRange))
      } else {
        cssHighlights.set('search-passive', new Highlight(...allRanges))
        cssHighlights.delete('search-active')
      }
    } catch { /* graceful degradation */ }
  }, [currentMatchIndex])

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

  // With CSS Highlight API, highlighting is instant — no settling phase
  const isHighlighting = false

  // Expose navigation via imperative handle (for session list navigation controls)
  React.useImperativeHandle(ref, () => ({
    goToNextMatch,
    goToPrevMatch,
    matchCount: validMatches.length,
    currentMatchIndex,
    isHighlighting,
  }), [goToNextMatch, goToPrevMatch, validMatches.length, currentMatchIndex])

  // Notify parent when match info (count, index, highlighting state) changes
  useEffect(() => {
    onMatchInfoChange?.({
      count: validMatches.length,
      index: currentMatchIndex,
      isHighlighting,
      sessionId: session?.id ?? null,
    })
  }, [validMatches.length, currentMatchIndex, isHighlighting, session?.id, onMatchInfoChange])

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

  // Extract overlay cards for activity-based overlays (Input/Output, future extensible)
  const overlayCards = useMemo(() => {
    if (!overlayState || overlayState.type !== 'activity') return []
    return extractOverlayCards(overlayState.activity)
  }, [overlayState])

  // Parsed output data for legacy output-only activity overlays
  const activityOutputOverlayData = useMemo(() => {
    if (!overlayState || overlayState.type !== 'activity') return null
    return extractOverlayData(overlayState.activity)
  }, [overlayState])

  // Stacked input/output cards are only enabled for Bash and MCP tools
  const useStackedActivityOverlay = useMemo(() => {
    if (!overlayState || overlayState.type !== 'activity') return false
    return isStackedActivityTool(overlayState.activity)
  }, [overlayState])

  // "Run in background" on a shell/console code block or a pasted snippet: ask the agent to start it
  // as a background command (permissions apply; the task chip shows it)
  const handleRunCommand = useCallback((command: string) => {
    onSendMessage(runCommandMessage(command))
  }, [onSendMessage])

  // New-chat starter prompts (design spec §7.8): use custom starters from workspace config when
  // defined (capped at 3), otherwise fall back to source-based auto-generation.
  const newChatSuggestions = useMemo(
    () => chatStarters && chatStarters.length > 0
      ? pickCustomSuggestions(chatStarters)
      : pickNewChatSuggestions(sources ?? []),
    [chatStarters, sources]
  )

  // Coding mode is fixed once the conversation starts: continue in a new session with it switched.
  // The server carries the folder, model, sources and a summary of this conversation over.
  const handleContinueWithCodingMode = useCallback(async (enabled: boolean) => {
    if (!session) return
    const toastId = toast.loading(t('chat.codingMode.continuing'))
    try {
      const result = await window.electronAPI.sessionCommand(session.id, { type: 'continueInNewSession', codingMode: enabled })
      toast.dismiss(toastId)
      navigate(routes.view.allSessions(result.sessionId))
    } catch (error) {
      toast.error(t('chat.codingMode.continueFailed'), {
        id: toastId,
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }, [session, navigate, t])

  // A background task's full output, from its chip card
  const handleOpenTaskOutput = useCallback((task: BackgroundTask, output: BackgroundTaskOutput) => {
    setOverlayState({ type: 'task-output', title: task.intent?.trim() || task.id, output })
  }, [])

  // Pop-out handler - opens message in overlay (read-only markdown)
  const handlePopOut = useCallback((message: Message) => {
    if (!session) return
    setOverlayState({
      type: 'markdown',
      content: message.content,
      title: 'Message Preview',
    })
  }, [session])

  // Ref to track total turn count for scroll handler
  const totalTurnCountRef = React.useRef(0)

  // Latest message metadata (for commit-time auto-scroll)
  const messageCount = session?.messages.length ?? 0
  const lastMessage = messageCount > 0 ? session?.messages[messageCount - 1] : undefined
  const lastMessageId = lastMessage?.id
  const lastMessageRole = lastMessage?.role

  const pendingFollowUpAnnotations = useMemo<PendingFollowUpAnnotation[]>(() => {
    if (!session?.messages?.length) return []

    const pending: PendingFollowUpAnnotation[] = []

    for (const message of session.messages) {
      if (message.role !== 'assistant' && message.role !== 'plan') continue
      if (!message.annotations?.length) continue

      for (const annotation of message.annotations) {
        const note = getAnnotationNoteText(annotation)
        if (!note) continue
        if (isAnnotationFollowUpSent(annotation)) continue

        pending.push({
          messageId: message.id,
          annotationId: annotation.id,
          note,
          selectedText: extractAnnotationSelectedText(annotation, message.content),
          createdAt: annotation.updatedAt ?? annotation.createdAt,
          color: annotation.style?.color,
          meta: asRecord(annotation.meta) ?? undefined,
        })
      }
    }

    return pending.sort((a, b) => a.createdAt - b.createdAt)
  }, [session?.messages])

  const followUpInputItems = useMemo(() => {
    return pendingFollowUpAnnotations.map((followUp, idx) => ({
      id: `${followUp.messageId}:${followUp.annotationId}`,
      messageId: followUp.messageId,
      annotationId: followUp.annotationId,
      index: idx + 1,
      noteLabel: normalizeFollowUpText(followUp.note),
      selectedText: truncateForChipTooltip(followUp.selectedText, 260),
      color: followUp.color,
    }))
  }, [pendingFollowUpAnnotations])

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
      // Nothing to follow without turns; a task brief, read from the top, stays at its top
      if (totalTurnCountRef.current === 0) return

      // Unfocused panels: always scroll to bottom instantly (user isn't reading them)
      if (!isFocusedPanelRef.current) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'instant' })
        return
      }

      // Focused panel: respect sticky-bottom preference
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

  // Commit-time auto-scroll for new user messages.
  // This complements submit-time scrolling and covers cases where attachments delay
  // optimistic message insertion (e.g., thumbnail generation/resizing).
  React.useEffect(() => {
    const currentSessionId = session?.id ?? null

    // Reset baseline on session switch; defer to ScrollOnMount/session-switch logic.
    if (prevSessionIdForCommitScrollRef.current !== currentSessionId) {
      prevSessionIdForCommitScrollRef.current = currentSessionId
      prevLastMessageIdRef.current = lastMessageId ?? null
      prevMessageCountRef.current = messageCount
      return
    }

    const previousCount = prevMessageCountRef.current
    const previousLastId = prevLastMessageIdRef.current
    const messageActuallyChanged = !!lastMessageId && lastMessageId !== previousLastId
    const countIncreased = messageCount > previousCount

    // Update baselines before early returns to keep refs consistent.
    prevLastMessageIdRef.current = lastMessageId ?? null
    prevMessageCountRef.current = messageCount

    if (!messageActuallyChanged || !countIncreased) return
    if (lastMessageRole !== 'user') return

    // Sending a message should always re-stick to bottom.
    isStickToBottomRef.current = true

    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({
        behavior: isFocusedPanelRef.current ? 'smooth' : 'instant',
      })
    })
  }, [session?.id, messageCount, lastMessageId, lastMessageRole])

  // Handle message submission from InputContainer
  // Backend handles interruption and queueing if currently processing
  const handleSubmit = (message: string, attachments?: FileAttachment[], skillSlugs?: string[]) => {
    const hasBaseMessage = message.trim().length > 0
    const followUpSection = formatFollowUpSection(pendingFollowUpAnnotations, {
      includeTopSeparator: hasBaseMessage,
    })
    const messageWithFollowUps = followUpSection.length > 0
      ? (hasBaseMessage ? `${message}\n\n${followUpSection}` : followUpSection)
      : message
    const normalizedMessage = normalizeFollowUpsMarkdown(messageWithFollowUps)

    // Force stick-to-bottom when user sends a message
    isStickToBottomRef.current = true
    onSendMessage(normalizedMessage, attachments, skillSlugs)

    // Persist sent marker on follow-up annotations so TurnCard can distinguish
    // sent vs pending follow-ups. If user edits a follow-up later, TurnCard
    // clears these markers and the annotation becomes pending again.
    if (session && pendingFollowUpAnnotations.length > 0) {
      const sentAt = Date.now()
      void Promise.all(pendingFollowUpAnnotations.map((followUp) => {
        const currentMeta = followUp.meta ?? {}
        const currentFollowUpMeta = asRecord(currentMeta.followUp) ?? {}

        return window.electronAPI.sessionCommand(session.id, {
          type: 'updateAnnotation',
          messageId: followUp.messageId,
          annotationId: followUp.annotationId,
          patch: {
            meta: {
              ...currentMeta,
              followUp: {
                ...currentFollowUpMeta,
                text: followUp.note,
                lastSentAt: sentAt,
                lastSentText: followUp.note,
              },
            },
          },
        })
      })).catch((error) => {
        console.error('[ChatDisplay] Failed to mark follow-up annotations as sent:', error)
      })
    }

    // Immediately scroll to bottom after sending - use requestAnimationFrame
    // to ensure the DOM has updated with the new message
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    })
  }

  const handleSaveAndSendFollowUp = useCallback((_target: {
    messageId: string
    annotationId: string
    note: string
    selectedText: string
  }) => {
    if (!session) return

    if (isInputDisabled || disableSend || connectionUnavailable) {
      toast.error(t('toast.cannotSendRightNow'), {
        description: 'Sending is currently disabled for this session.',
      })
      return
    }

    // Mimic pressing Send in the input after Save completes.
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('craft:submit-input', {
        detail: { sessionId: session.id },
      }))
    }, 0)
  }, [session, isInputDisabled, disableSend, connectionUnavailable])

  // A new-chat suggestion chip sends its prompt as if typed: mentioned sources are enabled first
  // and mentioned skills invoked, like @-mentions sent from the composer.
  const canRunSuggestion = !!session && !isInputDisabled && !disableSend && !connectionUnavailable
  const handleRunSuggestion = (suggestion: NewChatSuggestion) => {
    if (!session || !canRunSuggestion) return
    const mentions = newChatSuggestionMentions(
      suggestion,
      (skills ?? []).map(s => s.slug),
      (sources ?? []).map(s => s.config.slug),
    )
    const enabled = session.enabledSourceSlugs ?? []
    const toEnable = mentions.sources.filter(slug => !enabled.includes(slug))
    if (toEnable.length > 0 && onSourcesChange) onSourcesChange([...enabled, ...toEnable])
    handleSubmit(
      newChatSuggestionMessage(suggestion, (key, options) => t(key, options)),
      undefined,
      mentions.skills.length > 0 ? mentions.skills : undefined,
    )
  }

  // Handle stop request from InputContainer
  // silent=true when redirecting (sending new message), silent=false when user clicks Stop button
  const handleStop = (silent = false) => {
    if (!session?.isProcessing) return

    // Explicit Stop (not a redirect/new-message send): put the in-flight prompt
    // back in the input so the user can tweak and resend. Append to any draft.
    // Exclude isQueued messages — those are restored separately by the backend
    // `restore_input` effect (App.tsx) and would otherwise double up here.
    if (!silent) {
      const lastUserMsg = [...session.messages].reverse().find(m => m.role === 'user' && !m.isQueued)
      const restoredText = coerceInputText(lastUserMsg?.content)
      if (restoredText) {
        onInputChange?.(appendRestoredInput(inputValue, restoredText))
      }
    }

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
    if ((response.type === 'permission' || response.type === 'admin_approval') && pendingPermission && onRespondToPermission) {
      if (response.type === 'permission') {
        const permResponse = response as PermissionResponse
        onRespondToPermission(
          pendingPermission.sessionId,
          pendingPermission.requestId,
          permResponse.allowed,
          permResponse.alwaysAllow
        )
        return
      }

      const adminResponse = response as AdminApprovalResponse
      onRespondToPermission(
        pendingPermission.sessionId,
        pendingPermission.requestId,
        adminResponse.approved,
        false,
        { rememberForMinutes: adminResponse.rememberForMinutes }
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
      if (pendingPermission.type === 'admin_approval') {
        return {
          type: 'admin_approval',
          data: {
            appName: pendingPermission.appName || pendingPermission.toolName || 'System action',
            reason: pendingPermission.reason || pendingPermission.description,
            impact: pendingPermission.impact,
            command: pendingPermission.command || '',
            requiresSystemPrompt: pendingPermission.requiresSystemPrompt ?? true,
            rememberForMinutes: pendingPermission.rememberForMinutes ?? 10,
          },
        }
      }
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
    return groupMessagesByTurn(session.messages, { isSessionProcessing: session.isProcessing })
  }, [session?.messages, session?.isProcessing])

  // Keep ref in sync for scroll handler
  totalTurnCountRef.current = allTurns.length

  // Reverse pagination: only render last N turns for fast initial render
  const startIndex = Math.max(0, allTurns.length - visibleTurnCount)
  const turns = allTurns.slice(startIndex)
  const hasMoreAbove = startIndex > 0

  const assistantTurnIndexByMessageId = useMemo(() => {
    const map = new Map<string, number>()
    allTurns.forEach((turn, index) => {
      if (turn.type !== 'assistant') return
      const messageId = turn.response?.messageId
      if (messageId) map.set(messageId, index)
    })
    return map
  }, [allTurns])

  const scrollToFollowUpTurn = useCallback((item: {
    messageId: string
    annotationId: string
  }) => {
    const targetTurnIndex = assistantTurnIndexByMessageId.get(item.messageId)
    if (targetTurnIndex == null) return

    const ensureVisibleCount = allTurns.length - targetTurnIndex

    const scrollToTurn = () => {
      const targetTurn = allTurns[targetTurnIndex]
      if (!targetTurn) return false

      const turnKey = getTurnKey(targetTurn)
      const turnContainer = turnRefs.current.get(turnKey)
      if (!turnContainer) return false

      turnContainer.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return true
    }

    if (ensureVisibleCount > visibleTurnCount) {
      setVisibleTurnCount(ensureVisibleCount)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!scrollToTurn()) {
            setTimeout(() => {
              void scrollToTurn()
            }, 80)
          }
        })
      })
      return
    }

    if (!scrollToTurn()) {
      requestAnimationFrame(() => {
        void scrollToTurn()
      })
    }
  }, [assistantTurnIndexByMessageId, allTurns, visibleTurnCount])

  const handleFollowUpChipClick = useCallback((item: {
    messageId: string
    annotationId: string
  }, anchor?: { x: number; y: number }) => {
    const targetTurnIndex = assistantTurnIndexByMessageId.get(item.messageId)
    if (targetTurnIndex != null) {
      const ensureVisibleCount = allTurns.length - targetTurnIndex
      if (ensureVisibleCount > visibleTurnCount) {
        setVisibleTurnCount(ensureVisibleCount)
      }
    }

    followUpOpenNonceRef.current += 1
    setOpenAnnotationRequest({
      messageId: item.messageId,
      annotationId: item.annotationId,
      mode: 'view',
      anchorX: anchor?.x,
      anchorY: anchor?.y,
      nonce: followUpOpenNonceRef.current,
    })
  }, [assistantTurnIndexByMessageId, allTurns, visibleTurnCount])

  const handleFollowUpIndexClick = useCallback((item: {
    messageId: string
    annotationId: string
  }) => {
    scrollToFollowUpTurn(item)
  }, [scrollToFollowUpTurn])

  // Compute if we should skip scroll-to-bottom (when search is active on session switch)
  // At render time, prevSessionIdForScrollRef still has the OLD session ID, so we can detect the switch
  const isSessionSwitchForScroll = prevSessionIdForScrollRef.current !== null && prevSessionIdForScrollRef.current !== session?.id
  const skipScrollToBottom = isSessionSwitchForScroll && isSearchActive
  const hasUnrenderedLoadedMessages = !messagesLoading
    && turns.length === 0
    && ((session?.messages?.length ?? 0) > 0 || (session?.messageCount ?? 0) > 0)
  // Transcript placeholder only after 200ms of loading. Loaded messages replace it at once (no
  // minimum display time): holding them back left the turns unmounted while the search
  // highlight / scroll-to-match effects ran, so a slow switch lost the match.
  const showTranscriptSkeleton = useDelayedLoading(messagesLoading)
  const newChatEmptyState = (
    <NewChatEmptyState compact={compactMode}>
      {canRunSuggestion && <NewChatSuggestions suggestions={newChatSuggestions} onSelect={handleRunSuggestion} />}
    </NewChatEmptyState>
  )
  // A task's orchestrator has no messages until a run, so it shows the task instead (subtask
  // sessions get their prompt when they start)
  const briefTaskSlug = session && !session.parentSessionId ? session.taskSlug : undefined

  return (
    <RunCommandProvider value={session ? handleRunCommand : null}>
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
              {/* Transcript column: 720px of text + gutters, turns 20px apart (spec §7.4) */}
              <div className={cn(
                CHAT_LAYOUT.maxWidth,
                "mx-auto min-w-0",
                compactMode ? CHAT_LAYOUT.compactContainerPadding : CHAT_LAYOUT.containerPadding,
                CHAT_LAYOUT.messageSpacing
              )}>
                {/* Session switch is instant (spec §6.3): the keyed wrapper swaps the whole transcript
                    in the same frame — no crossfade, no exit that holds back the new content. The keys
                    are the same as before, so ScrollOnMount still re-runs for every session. */}
                <div key={compactMode ? 'compact-session' : session?.id} className="contents">
                    {messagesLoading ? (
                      showTranscriptSkeleton ? <TranscriptSkeleton /> : null
                    ) : messagesLoadError ? (
                      <TranscriptLoadError
                        error={messagesLoadError}
                        onRetry={onRetryMessagesLoad}
                        isRetrying={messagesRetrying}
                      />
                    ) : (
                    /* Turn-based Message Display - memoized to avoid re-grouping on every render */
                    <div
                      key={compactMode ? 'loaded-compact' : `loaded-${session?.id}`}
                      className={CHAT_LAYOUT.messageSpacing}
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
                  {/* The "what to change" hint is EditPopover's (the only caller passing emptyStateLabel);
                      compact/mobile chats share compactMode but are not edits */}
                  {compactMode && emptyStateLabel !== undefined && turns.length === 0 && <CompactEmptyState />}
                  {emptyStateLabel === undefined && !messagesLoading && !messagesLoadError && turns.length === 0 && !hasUnrenderedLoadedMessages && (
                    briefTaskSlug ? (
                      <TaskBriefState
                        workspaceId={session.workspaceId}
                        sessionId={session.id}
                        taskSlug={briefTaskSlug}
                        title={session.name}
                        compact={compactMode}
                        onOpenUrl={onOpenUrl}
                        onOpenFile={onOpenFile}
                        fallback={newChatEmptyState}
                      />
                    ) : newChatEmptyState
                  )}
                  {!compactMode && hasUnrenderedLoadedMessages && <NoRenderableMessages />}
                  {/* Load more indicator - shown when there are older messages */}
                  {hasMoreAbove && <EarlierMessagesHint count={startIndex} />}
                  {turns.map((turn, index) => {
                    // Compute turn key and check if it's a search match
                    const turnKey = getTurnKey(turn)
                    const isCurrentMatch = isSearchActive && matchingTurnIds[currentMatchIndex] === turnKey
                    const isAnyMatch = isSearchActive && matchingTurnIds.includes(turnKey)

                    // User turns - render with MemoizedMessageBubble
                    if (turn.type === 'user') {
                      return (
                        <TurnFrame
                          key={turnKey}
                          turnKey={turnKey}
                          registerRef={registerTurnRef}
                          isCurrentMatch={isCurrentMatch}
                          isAnyMatch={isAnyMatch}
                          className={CHAT_LAYOUT.userMessagePadding}
                        >
                          <MemoizedMessageBubble
                            message={turn.message}
                            onOpenFile={onOpenFile}
                            onOpenUrl={onOpenUrl}
                            sessionId={session?.id}
                            compactMode={compactMode}
                          />
                        </TurnFrame>
                      )
                    }

                    // System turns (error, status, info, warning) - render with MemoizedMessageBubble
                    if (turn.type === 'system') {
                      return (
                        <TurnFrame
                          key={turnKey}
                          turnKey={turnKey}
                          registerRef={registerTurnRef}
                          isCurrentMatch={isCurrentMatch}
                          isAnyMatch={isAnyMatch}
                        >
                          <MemoizedMessageBubble
                            message={turn.message}
                            onOpenFile={onOpenFile}
                            onOpenUrl={onOpenUrl}
                            sessionId={session?.id}
                            onRetry={turn.message.role === 'error' ? () => {
                              const msgs = session?.messages
                              if (!msgs) return
                              const errorIdx = msgs.findIndex(m => m.id === turn.message.id)
                              const lastUserMsg = msgs.slice(0, errorIdx).findLast(m => m.role === 'user')
                              if (lastUserMsg) {
                                onSendMessage(lastUserMsg.content)
                              }
                            } : undefined}
                          />
                        </TurnFrame>
                      )
                    }

                    // Auth-request turns - render inline auth UI
                    if (turn.type === 'auth-request') {
                      // Interactive only if no user message follows
                      const isAuthInteractive = !turns.slice(index + 1).some(t => t.type === 'user')
                      return (
                        <TurnFrame
                          key={turnKey}
                          turnKey={turnKey}
                          registerRef={registerTurnRef}
                          isCurrentMatch={isCurrentMatch}
                          isAnyMatch={isAnyMatch}
                        >
                          <MemoizedAuthRequestCard
                            message={turn.message}
                            sessionId={session.id}
                            onRespondToCredential={onRespondToCredential}
                            isInteractive={isAuthInteractive}
                          />
                        </TurnFrame>
                      )
                    }

                    // Check if this is the last response (for Accept Plan button visibility)
                    const isLastResponse = index === turns.length - 1 || !turns.slice(index + 1).some(t => t.type === 'user')

                    // Assistant turns - render with TurnCard (buffered streaming)
                    const assistantUiKey = getAssistantTurnUiKey(turn, index)
                    return (
                      <TurnFrame
                        key={turnKey}
                        turnKey={turnKey}
                        registerRef={registerTurnRef}
                        isCurrentMatch={isCurrentMatch}
                        isAnyMatch={isAnyMatch}
                      >
                      <TurnCard
                        sessionId={session.id}
                        sessionFolderPath={session.sessionFolderPath}
                        hasActiveFollowUpAnnotations={pendingFollowUpAnnotations.length > 0}
                        turnId={turn.turnId}
                        activities={turn.activities}
                        response={turn.response}
                        intent={turn.intent}
                        isStreaming={turn.isStreaming}
                        isComplete={turn.isComplete}
                        isExpanded={expandedTurns.has(assistantUiKey)}
                        onExpandedChange={(expanded) => toggleTurn(assistantUiKey, expanded)}
                        expandedActivityGroups={expandedActivityGroups}
                        onExpandedActivityGroupsChange={setExpandedActivityGroups}
                        todos={turn.todos}
                        onOpenFile={onOpenFile}
                        onOpenUrl={onOpenUrl}
                        isLastResponse={isLastResponse}
                        compactMode={compactMode}
                        sendMessageKey={sendMessageKey}
                        openAnnotationRequest={openAnnotationRequest}
                        onBranch={session?.supportsBranching ? async (messageId: string, options?: { newPanel?: boolean }) => {
                          if (!session) return
                          try {
                            const child = await appShellContext.onCreateSession(
                              session.workspaceId,
                              {
                                branchFromMessageId: messageId,
                                branchFromSessionId: session.id,
                                name: `Branch of ${session.name || 'Untitled'}`,
                                // Keep branch on the same backend/provider by inheriting parent session settings.
                                llmConnection: session.llmConnection,
                                model: session.model,
                                permissionMode: session.permissionMode,
                                workingDirectory: session.workingDirectory,
                                enabledSourceSlugs: session.enabledSourceSlugs,
                              }
                            )
                            navigate(routes.view.allSessions(child.id), { newPanel: resolveBranchNewPanelOption(options) })
                          } catch (error) {
                            const rawMessage = error instanceof Error ? error.message : 'Failed to create branch'
                            const message = rawMessage.includes('source and target providers must match')
                              || rawMessage.includes('same provider/backend')
                              ? 'Branching is only supported within the same provider/backend. Switch this panel connection and try again.'
                              : rawMessage
                            toast.error(t('toast.couldNotCreateBranch'), { description: message })
                          }
                        } : undefined}
                        onAddAnnotation={async (messageId, annotation) => {
                          if (!session) return
                          try {
                            await window.electronAPI.sessionCommand(session.id, {
                              type: 'addAnnotation',
                              messageId,
                              annotation,
                            })
                          } catch (error) {
                            toast.error(t('toast.couldNotSaveHighlight'), {
                              description: error instanceof Error ? error.message : 'Unknown error',
                            })
                            throw error
                          }
                        }}
                        onRemoveAnnotation={async (messageId, annotationId) => {
                          if (!session) return
                          try {
                            await window.electronAPI.sessionCommand(session.id, {
                              type: 'removeAnnotation',
                              messageId,
                              annotationId,
                            })
                          } catch (error) {
                            toast.error(t('toast.couldNotRemoveHighlight'), {
                              description: error instanceof Error ? error.message : 'Unknown error',
                            })
                          }
                        }}
                        onUpdateAnnotation={async (messageId, annotationId, patch) => {
                          if (!session) return
                          try {
                            await window.electronAPI.sessionCommand(session.id, {
                              type: 'updateAnnotation',
                              messageId,
                              annotationId,
                              patch,
                            })
                          } catch (error) {
                            toast.error(t('toast.couldNotUpdateHighlight'), {
                              description: error instanceof Error ? error.message : 'Unknown error',
                            })
                            throw error
                          }
                        }}
                        onSaveAndSendFollowUp={handleSaveAndSendFollowUp}
                        onAcceptPlan={() => {
                          const planMessage = session?.messages.findLast(m => m.role === 'plan')
                          const planPath = planMessage?.planPath

                          window.dispatchEvent(new CustomEvent('craft:approve-plan', {
                            detail: {
                              sessionId: session?.id,
                              planPath,
                              includeDraftInput: true,
                              source: 'plan-card',
                            },
                          }))
                        }}
                        onAcceptPlanWithCompact={() => {
                          const planMessage = session?.messages.findLast(m => m.role === 'plan')
                          const planPath = planMessage?.planPath

                          window.dispatchEvent(new CustomEvent('craft:approve-plan-with-compact', {
                            detail: {
                              sessionId: session?.id,
                              planPath,
                              includeDraftInput: true,
                              source: 'plan-card',
                            },
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
                            const changes = collectFileChangesFromActivities(turn.activities)
                            if (changes.length > 0) {
                              setOverlayState({
                                type: 'multi-diff',
                                changes,
                                consolidated: false, // Ungrouped mode - show individual changes
                                focusedChangeId: getFirstFileChangeIdForActivity(activity.id, changes),
                              })
                            }
                          } else {
                            // All other tools → open generic activity cards overlay (Input/Output)
                            setOverlayState({ type: 'activity', activity })
                          }
                        }}
                        hasEditOrWriteActivities={turn.activities.some(a =>
                          a.toolName === 'Edit' || a.toolName === 'Write'
                        )}
                        onOpenMultiFileDiff={() => {
                          const changes = collectFileChangesFromActivities(turn.activities)
                          if (changes.length > 0) {
                            setOverlayState({
                              type: 'multi-diff',
                              changes,
                              consolidated: true, // Consolidated mode - group by file
                            })
                          }
                        }}
                      />
                      </TurnFrame>
                    )
                  })}
                    </div>
                    )}
                </div>
                {/* Processing Indicator (live line) - always visible while processing */}
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
          <ChatInputZone
            compactMode={compactMode}
            permissionMode={permissionMode}
            onPermissionModeChange={onPermissionModeChange}
            tasks={backgroundTasks}
            sessionId={session.id}
            sessionFolderPath={sessionFolderPath}
            onStopTask={stopTask}
            onDismissTask={dismissTask}
            onOpenTaskOutput={handleOpenTaskOutput}
            onRunCommand={handleRunCommand}
            sessionLabels={session.labels}
            labels={labels}
            onLabelsChange={onLabelsChange}
            currentSessionStatus={session.sessionStatus || 'todo'}
            inputProps={{
              placeholder,
              previousPermissionMode,
              disabled: isInputDisabled,
              isProcessing: session.isProcessing,
              onAnimatedHeightChange: handleAnimatedHeightChange,
              onSubmit: handleSubmit,
              onStop: handleStop,
              textareaRef,
              currentModel,
              onModelChange,
              thinkingLevel,
              onThinkingLevelChange,
              codingMode,
              onCodingModeChange,
              onContinueWithCodingMode: handleContinueWithCodingMode,
              enabledModes,
              enableCompactModelPicker,
              structuredInput,
              onStructuredResponse: handleStructuredResponse,
              inputValue,
              onInputChange,
              attachmentsValue,
              onAttachmentsChange,
              sources,
              enabledSourceSlugs: session.enabledSourceSlugs,
              onSourcesChange,
              skills,
              workspaceId,
              workingDirectory,
              onWorkingDirectoryChange,
              disableSend: disableSend || connectionUnavailable,
              connectionUnavailable,
              isEmptySession: session.messages.length === 0,
              currentConnection: session.llmConnection,
              onConnectionChange,
              contextStatus: {
                isCompacting: session.currentStatus?.statusType === 'compacting',
                inputTokens: session.tokenUsage?.inputTokens,
                contextWindow: session.tokenUsage?.contextWindow,
                contextUsage: session.tokenUsage?.contextUsage,
              },
              followUpItems: followUpInputItems,
              onFollowUpClick: handleFollowUpChipClick,
              onFollowUpIndexClick: handleFollowUpIndexClick,
            }}
          />
          </div>
        </div>
      ) : null}

      {/* ================================================================== */}
      {/* Preview Overlays - Rendered outside the main chat flow            */}
      {/* ================================================================== */}

      {/* Activity details overlay */}
      {overlayState?.type === 'activity' && useStackedActivityOverlay && (
        <ActivityCardsOverlay
          isOpen={true}
          onClose={handleCloseOverlay}
          cards={overlayCards}
          title={overlayState.activity.displayName || overlayState.activity.toolName || 'Activity'}
          theme={isDark ? 'dark' : 'light'}
          onOpenUrl={onOpenUrl}
          onOpenFile={onOpenFile}
        />
      )}

      {/* Legacy output-only activity overlay for non-bash/non-mcp tools */}
      {overlayState?.type === 'activity' && !useStackedActivityOverlay && activityOutputOverlayData && (
        activityOutputOverlayData.type === 'code' ? (
          <CodePreviewOverlay
            isOpen={true}
            onClose={handleCloseOverlay}
            content={activityOutputOverlayData.content}
            filePath={activityOutputOverlayData.filePath}
            mode={activityOutputOverlayData.mode}
            startLine={activityOutputOverlayData.startLine}
            totalLines={activityOutputOverlayData.totalLines}
            numLines={activityOutputOverlayData.numLines}
            command={activityOutputOverlayData.command}
            error={activityOutputOverlayData.error}
            theme={isDark ? 'dark' : 'light'}
          />
        ) : activityOutputOverlayData.type === 'terminal' ? (
          <TerminalPreviewOverlay
            isOpen={true}
            onClose={handleCloseOverlay}
            command={activityOutputOverlayData.command}
            output={activityOutputOverlayData.output}
            exitCode={activityOutputOverlayData.exitCode}
            toolType={activityOutputOverlayData.toolType}
            description={activityOutputOverlayData.description}
            error={activityOutputOverlayData.error}
            theme={isDark ? 'dark' : 'light'}
          />
        ) : activityOutputOverlayData.type === 'json' ? (
          <JSONPreviewOverlay
            isOpen={true}
            onClose={handleCloseOverlay}
            data={activityOutputOverlayData.data}
            title={activityOutputOverlayData.title}
            error={activityOutputOverlayData.error}
            theme={isDark ? 'dark' : 'light'}
          />
        ) : activityOutputOverlayData.type === 'document' ? (
          <DocumentFormattedMarkdownOverlay
            isOpen={true}
            onClose={handleCloseOverlay}
            content={activityOutputOverlayData.content}
            onOpenUrl={onOpenUrl}
            onOpenFile={onOpenFile}
            filePath={activityOutputOverlayData.filePath}
            typeBadge={{
              icon: Info,
              label: activityOutputOverlayData.toolName,
              variant: 'blue',
            }}
            error={activityOutputOverlayData.error}
          />
        ) : detectLanguage(activityOutputOverlayData.content) === 'markdown' ? (
          <DocumentFormattedMarkdownOverlay
            isOpen={true}
            onClose={handleCloseOverlay}
            content={activityOutputOverlayData.content}
            onOpenUrl={onOpenUrl}
            onOpenFile={onOpenFile}
            typeBadge={{
              icon: Info,
              label: overlayState.activity.displayName || overlayState.activity.toolName || 'Activity',
              variant: 'blue',
            }}
            error={activityOutputOverlayData.error}
          />
        ) : (
          <GenericOverlay
            isOpen={true}
            onClose={handleCloseOverlay}
            content={activityOutputOverlayData.content}
            title={activityOutputOverlayData.title}
            error={activityOutputOverlayData.error}
            theme={isDark ? 'dark' : 'light'}
          />
        )
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

      {/* Background task output (task chip card → Open): a command's output, or an agent's message + steps */}
      {overlayState?.type === 'task-output' && (
        overlayState.output.kind === 'text' ? (
          <TerminalPreviewOverlay
            isOpen={true}
            onClose={handleCloseOverlay}
            command={overlayState.title}
            output={overlayState.output.text}
            toolType="bash"
            theme={isDark ? 'dark' : 'light'}
          />
        ) : (
          <DocumentFormattedMarkdownOverlay
            isOpen={true}
            onClose={handleCloseOverlay}
            content={agentDocument(overlayState.output, t('chat.backgroundTask.recentSteps'))}
            onOpenUrl={onOpenUrl}
            onOpenFile={onOpenFile}
            typeBadge={{ icon: Bot, label: overlayState.title, variant: 'blue' }}
          />
        )
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
    </div>
    </RunCommandProvider>
  )
})
