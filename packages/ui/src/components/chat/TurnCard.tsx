import * as React from 'react'
import { useMemo, useEffect, useRef, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ToolDisplayMeta, AnnotationV1 } from '@craft-agent/core'
import { isParentTaskTool } from '@craft-agent/shared/utils/toolNames'
import { motion, AnimatePresence } from 'motion/react'
import { ListTodo } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useCopyToClipboard } from '../../lib/use-copy-to-clipboard'
import { TWEEN } from '../../motion/presets'
import { Markdown, RunCommandProvider, useRunCommand, type FileOpenHandler } from '../markdown'
import { type IslandTransitionConfig } from '../ui'
import { AnnotationIslandMenu } from '../annotations/AnnotationIslandMenu'
import {
  type PointerSnapshot,
  buildAnnotationChipEntryTransition,
  buildSelectionEntryTransition,
} from '../annotations/island-motion'
import { TurnCardActionsMenu } from './TurnCardActionsMenu'
import { computeLastChildSet, groupActivitiesByParent, deriveTurnPhase, shouldShowThinkingIndicator, type AssistantTurn } from './turn-utils'
import { extractAnnotationSelectedText } from './follow-up-helpers'
import {
  formatAnnotationFollowUpTooltipText,
  getAnnotationNoteText,
} from '../annotations/follow-up-state'
import {
  ANNOTATION_PREFIX_SUFFIX_WINDOW,
  SELECTION_POINTER_MAX_AGE_MS,
  clamp,
  hasExistingTextRangeAnnotation,
  createSelectionPreviewAnnotation,
  createTextSelectionAnnotation,
  collectTextSegments,
  getCanonicalText,
  resolveNodeOffset,
  type AnnotationOverlayRect,
} from '../annotations/annotation-core'
import {
  annotationColorToCss,
} from '../annotations/annotation-style-tokens'
import { clearBlockAnnotationMarkers, applyBlockAnnotationMarker } from '../annotations/block-markers'
import { canAnnotateMessage, shouldRenderAnnotationIslandInPortal } from '../annotations/annotation-host-config'
import { clearDomSelection } from '../annotations/selection-restore'
import {
  shouldIgnoreSelectionMouseUpTarget,
} from '../annotations/interaction-policy'
import { computeAnnotationOverlayGeometry, type AnnotationOverlayChip } from '../annotations/annotation-overlay-geometry'
import { AnnotationOverlayLayer } from '../annotations/AnnotationOverlayLayer'
import {
  getAnnotationInteractionAnchor,
  getAnnotationInteractionSourceKey,
  hasAnnotationInteraction,
} from '../annotations/interaction-selectors'
import {
  type AnnotationIslandMode,
  type AnchoredSelection,
} from '../annotations/interaction-state-machine'
import { useAnnotationInteractionController } from '../annotations/use-annotation-interaction-controller'
import { useAnnotationIslandPresentation } from '../annotations/use-annotation-island-presentation'
import { useAnnotationIslandEvents } from '../annotations/use-annotation-island-events'
import { useAnnotationCancelRestore } from '../annotations/use-annotation-cancel-restore'
import { DocumentFormattedMarkdownOverlay } from '../overlay'
import { AcceptPlanDropdown } from './AcceptPlanDropdown'
import { CompactAcceptPlanDrawer } from './CompactAcceptPlanDrawer'
import { ResponseFooter } from './turn/ResponseFooter'
import { ThinkingRow } from './turn/ThinkingRow'
import { WorkLog } from './turn/WorkLog'
import { ANSWER_BLOCK_IN, ANSWER_PROSE, SIZE_CONFIG } from './turn/turn-classes'
import { countFailedActivities, getWorkLogPreview } from './turn/work-log-summary'

// Presentational pieces live in ./turn/ (work log, tool rows, footer); re-exported here so the
// public surface of TurnCard stays the same.
export { SIZE_CONFIG } from './turn/turn-classes'
export { ActivityStatusIcon } from './turn/ActivityIcons'

// ============================================================================
// Types
// ============================================================================

export type ActivityStatus = 'pending' | 'running' | 'completed' | 'error' | 'backgrounded'
export type ActivityType = 'tool' | 'thinking' | 'intermediate' | 'status' | 'plan'
export type AnnotationInteractionMode = 'interactive' | 'tooltip-only'

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
  /** Optional backing message id (used by plan activities for branching/annotations) */
  messageId?: string
  /** Optional persisted annotations (used by plan activities) */
  annotations?: AnnotationV1[]
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

export type OpenAnnotationRequest = {
  messageId: string
  annotationId: string
  mode: 'view' | 'edit'
  anchorX?: number
  anchorY?: number
  nonce: number
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
  onOpenFile?: FileOpenHandler
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
  /** Compact-footer layout. Used by EditPopover (popover embedding) and ChatPage in
   *  auto-compact / WebUI mobile. Hides Copy / Markdown / Branch actions; keeps the
   *  Accept Plan dropdown when a plan is the last response. */
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
  /** Callback when follow-up is saved via "Save & Send" action */
  onSaveAndSendFollowUp?: (target: { messageId: string; annotationId: string; note: string; selectedText: string }) => void
  /** Whether there are active pending follow-up annotations in the session */
  hasActiveFollowUpAnnotations?: boolean
  /** External request to open a specific annotation in the follow-up island */
  openAnnotationRequest?: OpenAnnotationRequest | null
  /** Annotation interaction mode (viewer uses tooltip-only to suppress the island) */
  annotationInteractionMode?: AnnotationInteractionMode
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
  onOpenFile?: FileOpenHandler
  /** Callback to open URL */
  onOpenUrl?: (url: string) => void
  /** Callback to open response in Monaco editor */
  onPopOut?: () => void
  /** Card variant - 'response' for AI messages, 'plan' for plan messages */
  variant?: 'response' | 'plan'
  /** Parent session ID (used to reset local annotation/island UI state on session switches) */
  sessionId?: string
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
  /** Compact-footer layout. Hides Copy / Markdown / Branch in the response footer;
   *  keeps the Accept Plan dropdown when a plan is the last response. */
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
  /** Callback when follow-up is saved via "Save & Send" action */
  onSaveAndSendFollowUp?: (target: { messageId: string; annotationId: string; note: string; selectedText: string }) => void
  /** Whether there are active pending follow-up annotations in the session */
  hasActiveFollowUpAnnotations?: boolean
  /** External request to open a specific annotation in this response */
  openAnnotationRequest?: OpenAnnotationRequest | null
  /** Annotation interaction mode (viewer uses tooltip-only to suppress the island) */
  annotationInteractionMode?: AnnotationInteractionMode
}

function clearAnnotationMarks(root: HTMLElement): void {
  const annotatedInlineCodeNodes = root.querySelectorAll<HTMLElement>('code[data-ca-annotation-inline-code="true"]')
  annotatedInlineCodeNodes.forEach((codeNode) => {
    codeNode.removeAttribute('data-ca-annotation-inline-code')
    codeNode.style.backgroundColor = ''
    codeNode.style.removeProperty('box-shadow')
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
  chip.style.setProperty('--shadow-color', 'var(--info)')
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

/**
 * ResponseCard - Unified component for AI responses and plans
 *
 * Variants:
 * - 'response': the answer as plain copy on the transcript (spec §7.4 "Answer") with a quiet
 *   footer of icon actions revealed on hover/focus
 * - 'plan': raised card with a header and the Accept Plan action
 *
 * Response variant implements smart buffering:
 * - Waits for 40+ words with structure OR
 * - High-confidence patterns (code blocks, headers, lists) with lower threshold OR
 * - Timeout after 2.5 seconds
 *
 * Performance optimization: Uses throttled static snapshots instead of re-rendering
 * on every character. Content updates every 300ms during streaming, avoiding
 * expensive markdown parsing on every delta.
 *
 * Streaming and completed states render the same tree, so the markdown stays mounted when the
 * stream ends; blocks inserted while streaming fade in once (CSS @starting-style).
 */
export function ResponseCard({
  text,
  isStreaming,
  streamStartTime,
  onOpenFile,
  onOpenUrl,
  onPopOut,
  variant = 'response',
  sessionId,
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
  onSaveAndSendFollowUp,
  hasActiveFollowUpAnnotations = false,
  openAnnotationRequest,
  annotationInteractionMode = 'interactive',
}: ResponseCardProps) {
  const { t } = useTranslation()
  // Blocks fade in only once the card is on screen: a card that mounts mid-stream (session
  // switch, reload) shows its existing blocks at once (session switch is instant, spec §6.3).
  const hasMountedRef = useRef(false)
  useEffect(() => { hasMountedRef.current = true }, [])
  // Throttled content for display - updates every CONTENT_THROTTLE_MS during streaming
  const [displayedText, setDisplayedText] = useState(text)
  const lastUpdateRef = useRef(Date.now())
  const { copied, copy } = useCopyToClipboard()
  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState(false)
  // Pending text selection waiting for explicit follow-up action
  const interaction = useAnnotationInteractionController()
  const {
    state: interactionState,
    setDraft: setFollowUpDraft,
    openFromSelection,
    openFollowUpFromSelection,
    openFromAnnotation,
    requestEdit,
    cancelFollowUp,
    closeAll,
    markSubmitSuccess,
    markDeleteSuccess,
    consumeExternalOpenRequest,
  } = interaction

  const pendingSelection = interactionState.pendingSelection
  const selectionMenuView = interactionState.selectionMenuView
  const followUpDraft = interactionState.followUpDraft
  const followUpMode = interactionState.followUpMode
  const activeAnnotationDetail = interactionState.activeAnnotationDetail

  const [selectionMenuShowNonce, setSelectionMenuShowNonce] = useState(0)
  const [selectionMenuTransitionConfig, setSelectionMenuTransitionConfig] = useState<IslandTransitionConfig>(
    buildAnnotationChipEntryTransition()
  )
  const [annotationOverlay, setAnnotationOverlay] = useState<{ rects: AnnotationOverlayRect[]; chips: AnnotationOverlayChip[] }>({ rects: [], chips: [] })
  const contentRef = useRef<HTMLDivElement>(null)
  const contentLayerRef = useRef<HTMLDivElement>(null)
  const lastPointerRef = useRef<PointerSnapshot | null>(null)
  const dragStartPointerRef = useRef<PointerSnapshot | null>(null)
  const selectionStartedInContentRef = useRef(false)

  const canAnnotate = canAnnotateMessage({
    hasAddAnnotationHandler: !!onAddAnnotation,
    hasMessageId: !!messageId,
    isStreaming,
  })
  const allowAnnotationIsland = annotationInteractionMode === 'interactive'

  const closeSelectionMenu = useCallback(() => {
    closeAll()
  }, [closeAll])

  const isTargetInsideAnnotationIsland = useCallback((target: Node | null): boolean => {
    if (!target) return false
    const element = target instanceof Element ? target : target.parentElement
    if (!element) return false
    return !!element.closest('[data-ca-annotation-island="true"]')
  }, [])

  const triggerSelectionMenuEntryReplay = useCallback(() => {
    setSelectionMenuShowNonce((prev) => prev + 1)
  }, [])

  const activeMenuAnchor = useMemo(() => {
    return getAnnotationInteractionAnchor(interactionState)
  }, [interactionState])

  const selectionMenuSourceKey = useMemo(() => {
    const messageScope = messageId ?? 'no-message'
    return getAnnotationInteractionSourceKey(interactionState, messageScope)
  }, [interactionState, messageId])

  const {
    renderAnchor: selectionMenuRenderAnchor,
    renderSourceKey: selectionMenuRenderSourceKey,
    isVisible: isSelectionMenuVisible,
    openedAtRef: selectionMenuOpenedAtRef,
    handleExitComplete: handleSelectionMenuExitComplete,
    resetPresentation,
  } = useAnnotationIslandPresentation({
    anchor: activeMenuAnchor,
    sourceKey: selectionMenuSourceKey,
  })

  const handleCopy = useCallback(() => copy(text), [copy, text])

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
      createSelectionPreviewAnnotation(messageId, pendingSelection, sessionId ?? ''),
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

    const computeGeometry = () => {
      if (!renderedAnnotations.length) return { rects: [], chips: [] }
      const geometry = computeAnnotationOverlayGeometry({
        root,
        renderedAnnotations,
        persistedAnnotations: annotations,
      })
      if (process.env.NODE_ENV !== 'production' && geometry.unresolved.length > 0) {
        console.debug('[annotations] unresolved annotations', {
          count: geometry.unresolved.length,
          ids: geometry.unresolved.map(item => item.annotation.id),
          reasons: geometry.unresolved.map(item => item.reason),
        })
      }
      return { rects: geometry.rects, chips: geometry.chips }
    }

    // Full recompute: rewrites block-marker DOM. Used for content/annotation changes.
    const recomputeOverlay = () => {
      clearAnnotationMarks(root)
      clearBlockAnnotationMarkers(root)

      if (!renderedAnnotations.length) {
        setAnnotationOverlay({ rects: [], chips: [] })
        return
      }

      const next = computeGeometry()
      for (const annotation of renderedAnnotations) {
        applyBlockAnnotationMarker(root, annotation)
      }
      setAnnotationOverlay(next)
    }

    // Fast path: coordinates only, no DOM mutation. Used by scroll/resize.
    const recomputeOverlayCoords = () => {
      if (!renderedAnnotations.length) return
      setAnnotationOverlay(computeGeometry())
    }

    let rafId: number | null = null
    const scheduleCoordsRecompute = () => {
      if (rafId != null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        recomputeOverlayCoords()
      })
    }

    recomputeOverlay()
    window.addEventListener('resize', scheduleCoordsRecompute)
    // Capture-phase: scroll events don't bubble, but capture-phase listeners on
    // ancestors fire for descendant scrolls — so this catches the overflow-auto
    // viewport inside MarkdownDocBlock (and any future nested scroll surface).
    root.addEventListener('scroll', scheduleCoordsRecompute, { capture: true, passive: true })
    return () => {
      if (rafId != null) cancelAnimationFrame(rafId)
      window.removeEventListener('resize', scheduleCoordsRecompute)
      root.removeEventListener('scroll', scheduleCoordsRecompute, { capture: true } as EventListenerOptions)
    }
  }, [annotations, renderedAnnotations, text, displayedText, isStreaming])

  useEffect(() => {
    if (!canAnnotate) {
      closeSelectionMenu()
    }
  }, [canAnnotate, closeSelectionMenu])

  useEffect(() => {
    // Session switches should fully reset local island UI state to avoid stale
    // "hot" instances suppressing entry animations in the newly focused session.
    closeSelectionMenu()
    resetPresentation()
    dragStartPointerRef.current = null
    lastPointerRef.current = null
  }, [sessionId, closeSelectionMenu, resetPresentation])

  useEffect(() => {
    if (!hasAnnotationInteraction(interactionState) || !isSelectionMenuVisible) return

    const handleSelectionChange = () => {
      if (Date.now() - selectionMenuOpenedAtRef.current < 180) {
        return
      }

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
      if (commonElement && isTargetInsideAnnotationIsland(commonElement)) {
        return
      }

      if (!root.contains(common)) {
        closeSelectionMenu()
      }
    }

    document.addEventListener('selectionchange', handleSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange)
    }
  }, [interactionState, isSelectionMenuVisible, closeSelectionMenu, isTargetInsideAnnotationIsland, selectionMenuOpenedAtRef])

  const handleOpenFollowUpView = useCallback(() => {
    if (!pendingSelection) return

    // Native browser selection steals typing focus from the follow-up textarea.
    // Keep semantic selection in pendingSelection and clear only the DOM selection.
    clearDomSelection()
    openFollowUpFromSelection()
  }, [pendingSelection, openFollowUpFromSelection])

  const handleRequestFollowUpEdit = useCallback(() => {
    requestEdit()
  }, [requestEdit])

  const saveFollowUp = useCallback(async (note: string): Promise<{
    messageId: string
    annotationId: string
    note: string
    selectedText: string
  } | null> => {
    const normalizedNote = note.trim()

    if (!messageId) return null

    if (activeAnnotationDetail) {
      if (!onUpdateAnnotation || !activeAnnotation) {
        closeSelectionMenu()
        return null
      }

      const existingOtherBodies = activeAnnotation.body.filter(body => body.type !== 'highlight' && body.type !== 'note')
      const nextBody: AnnotationV1['body'] = [
        { type: 'highlight' },
        ...(normalizedNote.length > 0 ? [{ type: 'note', text: normalizedNote, format: 'plain' } as const] : []),
        ...existingOtherBodies,
      ]

      const nextMeta = { ...(activeAnnotation.meta ?? {}) }
      delete nextMeta.followUp

      try {
        await Promise.resolve(onUpdateAnnotation(messageId, activeAnnotationDetail.annotationId, {
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
        }))
      } catch {
        return null
      }

      markSubmitSuccess()

      if (normalizedNote.length === 0) return null

      return {
        messageId,
        annotationId: activeAnnotationDetail.annotationId,
        note: normalizedNote,
        selectedText: extractAnnotationSelectedText(activeAnnotation, text),
      }
    }

    if (!onAddAnnotation || !pendingSelection) return null

    if (hasExistingTextRangeAnnotation(annotations, pendingSelection.start, pendingSelection.end)) {
      closeSelectionMenu()
      return null
    }

    const annotation = createTextSelectionAnnotation(messageId, pendingSelection, normalizedNote, sessionId ?? '')

    try {
      await Promise.resolve(onAddAnnotation(messageId, annotation))
    } catch {
      return null
    }

    markSubmitSuccess()
    clearDomSelection()

    if (normalizedNote.length === 0) return null

    return {
      messageId,
      annotationId: annotation.id,
      note: normalizedNote,
      selectedText: pendingSelection.selectedText,
    }
  }, [
    messageId,
    activeAnnotationDetail,
    activeAnnotation,
    onUpdateAnnotation,
    onAddAnnotation,
    pendingSelection,
    annotations,
    closeSelectionMenu,
    sessionId,
    markSubmitSuccess,
    text,
  ])

  const handleSubmitFollowUp = useCallback((note: string) => {
    void saveFollowUp(note)
  }, [saveFollowUp])

  const handleSubmitAndSendFollowUp = useCallback((note: string) => {
    void saveFollowUp(note).then((savedFollowUp) => {
      if (!savedFollowUp) return
      onSaveAndSendFollowUp?.(savedFollowUp)
    })
  }, [saveFollowUp, onSaveAndSendFollowUp])

  const handleCancelFollowUp = useAnnotationCancelRestore({
    contentRootRef: contentLayerRef,
    cancelFollowUp,
  })

  const handleOpenAnnotationDetail = useCallback((
    annotationId: string,
    index: number,
    anchorX: number,
    anchorY: number,
    mode: AnnotationIslandMode = 'view'
  ) => {
    if (!allowAnnotationIsland) return

    const annotation = (annotations ?? []).find(item => item.id === annotationId)
    const noteText = annotation ? getAnnotationNoteText(annotation) : ''

    const transition = buildAnnotationChipEntryTransition()

    setSelectionMenuTransitionConfig(transition)
    triggerSelectionMenuEntryReplay()
    openFromAnnotation({ annotationId, index, anchorX, anchorY }, noteText, mode)
  }, [allowAnnotationIsland, annotations, triggerSelectionMenuEntryReplay, openFromAnnotation])

  useEffect(() => {
    if (!allowAnnotationIsland) return

    const contentRect = contentLayerRef.current?.getBoundingClientRect()
    const fallbackAnchor = {
      x: contentRect ? contentRect.left + contentRect.width / 2 : window.innerWidth / 2,
      y: contentRect ? contentRect.top + 20 : Math.max(24, window.innerHeight * 0.2),
    }

    const consumed = consumeExternalOpenRequest(openAnnotationRequest, {
      messageId,
      annotations,
      getNoteText: getAnnotationNoteText,
      fallbackAnchor,
    })

    if (!consumed) return

    setSelectionMenuTransitionConfig(buildAnnotationChipEntryTransition())
    triggerSelectionMenuEntryReplay()
  }, [
    allowAnnotationIsland,
    openAnnotationRequest,
    messageId,
    annotations,
    consumeExternalOpenRequest,
    triggerSelectionMenuEntryReplay,
  ])

  const handleDeleteActiveAnnotation = useCallback(() => {
    if (!onRemoveAnnotation || !messageId || !activeAnnotationDetail) return

    onRemoveAnnotation(messageId, activeAnnotationDetail.annotationId)
    markDeleteSuccess()
  }, [onRemoveAnnotation, messageId, activeAnnotationDetail, markDeleteSuccess])

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

      const anchorRowRects = rects.length > 0
        ? rects.filter(rect => Math.abs(rect.top - anchorRect.top) <= 2)
        : []
      const clampRects = anchorRowRects.length > 0 ? anchorRowRects : (rects.length > 0 ? rects : [anchorRect])

      const selectionMinX = Math.min(...clampRects.map(rect => rect.left))
      const selectionMaxX = Math.max(...clampRects.map(rect => rect.right))

      // Prefer mouse-release position, but clamp to the chosen anchor row so
      // multiline selections stay attached to actual text on that line.
      const anchorX = pointerX != null
        ? clamp(pointerX, selectionMinX, selectionMaxX)
        : (anchorRect.left + (anchorRect.width / 2))
      const anchorY = anchorRect.top - 8

      const transition = buildSelectionEntryTransition(dragStartPointerRef.current, pointer)

      setSelectionMenuTransitionConfig(transition)
      triggerSelectionMenuEntryReplay()
      openFromSelection({
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
  }, [annotations, closeSelectionMenu, triggerSelectionMenuEntryReplay, openFromSelection])

  const handleTextSelection = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!canAnnotate || !onAddAnnotation || !messageId) return
    const root = contentLayerRef.current
    if (!root) return

    if (shouldIgnoreSelectionMouseUpTarget(event.target)) {
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
  }, [canAnnotate, onAddAnnotation, messageId, annotations, showSelectionMenuFromCurrentSelection, closeSelectionMenu])

  useEffect(() => {
    if (!canAnnotate || !onAddAnnotation || !messageId) return

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
  }, [canAnnotate, onAddAnnotation, messageId, showSelectionMenuFromCurrentSelection])

  const handleSelectionMenuRequestBack = useCallback((): boolean => {
    if (selectionMenuView !== 'compact') {
      handleCancelFollowUp()
      return true
    }

    return false
  }, [selectionMenuView, handleCancelFollowUp])

  useAnnotationIslandEvents({
    enabled: allowAnnotationIsland && hasAnnotationInteraction(interactionState) && isSelectionMenuVisible,
    openedAtRef: selectionMenuOpenedAtRef,
    isCompactView: selectionMenuView === 'compact',
    isTargetInsideAnnotationIsland,
    onBack: handleSelectionMenuRequestBack,
    onClose: closeSelectionMenu,
  })

  const selectionMenu = allowAnnotationIsland ? (
    <AnnotationIslandMenu
      anchor={selectionMenuRenderAnchor}
      sourceKey={selectionMenuRenderSourceKey}
      replayNonce={selectionMenuShowNonce}
      isVisible={isSelectionMenuVisible}
      activeView={selectionMenuView}
      mode={followUpMode}
      draft={followUpDraft}
      onDraftChange={setFollowUpDraft}
      onOpenFollowUp={handleOpenFollowUpView}
      onCancel={handleCancelFollowUp}
      onRequestBack={handleSelectionMenuRequestBack}
      onRequestEdit={handleRequestFollowUpEdit}
      onSubmit={handleSubmitFollowUp}
      onSubmitAndSend={handleSubmitAndSendFollowUp}
      onDelete={activeAnnotationDetail ? handleDeleteActiveAnnotation : undefined}
      sendMessageKey={sendMessageKey}
      transitionConfig={selectionMenuTransitionConfig}
      onExitComplete={handleSelectionMenuExitComplete}
      usePortal={shouldRenderAnnotationIslandInPortal('turncard')}
    />
  ) : null

  const annotationOverlayLayer = (
    <AnnotationOverlayLayer
      rects={annotationOverlay.rects}
      chips={annotationOverlay.chips}
      annotations={renderedAnnotations}
      getTooltipText={(annotation) => formatAnnotationFollowUpTooltipText(annotation)}
      allowChipOpen={allowAnnotationIsland}
      onChipOpen={({ annotationId, index, anchorX, anchorY, mode }) => {
        handleOpenAnnotationDetail(annotationId, index, anchorX, anchorY, mode)
      }}
    />
  )

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
  const runCommand = useRunCommand()
  const isBuffering = isStreaming && !bufferDecision.shouldShow

  // While buffering, return null - TurnCard will show a subtle indicator instead
  if (isBuffering) {
    return null
  }

  const isPlan = variant === 'plan'
  // Completed responses and plans get the full text, the footer actions and the fullscreen
  // reader; a streaming response shows the throttled text only.
  const isSettled = isCompleted || isPlan
  const acceptLabel = hasActiveFollowUpAnnotations ? t('plan.acceptAndSendFollowups') : t('plan.acceptPlan')
  const acceptOptionLabel = hasActiveFollowUpAnnotations ? t('plan.acceptAndSendFollowups') : t('plan.accept')
  const canAcceptPlan = isPlan && showAcceptPlan && !!onAccept && !!onAcceptWithCompact

  // Answer body: plain copy on the transcript (no card, no inner scroll cap). The fullscreen
  // action moved into the footer, so the first mermaid block keeps its own expand button.
  const body = (
    <div
      ref={contentRef}
      data-search-root="response"
      onMouseDown={handleSelectionPointerDown}
      onMouseUp={handleTextSelection}
      className={cn(ANSWER_PROSE, isPlan && 'px-4 py-3', !isSettled && hasMountedRef.current && ANSWER_BLOCK_IN)}
    >
      <div ref={contentLayerRef} className="relative">
        <Markdown
          mode="minimal"
          onUrlClick={onOpenUrl}
          onFileClick={onOpenFile}
          hideFirstMermaidExpand={false}
        >
          {isSettled ? text : displayedText}
        </Markdown>
        {annotationOverlayLayer}
      </div>
    </div>
  )

  // Desktop footer (Copy / Markdown / Fullscreen / Branch, + Accept Plan on plans).
  // Compact mode keeps message chrome minimal: only the Accept-Plan drawer below.
  const footer = isSettled && !compactMode ? (
    <ResponseFooter
      variant={isPlan ? 'plan' : 'answer'}
      copied={copied}
      onCopy={handleCopy}
      onPopOut={onPopOut}
      onViewFullscreen={() => setIsFullscreen(true)}
      onBranch={onBranch}
      trailing={canAcceptPlan ? (
        <div
          className={cn(
            'transition-[opacity,visibility] duration-fast ease-out',
            isLastResponse ? 'visible opacity-100' : 'invisible pointer-events-none opacity-0'
          )}
        >
          <AcceptPlanDropdown
            onAccept={onAccept!}
            onAcceptWithCompact={onAcceptWithCompact!}
            acceptLabel={acceptLabel}
            acceptOptionLabel={acceptOptionLabel}
          />
        </div>
      ) : undefined}
    />
  ) : null

  // Compact footer — Accept Plan only (mobile / auto-compact / popover).
  // Uses a bottom-sheet drawer to match the CompactPermissionModeSelector
  // / CompactModelSelector pattern. Guarded by isLastResponse so older
  // plans don't render an empty strip with a hidden-but-focusable button.
  const compactFooter = isSettled && compactMode && canAcceptPlan && isLastResponse ? (
    <div className="flex items-center justify-end border-t border-subtle px-2 py-1.5">
      <CompactAcceptPlanDrawer
        onAccept={onAccept!}
        onAcceptWithCompact={onAcceptWithCompact!}
        acceptLabel={acceptLabel}
        acceptOptionLabel={acceptOptionLabel}
      />
    </div>
  ) : null

  return (
    // A streaming answer's code blocks offer no "Run in background": half a command must never run
    <RunCommandProvider value={isStreaming ? null : runCommand}>
      {isPlan ? (
        // Plan: raised card with a header; the footer holds the primary Accept action
        <div className="group/answer overflow-hidden rounded-lg bg-raised shadow-elev-1">
          <div className="flex h-9 select-none items-center gap-2 border-b border-subtle px-4 text-label">
            <ListTodo aria-hidden className={cn(SIZE_CONFIG.iconSize, 'text-secondary')} />
            <span className="font-medium text-foreground">{t('turnCard.plan')}</span>
          </div>
          {body}
          {footer}
          {compactFooter}
        </div>
      ) : (
        <div className="group/answer flex min-w-0 flex-col gap-2">
          {body}
          {footer}
        </div>
      )}

      {/* Fullscreen overlay for reading/annotating response and plan content. */}
      {isSettled && (
        <DocumentFormattedMarkdownOverlay
          content={text}
          isOpen={isFullscreen}
          onClose={() => setIsFullscreen(false)}
          variant={isPlan ? 'plan' : undefined}
          onOpenUrl={onOpenUrl}
          onOpenFile={onOpenFile}
          sessionId={sessionId}
          messageId={messageId}
          annotations={annotations}
          onAddAnnotation={onAddAnnotation}
          onRemoveAnnotation={onRemoveAnnotation}
          onUpdateAnnotation={onUpdateAnnotation}
          sendMessageKey={sendMessageKey}
          openAnnotationRequest={openAnnotationRequest}
          isStreaming={isStreaming}
        />
      )}
      {selectionMenu}
    </RunCommandProvider>
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
  onSaveAndSendFollowUp,
  hasActiveFollowUpAnnotations = false,
  openAnnotationRequest,
  annotationInteractionMode = 'interactive',
}: TurnCardProps) {
  const { t } = useTranslation()
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
      // Let the row reveal settle before scrolling
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


  // Summary of the collapsed work log (text swaps in place — no per-update animation)
  const workLogPreview = useMemo(
    () => getWorkLogPreview(activities, intent, isStreaming, !!response, isComplete),
    [activities, intent, isStreaming, response, isComplete]
  )
  const failedCount = useMemo(() => countFailedActivities(activities), [activities])

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

  // Group when the turn has subagent work: a Task/Agent call, or rows of a subagent launched in an
  // earlier turn (they would otherwise interleave with this turn's rows)
  const hasTaskSubagents = useMemo(
    () => sortedActivities.some(a => isParentTaskTool(a.toolName ?? '') || a.parentId),
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
  const thinkingLabel = isThinking && !animateResponse
    ? (isBuffering ? t('turnCard.preparingResponse') : t('chat.processing.thinking'))
    : undefined

  const renderResponse = (resp: ResponseContent) => (
    <ResponseCard
      text={resp.text}
      isStreaming={resp.isStreaming}
      streamStartTime={resp.streamStartTime}
      sessionId={sessionId}
      onOpenFile={onOpenFile}
      onOpenUrl={onOpenUrl}
      onPopOut={onPopOut ? () => onPopOut(resp.text) : undefined}
      variant={resp.isPlan ? 'plan' : 'response'}
      messageId={resp.messageId}
      annotations={resp.annotations}
      onAddAnnotation={onAddAnnotation}
      onRemoveAnnotation={onRemoveAnnotation}
      onUpdateAnnotation={onUpdateAnnotation}
      onSaveAndSendFollowUp={onSaveAndSendFollowUp}
      onAccept={onAcceptPlan}
      onAcceptWithCompact={onAcceptPlanWithCompact}
      isLastResponse={isLastResponse}
      compactMode={compactMode}
      onBranch={onBranch && resp.messageId ? (options?: { newPanel?: boolean }) => onBranch(resp.messageId!, options) : undefined}
      sendMessageKey={sendMessageKey}
      hasActiveFollowUpAnnotations={hasActiveFollowUpAnnotations}
      openAnnotationRequest={openAnnotationRequest}
      annotationInteractionMode={annotationInteractionMode}
    />
  )

  // A turn is a quiet work log + the answer, 10px apart (spec §7.4, mockup `.turn`)
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      {/* Activity Section - excluded from search highlighting (matches ripgrep behavior) */}
      {hasActivities && (
        <WorkLog
          activityCount={activities.length}
          preview={workLogPreview}
          failedCount={failedCount}
          isExpanded={isExpanded}
          onToggle={toggleExpanded}
          actionsMenu={renderActionsMenu ? renderActionsMenu() : (
            <TurnCardActionsMenu
              onOpenDetails={onOpenDetails}
              onOpenMultiFileDiff={onOpenMultiFileDiff}
              hasEditOrWriteActivities={hasEditOrWriteActivities}
            />
          )}
          activities={sortedActivities}
          groupedActivities={groupedActivities}
          lastChildSet={lastChildSet}
          expandedActivityGroups={expandedActivityGroups}
          onExpandedActivityGroupsChange={handleExpandedActivityGroupsChange}
          onOpenActivityDetails={onOpenActivityDetails}
          sessionFolderPath={sessionFolderPath}
          displayMode={displayMode}
          thinkingLabel={thinkingLabel}
          todos={todos}
          animateInserts={hasMounted.current}
          listRef={activitiesContainerRef}
        />
      )}

      {/* Standalone thinking indicator - when no activities but still working */}
      {!hasActivities && thinkingLabel && <ThinkingRow label={thinkingLabel} />}

      {/* Plan Activities - rendered as full ResponseCards, time-sorted with other activities */}
      {planActivities.map((planActivity, index) => (
        <div key={planActivity.id} className="select-text">
          <ResponseCard
            text={planActivity.content || ''}
            isStreaming={false}
            sessionId={sessionId}
            onOpenFile={onOpenFile}
            onOpenUrl={onOpenUrl}
            onPopOut={onPopOut ? () => onPopOut(planActivity.content || '') : undefined}
            variant="plan"
            messageId={planActivity.messageId}
            annotations={planActivity.annotations}
            onAddAnnotation={onAddAnnotation}
            onRemoveAnnotation={onRemoveAnnotation}
            onUpdateAnnotation={onUpdateAnnotation}
            onSaveAndSendFollowUp={onSaveAndSendFollowUp}
            onAccept={onAcceptPlan}
            onAcceptWithCompact={onAcceptPlanWithCompact}
            isLastResponse={isLastResponse && index === planActivities.length - 1}
            compactMode={compactMode}
            onBranch={onBranch ? (options?: { newPanel?: boolean }) => onBranch(planActivity.messageId ?? planActivity.id, options) : undefined}
            sendMessageKey={sendMessageKey}
            hasActiveFollowUpAnnotations={hasActiveFollowUpAnnotations}
            openAnnotationRequest={openAnnotationRequest}
            annotationInteractionMode={annotationInteractionMode}
          />
        </div>
      ))}

      {/* Response Section - only shown when not buffering */}
      {/* Animated version for playground demos */}
      {animateResponse && (
        <AnimatePresence>
          {response && !isBuffering && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={TWEEN.base}
              className="select-text"
            >
              {renderResponse(response)}
            </motion.div>
          )}
        </AnimatePresence>
      )}
      {/* Non-animated version for regular app use */}
      {!animateResponse && response && !isBuffering && (
        <div className="select-text">{renderResponse(response)}</div>
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

  // Re-render if compactMode changed (affects ResponseCard footer rendering)
  if (prev.compactMode !== next.compactMode) return false

  // Re-render if annotation interaction mode changed (interactive vs tooltip-only)
  if (prev.annotationInteractionMode !== next.annotationInteractionMode) return false

  // Re-render if activities changed (important for playground/testing scenarios)
  if (prev.activities !== next.activities) return false

  // Re-render when response object changes (e.g., annotation updates)
  if (prev.response !== next.response) return false

  // Re-render when external annotation-open requests change
  if (prev.openAnnotationRequest !== next.openAnnotationRequest) return false

  // Re-render when active follow-up annotation state changes (plan CTA label)
  if (prev.hasActiveFollowUpAnnotations !== next.hasActiveFollowUpAnnotations) return false

  // For complete, non-streaming turns: skip re-render only when both
  // session and turn identities match. Prevents stale local UI state from
  // leaking across session switches that may reuse turn IDs/components.
  return prev.sessionId === next.sessionId && prev.turnId === next.turnId
})
