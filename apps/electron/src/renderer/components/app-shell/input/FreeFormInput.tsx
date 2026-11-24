import * as React from 'react'
import { useTranslation } from "react-i18next"
import { toast } from 'sonner'
import { checkAttachmentSizes, DEFAULT_MAX_MESSAGE_BYTES, formatAttachmentBytes, type AttachmentSizeInput, type AttachmentSizeProblem } from '@craft-agent/shared/protocol'
import {
  Paperclip,
  ChevronUp,
} from 'lucide-react'
import { Icon_Home, consoleSnippetCommand } from '@craft-agent/ui'

import { IconButton } from '@/components/ui/button'
import {
  InlineSlashCommand,
  useInlineSlashCommand,
  type SlashCommandId,
} from '@/components/ui/slash-command-menu'
import {
  InlineMentionMenu,
  useInlineMention,
  type MentionItem,
  type MentionItemType,
} from '@/components/ui/mention-menu'
import {
  InlineLabelMenu,
  useInlineLabelMenu,
} from '@/components/ui/label-menu'
import type { LabelConfig } from '@craft-agent/shared/labels'
import { parseMentions } from '@/lib/mentions'
import { RichTextInput, type RichTextInputHandle } from '@/components/ui/rich-text-input'
import { useInputAvailableHeight } from '@/hooks/useInputAvailableHeight'
import { useTransportConnectionState } from '@/hooks/useTransportConnectionState'
import { getComposerMaxHeight } from './composer-height'
import { getContextDisplay, getContextDisplayLabels, type ContextStatus } from './context-display'
import { createPendingPlanDispatcher } from './pending-plan-dispatch'
import { scrollFocusedCaretIntoView } from '@/lib/scroll-focused-caret'
import { cn } from '@/lib/utils'
import { coerceInputText } from '@/lib/input-text'
import { isMac } from '@/lib/platform'
import { applySmartTypography } from '@/lib/smart-typography'
import { AttachmentPreview } from '../AttachmentPreview'
import { ImageSupportWarningBanner } from './ImageSupportWarningBanner'
import { getModelContextWindow } from '@config/models'
import { isCompatProvider, modelSupportsImages } from '@config/llm-connections'
import { useOptionalAppShellContext } from '@/context/AppShellContext'
import { EditPopover, getEditConfig } from '@/components/ui/EditPopover'
import { CompactWorkingDirectorySelector } from '@/components/ui/CompactWorkingDirectorySelector'
import { FreeFormInputContextBadge } from './FreeFormInputContextBadge'
import type { FileAttachment, LoadedSource, LoadedSkill } from '../../../../shared/types'
import { isPermissionMode, planExecutionMode, type PermissionMode } from '@craft-agent/shared/agent/modes'
import { useAvailablePermissionModes } from '@/hooks/useAvailablePermissionModes'
import type { ThinkingLevel } from '@craft-agent/shared/agent/thinking-levels'
import { useEscapeInterrupt } from '@/context/EscapeInterruptContext'
import { hasOpenOverlay } from '@/lib/overlay-detection'
import { ToolbarStatusSlot } from './ToolbarStatusSlot'
import { buildPlanApprovalMessage } from '../plan-approval-message'
import { shouldHandleScopedInputEvent, shouldRecallPromptOnArrowUp } from './input-event-guards'
import { clearPendingFocusForSession, consumePendingFocusForSession } from './focus-input-events'
import {
  getRecentWorkingDirs,
  addRecentWorkingDir,
} from './working-directory-history'
import { WorkingDirectorySelector, formatPathForDisplay } from './WorkingDirectorySelector'
import { CompactPermissionModeSelector } from './CompactPermissionModeSelector'
import { CompactModelSelector } from './CompactModelSelector'
import { useModelPickerState } from './useModelPickerState'
import { useModelVisionToggle } from './useModelVisionToggle'
import { ComposerSourcesChip } from './ComposerSourcesChip'
import { ComposerCodingChip } from './ComposerCodingChip'
import { CraftyComposerChip } from '@/components/crafty/CraftyComposerChip'
import { useDirectoryPicker } from '@/hooks/useDirectoryPicker'
import { ServerDirectoryBrowser } from '@/components/ServerDirectoryBrowser'
import { ComposerModelMenu } from './ComposerModelMenu'
import { ComposerModeChip } from './ComposerModeChip'
import { ContextUsageChip } from './ContextUsageChip'
import { FollowUpChips } from './FollowUpChips'
import { SendButton } from './SendButton'


/** Platform-specific modifier key for keyboard shortcuts */
const cmdKey = isMac ? '⌘' : 'Ctrl'

/** Default rotating placeholders are now generated inside FreeFormInput via useMemo + t() */

/** Fisher-Yates shuffle — returns a new array in random order */
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

export interface FollowUpInputItem {
  id: string
  messageId: string
  annotationId: string
  index?: number
  noteLabel: string
  selectedText: string
  color?: string
}

export interface FreeFormInputProps {
  /** A console snippet was pasted (`$ cmd` lines or a fenced shell block): offer to run it in the background */
  onConsoleSnippetPaste?: (snippet: { command: string; text: string }) => void
  /** Placeholder text(s) for the textarea - can be array for rotation */
  placeholder?: string | string[]
  /** Whether input is disabled */
  disabled?: boolean
  /** Whether the session is currently processing */
  isProcessing?: boolean
  /** Callback when message is submitted (skillSlugs from @mentions) */
  onSubmit: (message: string, attachments?: FileAttachment[], skillSlugs?: string[]) => void
  /** Callback to stop processing. Pass silent=true to skip "Response interrupted" message */
  onStop?: (silent?: boolean) => void
  /** External ref for the input */
  inputRef?: React.RefObject<RichTextInputHandle>
  /** Current model ID */
  currentModel: string
  /** Callback when model changes (includes connection slug for proper persistence) */
  onModelChange: (model: string, connection?: string) => void
  // Thinking level (session-level setting)
  /** Current thinking level ('off', 'think', 'max') */
  thinkingLevel?: ThinkingLevel
  /** Callback when thinking level changes */
  onThinkingLevelChange?: (level: ThinkingLevel) => void
  // Advanced options
  permissionMode?: PermissionMode
  /** Mode before the last change: an approved plan leaving Explore returns to Guarded from it */
  previousPermissionMode?: PermissionMode
  onPermissionModeChange?: (mode: PermissionMode) => void
  /** Enabled permission modes for Shift+Tab cycling (min 2 modes) */
  enabledModes?: PermissionMode[]
  /**
   * Desktop: show the permission-mode chip in the toolbar (it moved there from the badge row
   * above the composer). Compact always uses the drawer selector when `onPermissionModeChange`
   * is set.
   */
  showPermissionModeChip?: boolean
  // Controlled input value (for persisting across mode switches and conversation changes)
  /** Current input value - if provided, component becomes controlled */
  inputValue?: string
  /** Callback when input value changes */
  onInputChange?: (value: string) => void
  /** Persisted attachment draft for this session (seeds local state on session switch) */
  attachmentsValue?: FileAttachment[]
  /** Callback when attachment list changes (add, remove, clear on send) */
  onAttachmentsChange?: (attachments: FileAttachment[]) => void
  /** When true, removes container styling (shadow, bg, rounded) - used when wrapped by InputContainer */
  unstyled?: boolean
  /** Total height budget, including actions; supplied by InputContainer when wrapped. */
  maxHeight?: number
  /** Callback when component height changes (for external animation sync) */
  onHeightChange?: (height: number) => void
  /** Callback when focus state changes */
  onFocusChange?: (focused: boolean) => void
  // Source selection
  /** Available sources (enabled only) */
  sources?: LoadedSource[]
  /** Currently enabled source slugs for this session */
  enabledSourceSlugs?: string[]
  /** Callback when source selection changes */
  onSourcesChange?: (slugs: string[]) => void
  // Skill selection (for @mentions)
  /** Available skills for @mention autocomplete */
  skills?: LoadedSkill[]
  // Label selection (for #labels)
  /** Available labels for #label autocomplete */
  labels?: LabelConfig[]
  /** Currently applied session labels */
  sessionLabels?: string[]
  /** Callback when a label is added via # menu */
  onLabelAdd?: (labelId: string) => void
  /** Workspace ID for loading skill icons */
  workspaceId?: string
  /** Current working directory path */
  workingDirectory?: string
  /** Callback when working directory changes */
  onWorkingDirectoryChange?: (path: string) => void
  /** Session folder path (for "Reset to Session Root" option) */
  sessionFolderPath?: string
  /** Session ID for scoping events like approve-plan */
  sessionId?: string
  /** Current session status of the session (for # menu state selection) */
  currentSessionStatus?: string
  /** Disable send action (for tutorial guidance) */
  disableSend?: boolean
  /** Whether the session is empty (no messages yet) - affects context badge prominence */
  isEmptySession?: boolean
  // Coding mode (session-level, fixed once the conversation starts)
  /** Coding mode is on: lean coding prompt and session tools */
  codingMode?: boolean
  /** Toggle coding mode (only before the first message) */
  onCodingModeChange?: (enabled: boolean) => void
  /** Continue a started session in a new one with coding mode set to `enabled` */
  onContinueWithCodingMode?: (enabled: boolean) => void
  /** Context status for showing compaction indicator and token usage */
  contextStatus?: ContextStatus
  /** Follow-up annotations shown as context chips above the input */
  followUpItems?: FollowUpInputItem[]
  /** Callback when user clicks a follow-up chip body */
  onFollowUpClick?: (item: FollowUpInputItem, anchor?: { x: number; y: number }) => void
  /** Callback when user clicks the follow-up index badge */
  onFollowUpIndexClick?: (item: FollowUpInputItem) => void
  /**
   * Compact-footer layout. Used by EditPopover (popover embedding) and by
   * ChatPage in auto-compact / WebUI mobile mode. The popover case hides the
   * model picker; the auto-compact case opts the compact picker in via
   * `enableCompactModelPicker`.
   */
  compactMode?: boolean
  /**
   * When `compactMode` is true, render the compact (drawer-based) model
   * selector next to the permission-mode pill. Defaults to false so that
   * EditPopover (which has no use for a model picker) keeps its current
   * behavior.
   */
  enableCompactModelPicker?: boolean
  // Connection selection (hierarchical connection → model selector)
  /** Current session connection slug. */
  currentConnection?: string
  /** Select a connection before the first message, or explicitly switch a compatible account. */
  onConnectionChange?: (connectionSlug: string, switchAccount?: boolean) => void
  /** When true, the session's locked connection has been removed */
  connectionUnavailable?: boolean
  /**
   * True when the input is collapsed because the agent is processing in
   * compact mode and the user hasn't expanded it yet. Owned by
   * `InputContainer`; toggle back via `onRequestExpand`.
   */
  isCollapsedInCompact?: boolean
  /** Callback fired when the user clicks or hovers the collapsed-input strip. */
  onRequestExpand?: () => void
}

/**
 * FreeFormInput - Self-contained textarea input with attachments and controls
 *
 * Features:
 * - Auto-growing textarea
 * - File attachments via button or drag-drop
 * - Slash commands menu
 * - Model selector
 * - Active option badges
 */
export function FreeFormInput({
  onConsoleSnippetPaste,
  placeholder,
  disabled = false,
  isProcessing = false,
  onSubmit,
  onStop,
  inputRef: externalInputRef,
  currentModel,
  onModelChange,
  thinkingLevel = 'medium',
  onThinkingLevelChange,
  permissionMode = 'ask',
  previousPermissionMode,
  onPermissionModeChange,
  enabledModes = ['safe', 'ask', 'allow-all'],
  showPermissionModeChip = false,
  inputValue,
  onInputChange,
  attachmentsValue,
  onAttachmentsChange,
  unstyled = false,
  onHeightChange,
  maxHeight,
  onFocusChange,
  sources = [],
  enabledSourceSlugs = [],
  onSourcesChange,
  skills = [],
  labels = [],
  sessionLabels = [],
  onLabelAdd,
  workspaceId,
  workingDirectory,
  onWorkingDirectoryChange,
  sessionFolderPath,
  sessionId,
  currentSessionStatus,
  disableSend = false,
  isEmptySession = false,
  codingMode = false,
  onCodingModeChange,
  onContinueWithCodingMode,
  contextStatus,
  followUpItems = [],
  onFollowUpClick,
  onFollowUpIndexClick,
  compactMode = false,
  enableCompactModelPicker = false,
  currentConnection,
  onConnectionChange,
  connectionUnavailable = false,
  isCollapsedInCompact = false,
  onRequestExpand,
}: FreeFormInputProps) {
  const { t } = useTranslation()

  // Default rotating placeholders for onboarding/empty state (i18n-aware). The keyboard tips are
  // left out in compact (touch) layouts, where they are noise.
  const defaultPlaceholders = React.useMemo(() => [
    t("chatInput.placeholder.workOn"),
    ...(compactMode ? [] : [t("chatInput.placeholder.shiftTab")]),
    t("chatInput.placeholder.mention"),
    t("chatInput.placeholder.labels"),
    ...(compactMode ? [] : [
      t("chatInput.placeholder.newLine"),
      t("chatInput.placeholder.sidebar", { key: cmdKey }),
      t("chatInput.placeholder.focusMode", { key: cmdKey }),
    ]),
  ], [t, compactMode])

  // Read connection default model, connections, and workspace info from context.
  // Uses optional variant so playground (no provider) doesn't crash.
  const appShellCtx = useOptionalAppShellContext()
  const llmConnections = appShellCtx?.llmConnections ?? []
  const workspaceDefaultConnection = appShellCtx?.workspaceDefaultLlmConnection

  // What the model picker shows (shared with the compact drawer and Crafty). The `switcher`
  // wins over `locked-single`, so a single-model pi_compat default can still reach the connection
  // list on a fresh session (#727).
  const {
    effectiveConnection,
    effectiveConnectionDetails,
    currentConnectionDetails,
    accountSwitchTargets,
    connectionDefaultModel,
    pickerMode,
    availableModels,
    currentModelDisplayName,
    thinkingDisabled,
    connectionsByProvider,
  } = useModelPickerState({
    llmConnections,
    workspaceDefaultConnection,
    currentConnection,
    currentModel,
    isEmptySession,
    connectionUnavailable,
  })

  // Access sessionStatuses and onSessionStatusChange from context for the # menu state picker
  const sessionStatuses = appShellCtx?.sessionStatuses ?? []
  const onSessionStatusChange = appShellCtx?.onSessionStatusChange
  // Resolve workspace rootPath for "Add New Label" deep link
  const workspaceRootPath = React.useMemo(() => {
    if (!appShellCtx || !workspaceId) return null
    return appShellCtx.workspaces.find(w => w.id === workspaceId)?.rootPath ?? null
  }, [appShellCtx, workspaceId])

  // Workspace slug for SDK skill qualification (server-computed)
  // SDK expects "workspaceSlug:skillSlug" format, NOT UUID
  const workspaceSlug = React.useMemo(() => {
    if (!appShellCtx || !workspaceId) return workspaceId
    return appShellCtx.workspaces.find(w => w.id === workspaceId)?.slug ?? workspaceId
  }, [appShellCtx, workspaceId])

  // Read panel focus state from context (for multi-panel unfocused styling)
  const appShellContext = useOptionalAppShellContext()
  const isFocusedPanel = appShellContext?.isFocusedPanel ?? true

  // In compact mode, suppress desktop-keyboard guidance that is noisy or misleading on
  // narrow/mobile-like layouts: the defaults drop their keyboard tips above, and caller-provided
  // lists drop entries that mention keys.
  const placeholderOptions = React.useMemo(() => {
    if (placeholder === undefined) return defaultPlaceholders
    if (!Array.isArray(placeholder)) return placeholder
    if (!compactMode) return placeholder
    return placeholder.filter((entry) => {
      const lower = entry.toLowerCase()
      return !lower.includes('shift + tab')
        && !lower.includes('shift + return')
        && !lower.includes('toggle the sidebar')
        && !lower.includes('focus mode')
        && !lower.includes('⌘')
        && !lower.includes('ctrl')
    })
  }, [placeholder, compactMode, defaultPlaceholders])

  // Shuffle placeholder order once per mount so each session feels fresh.
  // Hide placeholder entirely when panel is unfocused in multi-panel layout
  const shuffledPlaceholder = React.useMemo(
    () => Array.isArray(placeholderOptions) ? shuffleArray(placeholderOptions) : placeholderOptions,
    [] // eslint-disable-line react-hooks/exhaustive-deps -- intentionally shuffle only on mount
  )
  const effectivePlaceholder = isFocusedPanel ? shuffledPlaceholder : ''

  // Performance optimization: Always use internal state for typing to avoid parent re-renders
  // Sync FROM parent on mount/change (for restoring drafts)
  // Sync TO parent on blur/submit (debounced persistence)
  const [input, setInput] = React.useState(() => coerceInputText(inputValue))
  const [attachments, setAttachments] = React.useState<FileAttachment[]>(attachmentsValue ?? [])

  // Ref to track current attachments for use in event handlers (avoids stale closure issues)
  const attachmentsRef = React.useRef<FileAttachment[]>([])
  React.useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])

  // Attachments must fit in one message to the connected server, or the send drops the
  // connection ("Connection lost"); the server advertises its limit (message-limits.ts).
  const transportState = useTransportConnectionState()
  const maxMessageBytesRef = React.useRef(DEFAULT_MAX_MESSAGE_BYTES)
  React.useEffect(() => {
    maxMessageBytesRef.current = transportState?.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES
  }, [transportState?.maxMessageBytes])

  const showAttachmentSizeProblem = React.useCallback((problem: AttachmentSizeProblem) => {
    const size = formatAttachmentBytes(problem.size)
    const limit = formatAttachmentBytes(problem.limit)
    if (problem.kind === 'file') {
      toast.error(t('toast.attachmentTooLarge', { name: problem.name }), { description: t('toast.attachmentTooLargeDescription', { size, limit }) })
    } else {
      toast.error(t('toast.attachmentsTooLarge'), { description: t('toast.attachmentsTooLargeDescription', { size, limit }) })
    }
  }, [t])

  /** Refuse a file that can never be sent, before reading it (reading a huge file can freeze the window). */
  const refuseOversizedAttachment = React.useCallback((attachment: AttachmentSizeInput): boolean => {
    const problem = checkAttachmentSizes([attachment], maxMessageBytesRef.current)
    if (problem?.kind !== 'file') return false
    showAttachmentSizeProblem(problem)
    return true
  }, [showAttachmentSizeProblem])

  // Seed from parent when `attachmentsValue` changes (e.g., switching sessions).
  // `skipPersistRef` tells the save effect below that the next `attachments` change
  // is a prop-driven seed, not user intent — otherwise we'd echo the seed back to
  // the parent and risk persisting A's attachments under B's sessionId.
  const attachmentsRefsKey = React.useMemo(() => {
    if (!attachmentsValue) return ''
    return attachmentsValue.map(a => a.path).join('|')
  }, [attachmentsValue])
  const prevAttachmentsRefsKey = React.useRef(attachmentsRefsKey)
  const skipPersistRef = React.useRef(true) // treat initial mount as a prop-seed
  React.useEffect(() => {
    if (attachmentsValue === undefined) return
    if (attachmentsRefsKey === prevAttachmentsRefsKey.current) return
    prevAttachmentsRefsKey.current = attachmentsRefsKey
    skipPersistRef.current = true
    setAttachments(attachmentsValue)
  }, [attachmentsValue, attachmentsRefsKey])

  // Persist user-initiated attachment changes back to the parent. The parent stores
  // refs (path + name) and debounces the disk write, so we fire eagerly on every
  // change — add/remove/send-clear.
  const onAttachmentsChangeRef = React.useRef(onAttachmentsChange)
  onAttachmentsChangeRef.current = onAttachmentsChange
  React.useEffect(() => {
    if (skipPersistRef.current) {
      skipPersistRef.current = false
      return
    }
    onAttachmentsChangeRef.current?.(attachments)
  }, [attachments])

  // Optimistic state for source selection - updates UI immediately before IPC round-trip completes
  const [optimisticSourceSlugs, setOptimisticSourceSlugs] = React.useState(enabledSourceSlugs)

  // Sync from prop when server state changes (reconciles after IPC or on external updates)
  // Use content comparison (not reference) to avoid infinite loops with empty arrays
  const prevEnabledSourceSlugsRef = React.useRef(enabledSourceSlugs)
  React.useEffect(() => {
    const prev = prevEnabledSourceSlugsRef.current
    const changed = enabledSourceSlugs.length !== prev.length ||
      enabledSourceSlugs.some((slug, i) => slug !== prev[i])

    if (changed) {
      setOptimisticSourceSlugs(enabledSourceSlugs)
      prevEnabledSourceSlugsRef.current = enabledSourceSlugs
    }
  }, [enabledSourceSlugs])

  // Sync from parent when inputValue changes externally (e.g., switching sessions)
  const prevInputValueRef = React.useRef(coerceInputText(inputValue))
  React.useEffect(() => {
    if (inputValue === undefined) return
    const nextInputValue = coerceInputText(inputValue)
    if (nextInputValue !== prevInputValueRef.current) {
      setInput(nextInputValue)
      prevInputValueRef.current = nextInputValue
    }
  }, [inputValue])

  // Debounced sync to parent (saves draft without blocking typing)
  const syncTimeoutRef = React.useRef<NodeJS.Timeout | null>(null)
  const syncToParent = React.useCallback((value: string) => {
    if (!onInputChange) return
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current)
    syncTimeoutRef.current = setTimeout(() => {
      onInputChange(value)
      prevInputValueRef.current = value
    }, 300) // Debounce 300ms
  }, [onInputChange])

  // Sync immediately on unmount to preserve input across mode switches
  // Also cleanup any pending debounced sync
  const inputRef = React.useRef(input)
  inputRef.current = input // Keep ref in sync with state

  React.useEffect(() => {
    return () => {
      // Cancel pending debounced sync
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current)
      // Immediately sync current value to parent on unmount
      // This preserves input when switching to structured input (e.g., permission request)
      if (onInputChange && inputRef.current !== prevInputValueRef.current) {
        onInputChange(inputRef.current)
      }
    }
  }, [onInputChange])

  const [isDraggingOver, setIsDraggingOver] = React.useState(false)
  const [loadingCount, setLoadingCount] = React.useState(0)
  const [sourceDropdownOpen, setSourceDropdownOpen] = React.useState(false)
  const [isFocused, setIsFocused] = React.useState(false)
  const [modelDropdownOpen, setModelDropdownOpen] = React.useState(false)

  // Input settings (loaded from config)
  const [autoCapitalisation, setAutoCapitalisation] = React.useState(true)
  const [sendMessageKey, setSendMessageKey] = React.useState<'enter' | 'cmd-enter'>('enter')
  const [spellCheck, setSpellCheck] = React.useState(false)

  // Load input settings on mount
  React.useEffect(() => {
    const loadInputSettings = async () => {
      if (!window.electronAPI) return
      try {
        const [autoCapEnabled, sendKey, spellCheckEnabled] = await Promise.all([
          window.electronAPI.getAutoCapitalisation(),
          window.electronAPI.getSendMessageKey(),
          window.electronAPI.getSpellCheck(),
        ])
        setAutoCapitalisation(autoCapEnabled)
        setSendMessageKey(sendKey ?? 'enter')
        setSpellCheck(spellCheckEnabled)
      } catch (error) {
        console.error('Failed to load input settings:', error)
      }
    }
    loadInputSettings()
  }, [])

  // Double-Esc interrupt: show warning overlay on first Esc, interrupt on second
  const { showEscapeOverlay } = useEscapeInterrupt()

  const dragCounterRef = React.useRef(0)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const contentScrollRef = React.useRef<HTMLDivElement>(null)
  const availableHeight = useInputAvailableHeight(containerRef, maxHeight === undefined)
  const composerMaxHeight = maxHeight ?? getComposerMaxHeight(availableHeight, 'freeform')
  const sourceButtonRef = React.useRef<HTMLButtonElement>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  // Merge refs for RichTextInput
  const internalInputRef = React.useRef<RichTextInputHandle>(null)
  const richInputRef = externalInputRef || internalInputRef

  // Track last caret position for focus restoration (e.g., after permission mode popover closes)
  const lastCaretPositionRef = React.useRef<number | null>(null)

  // Listen for craft:insert-text events (generic mechanism for inserting text into input)
  // Used by components that want to pre-fill the input with text
  React.useEffect(() => {
    const handleInsertText = (e: CustomEvent<{ text: string; sessionId?: string }>) => {
      const targetSessionId = e.detail?.sessionId
      if (!shouldHandleScopedInputEvent({ sessionId, isFocusedPanel, targetSessionId })) return

      const text = coerceInputText(e.detail?.text)
      setInput(text)
      syncToParent(text)
      // Focus the input after inserting
      setTimeout(() => {
        richInputRef.current?.focus()
        // Move cursor to end
        richInputRef.current?.setSelectionRange(text.length, text.length)
      }, 0)
    }

    window.addEventListener('craft:insert-text', handleInsertText as EventListener)
    return () => window.removeEventListener('craft:insert-text', handleInsertText as EventListener)
  }, [sessionId, isFocusedPanel, syncToParent, richInputRef])

  const clearInputDraft = React.useCallback(() => {
    setInput('')
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current)
    onInputChange?.('')
    prevInputValueRef.current = ''
  }, [onInputChange])

  const handleToggleModelVision = useModelVisionToggle()

  const consumeInputDraftSnapshot = React.useCallback((): string => {
    const snapshot = input.trim()
    clearInputDraft()
    return snapshot
  }, [input, clearInputDraft])

  type PlanApprovalEventDetail = {
    sessionId?: string
    planPath?: string
    includeDraftInput?: boolean
    source?: string
  }

  // Listen for craft:approve-plan events (used by ResponseCard's Accept Plan button)
  // This disables safe mode AND submits the message in one action
  // Only process events for this session (sessionId must match)
  React.useEffect(() => {
    const handleApprovePlan = (e: CustomEvent<PlanApprovalEventDetail>) => {
      // Only handle if this event is for our session
      if (e.detail?.sessionId && e.detail.sessionId !== sessionId) {
        return
      }

      const shouldIncludeDraft = e.detail?.includeDraftInput !== false
      const draftInput = shouldIncludeDraft ? consumeInputDraftSnapshot() : ''
      const text = buildPlanApprovalMessage({
        planPath: e.detail?.planPath,
        draftInput,
      })

      // Leave Explore mode so the plan can run without prompts (back to Guarded if the session
      // came from it). Only switch if currently in safe mode - if user is in 'ask' mode, respect their choice
      if (permissionMode === 'safe') {
        onPermissionModeChange?.(planExecutionMode(previousPermissionMode))
      }

      onSubmit(text, undefined)
    }

    window.addEventListener('craft:approve-plan', handleApprovePlan as EventListener)
    return () => window.removeEventListener('craft:approve-plan', handleApprovePlan as EventListener)
  }, [sessionId, permissionMode, previousPermissionMode, onPermissionModeChange, onSubmit, consumeInputDraftSnapshot])

  // Live completion and reload recovery share one persisted-state dispatcher.
  // Register its listener before the approval listener can send /compact.
  const processingRef = React.useRef(isProcessing)
  processingRef.current = isProcessing
  const requestPendingPlanRef = React.useRef<(() => void) | null>(null)

  React.useEffect(() => {
    if (!sessionId) return
    const dispatcher = createPendingPlanDispatcher({
      isBusy: () => processingRef.current,
      load: () => window.electronAPI.getPendingPlanExecution(sessionId),
      claim: () => window.electronAPI.sessionCommand(sessionId, { type: 'markPendingPlanExecutionDispatched' }),
      submit: pending => onSubmit(buildPlanApprovalMessage({
        planPath: pending.planPath,
        draftInput: pending.draftInputSnapshot,
      }), undefined),
      clear: () => window.electronAPI.sessionCommand(sessionId, { type: 'clearPendingPlanExecution' }),
    })
    const request = () => {
      void dispatcher.request().catch(error => {
        const message = error instanceof Error ? error.message : String(error)
        if (!/Connection closed|Client disconnected|transport|socket/.test(message)) {
          console.error('[FreeFormInput] Failed to resume pending plan execution:', error)
        }
      })
    }
    const handleCompactionComplete = (event: Event) => {
      if ((event as CustomEvent<{ sessionId?: string }>).detail?.sessionId === sessionId) request()
    }
    requestPendingPlanRef.current = request
    window.addEventListener('craft:compaction-complete', handleCompactionComplete)
    request()
    return () => {
      window.removeEventListener('craft:compaction-complete', handleCompactionComplete)
      if (requestPendingPlanRef.current === request) requestPendingPlanRef.current = null
      dispatcher.dispose()
    }
  }, [sessionId, onSubmit])

  // Completion may be published while the host is finishing the current turn.
  // Its idle transition is a second wakeup, not a timing-based guess.
  React.useEffect(() => {
    if (!isProcessing) requestPendingPlanRef.current?.()
  }, [isProcessing, sessionId])

  React.useEffect(() => {
    if (!sessionId) return
    let preparing = false
    const handleApprovePlanWithCompact = async (event: CustomEvent<PlanApprovalEventDetail>) => {
      if (!shouldHandleScopedInputEvent({ sessionId, isFocusedPanel, targetSessionId: event.detail?.sessionId })) return
      if (preparing || processingRef.current) return
      preparing = true
      try {
        const draftInputSnapshot = event.detail?.includeDraftInput !== false ? consumeInputDraftSnapshot() : ''
        if (permissionMode === 'safe') onPermissionModeChange?.(planExecutionMode(previousPermissionMode))
        // Persist first. Only actual successful manual compaction changes this
        // readiness; failure/automatic compaction events never authorize a send.
        await window.electronAPI.sessionCommand(sessionId, {
          type: 'setPendingPlanExecution',
          planPath: event.detail?.planPath ?? '',
          draftInputSnapshot,
        })
        onSubmit('/compact', undefined)
      } catch (error) {
        console.error('[FreeFormInput] Failed to start plan compaction:', error)
      } finally {
        preparing = false
      }
    }
    window.addEventListener('craft:approve-plan-with-compact', handleApprovePlanWithCompact as unknown as EventListener)
    return () => window.removeEventListener('craft:approve-plan-with-compact', handleApprovePlanWithCompact as unknown as EventListener)
  }, [sessionId, isFocusedPanel, permissionMode, previousPermissionMode, onPermissionModeChange, onSubmit, consumeInputDraftSnapshot])

  // Listen for craft:focus-input events (restore focus after popover/dropdown closes)
  React.useEffect(() => {
    const handleFocusInput = (e: Event) => {
      const detail = (e as CustomEvent<{ sessionId?: string }>).detail
      const targetSessionId = detail?.sessionId
      if (!shouldHandleScopedInputEvent({ sessionId, isFocusedPanel, targetSessionId })) return

      if (targetSessionId) {
        clearPendingFocusForSession(targetSessionId)
      }

      richInputRef.current?.focus()
      // Restore caret position if saved, then clear it (one-shot)
      if (lastCaretPositionRef.current !== null) {
        richInputRef.current?.setSelectionRange(
          lastCaretPositionRef.current,
          lastCaretPositionRef.current
        )
        lastCaretPositionRef.current = null
      }
    }

    window.addEventListener('craft:focus-input', handleFocusInput)
    return () => window.removeEventListener('craft:focus-input', handleFocusInput)
  }, [sessionId, isFocusedPanel, richInputRef])

  // Recover queued focus requests after session switch/mount races.
  React.useEffect(() => {
    if (!consumePendingFocusForSession(sessionId)) return

    setTimeout(() => {
      richInputRef.current?.focus()
    }, 0)
  }, [sessionId, richInputRef])

  // Get the next available number for a pasted file prefix (e.g., pasted-image-1, pasted-image-2)
  const getNextPastedNumber = (
    prefix: 'image' | 'text' | 'file',
    existingAttachments: FileAttachment[]
  ): number => {
    const pattern = new RegExp(`^pasted-${prefix}-(\\d+)\\.`)
    let maxNum = 0
    for (const att of existingAttachments) {
      const match = att.name.match(pattern)
      if (match) {
        maxNum = Math.max(maxNum, parseInt(match[1], 10))
      }
    }
    return maxNum + 1
  }

  // Listen for craft:paste-files events (for global paste when input not focused)
  React.useEffect(() => {
    const handlePasteFiles = async (e: CustomEvent<{ files: File[]; sessionId?: string }>) => {
      if (disabled) return

      const targetSessionId = e.detail?.sessionId
      if (!shouldHandleScopedInputEvent({ sessionId, isFocusedPanel, targetSessionId })) return

      const { files } = e.detail
      if (!files || files.length === 0) return

      setLoadingCount(prev => prev + files.length)

      // Pre-assign sequential names using ref to avoid race conditions
      let nextImageNum = getNextPastedNumber('image', attachmentsRef.current)
      const fileNames: string[] = files.map(file => {
        if (!file.name || file.name === 'image.png' || file.name === 'image.jpg' || file.name === 'blob') {
          const ext = file.type.split('/')[1] || 'png'
          return `pasted-image-${nextImageNum++}.${ext}`
        }
        return file.name
      })

      for (let i = 0; i < files.length; i++) {
        const file = files[i]!
        if (refuseOversizedAttachment({ name: fileNames[i]!, size: file.size, type: file.type.startsWith('image/') ? 'image' : undefined })) {
          setLoadingCount(prev => prev - 1)
          continue
        }
        try {
          const attachment = await readFileAsAttachment(file, fileNames[i])
          if (attachment) {
            setAttachments(prev => [...prev, attachment])
          }
        } catch (error) {
          console.error('[FreeFormInput] Failed to process pasted file:', error)
        }
        setLoadingCount(prev => prev - 1)
      }

      // Focus the input after adding attachments
      richInputRef.current?.focus()
    }

    window.addEventListener('craft:paste-files', handlePasteFiles as unknown as EventListener)
    return () => window.removeEventListener('craft:paste-files', handlePasteFiles as unknown as EventListener)
  }, [disabled, sessionId, isFocusedPanel, richInputRef, refuseOversizedAttachment])

  // Build active commands list for slash command menu
  const activeCommands = React.useMemo(() => {
    const active: SlashCommandId[] = []
    // Add the currently active permission mode
    if (permissionMode) active.push(permissionMode)
    return active
  }, [permissionMode])

  // Handle slash command selection (mode/feature commands)
  const handleSlashCommand = React.useCallback((commandId: SlashCommandId) => {
    if (isPermissionMode(commandId)) onPermissionModeChange?.(commandId)
    else if (commandId === 'compact' && !isProcessing) onSubmit('/compact', undefined)
  }, [onPermissionModeChange, isProcessing, onSubmit])

  // Handle folder selection from slash command menu
  const handleSlashFolderSelect = React.useCallback((path: string) => {
    if (onWorkingDirectoryChange) {
      setRecentFolders(addRecentWorkingDir(path, workspaceId))
      onWorkingDirectoryChange(path)
    }
  }, [onWorkingDirectoryChange, workspaceId])

  // Get recent folders and home directory for slash menu and mention menu
  const [recentFolders, setRecentFolders] = React.useState<string[]>([])
  const [homeDir, setHomeDir] = React.useState<string>('')

  React.useEffect(() => {
    setRecentFolders(getRecentWorkingDirs(workspaceId))
    window.electronAPI?.getHomeDir?.().then((dir: string) => {
      if (dir) setHomeDir(dir)
    })
  }, [workspaceId])

  // Inline slash command hook (modes, features, and folders); Guarded only while it is offered
  const availableModes = useAvailablePermissionModes(permissionMode)

  // Coding mode is about a folder's code: turning it on asks for one (the chip's popover offers a new
  // worktree or an existing folder; "existing" opens this picker)
  const codingFolderPicker = useDirectoryPicker(React.useCallback((path: string) => {
    onWorkingDirectoryChange?.(path)
  }, [onWorkingDirectoryChange]))
  const { pickDirectory: pickCodingFolder } = codingFolderPicker
  const hasWorkingFolder = !!workingDirectory && workingDirectory !== sessionFolderPath
  const handleCodingModeToggle = React.useCallback((enabled: boolean) => {
    onCodingModeChange?.(enabled)
  }, [onCodingModeChange])
  const codingWorkspaceSetup = React.useMemo(() => (onWorkingDirectoryChange ? {
    workspaceId,
    sessionId,
    currentFolder: hasWorkingFolder ? workingDirectory : undefined,
    onUseExistingFolder: pickCodingFolder,
    onWorktreeCreated: onWorkingDirectoryChange,
  } : undefined), [onWorkingDirectoryChange, workspaceId, sessionId, hasWorkingFolder, workingDirectory, pickCodingFolder])
  const inlineSlash = useInlineSlashCommand({
    inputRef: richInputRef,
    modes: availableModes,
    onSelectCommand: handleSlashCommand,
    onSelectFolder: handleSlashFolderSelect,
    activeCommands,
    recentFolders,
    homeDir,
  })

  // Handle mention selection (sources, skills, files)
  const handleMentionSelect = React.useCallback((item: MentionItem) => {
    // For sources: enable the source immediately
    if (item.type === 'source' && item.source && onSourcesChange) {
      const slug = item.source.config.slug
      if (!optimisticSourceSlugs.includes(slug)) {
        const newSlugs = [...optimisticSourceSlugs, slug]
        setOptimisticSourceSlugs(newSlugs)
        onSourcesChange(newSlugs)
      }
    }

    // Files via @ mention in text are sufficient context for the agent.
    // Skills also don't need special handling beyond text insertion.
  }, [optimisticSourceSlugs, onSourcesChange])

  // Inline mention hook (for skills, sources, and files)
  const inlineMention = useInlineMention({
    inputRef: richInputRef,
    skills,
    sources,
    basePath: workingDirectory,
    onSelect: handleMentionSelect,
    // Use workspace slug (not UUID) for SDK skill qualification
    workspaceId: workspaceSlug,
  })

  // Inline label menu hook (for #labels)
  const handleLabelSelect = React.useCallback((labelId: string) => {
    onLabelAdd?.(labelId)
  }, [onLabelAdd])

  const inlineLabel = useInlineLabelMenu({
    inputRef: richInputRef,
    labels,
    sessionLabels,
    onSelect: handleLabelSelect,
    sessionStatuses,
    activeStateId: currentSessionStatus,
  })

  // "Add New Label" handler: cleans up the #trigger text and opens a controlled
  // EditPopover so the user can describe the label before the agent creates it.
  const [addLabelPopoverOpen, setAddLabelPopoverOpen] = React.useState(false)
  const [addLabelPrefill, setAddLabelPrefill] = React.useState('')
  const handleAddLabel = React.useCallback((prefill: string) => {
    if (!workspaceRootPath) return

    // Remove the #trigger text from input
    const cleaned = inlineLabel.handleSelect('')
    setInput(cleaned)
    syncToParent(cleaned)
    inlineLabel.close()

    // Store the prefill text (e.g., "Test" from "#Test") to pre-fill the popover
    // Format: "Add new label {prefill}" so user can just press enter or modify
    setAddLabelPrefill(prefill ? t('labels.addNewLabel', { prefill }) : '')

    // Open the EditPopover for label creation
    setAddLabelPopoverOpen(true)
  }, [workspaceRootPath, inlineLabel, syncToParent, t])

  // Memoize the add-label config so the EditPopover doesn't recreate on every render
  const addLabelEditConfig = React.useMemo(() => {
    if (!workspaceRootPath) return null
    return getEditConfig('add-label', workspaceRootPath)
  }, [workspaceRootPath])

  // Report height changes to parent (for external animation sync)
  React.useLayoutEffect(() => {
    if (!onHeightChange || !containerRef.current) return

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        onHeightChange(entry.contentRect.height)
      }
    })

    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [onHeightChange])

  // In compact mode, immediately report collapsed height when the input is
  // collapsed during processing. This ensures smooth animation timing.
  // When the user expands (or processing ends), the ResizeObserver takes
  // over and reports the actual rendered height.
  React.useEffect(() => {
    if (!onHeightChange) return
    if (isCollapsedInCompact) {
      // Collapsed state - only bottom bar visible (~44px)
      onHeightChange(44)
    }
  }, [isCollapsedInCompact, onHeightChange])

  // Check if running in Electron environment (has electronAPI)
  const hasElectronAPI = typeof window !== 'undefined' && !!window.electronAPI

  // Shared helper: read a File, add as attachment, decrement loading count
  const processFileAttachment = async (file: File, overrideName?: string) => {
    if (refuseOversizedAttachment({ name: overrideName || file.name, size: file.size, type: file.type.startsWith('image/') ? 'image' : undefined })) {
      setLoadingCount(prev => prev - 1)
      return
    }
    try {
      const attachment = await readFileAsAttachment(file, overrideName)
      if (attachment) {
        setAttachments(prev => [...prev, attachment])
      }
    } catch (error) {
      console.error('[FreeFormInput] Failed to read file:', error)
    }
    setLoadingCount(prev => prev - 1)
  }

  // File attachment handlers
  const handleAttachClick = () => {
    if (disabled) return
    fileInputRef.current?.click()
  }

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    const fileList = Array.from(files)
    setLoadingCount(prev => prev + fileList.length)

    for (const file of fileList) {
      await processFileAttachment(file)
    }

    // Reset input so re-selecting the same file triggers onChange again
    e.target.value = ''
  }

  const handleRemoveAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index))
  }

  // Drag and drop handlers
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

  // Helper to read a File using FileReader API
  const readFileAsAttachment = async (file: File, overrideName?: string): Promise<FileAttachment | null> => {
    // Capture the absolute OS path at attach time. Works for <input type="file"> and
    // OS drag-drop; returns null for clipboard paste and web-drag (no disk origin).
    // When null, the draft layer falls back to persisting content inline (Track C).
    const realPath = hasElectronAPI ? window.electronAPI.getFilePath?.(file) ?? null : null

    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = async () => {
        const result = reader.result as ArrayBuffer
        // Chunked base64 encoding — btoa + reduce fails on large files (>1MB)
        // due to O(n²) string concatenation and browser string-length limits
        const bytes = new Uint8Array(result)
        let binary = ''
        const chunkSize = 8192
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, bytes.length)))
        }
        const base64 = btoa(binary)

        let type: FileAttachment['type'] = 'unknown'
        const fileName = overrideName || file.name
        if (file.type.startsWith('image/')) type = 'image'
        else if (file.type === 'application/pdf') type = 'pdf'
        else if (file.type.includes('text') || fileName.match(/\.(txt|md|json|js|ts|tsx|py|css|html)$/i)) type = 'text'
        else if (file.type.includes('officedocument') || fileName.match(/\.(docx?|xlsx?|pptx?)$/i)) type = 'office'

        const mimeType = file.type || 'application/octet-stream'

        // For text files, decode the ArrayBuffer as UTF-8 text
        let text: string | undefined
        if (type === 'text') {
          text = new TextDecoder('utf-8').decode(new Uint8Array(result))
        }

        let thumbnailBase64: string | undefined
        if (hasElectronAPI) {
          try {
            const thumb = await window.electronAPI.generateThumbnail(base64, mimeType)
            if (thumb) thumbnailBase64 = thumb
          } catch {
            // Thumbnail generation is optional, continue without it
          }
        }

        resolve({
          type,
          path: realPath ?? fileName,
          name: fileName,
          mimeType,
          base64,
          text,
          size: file.size,
          thumbnailBase64,
        })
      }
      reader.onerror = () => resolve(null)
      reader.readAsArrayBuffer(file)
    })
  }

  // Clipboard paste handler for files/images
  const handlePaste = async (e: React.ClipboardEvent) => {
    if (disabled) return

    const clipboardItems = e.clipboardData?.files
    if (!clipboardItems || clipboardItems.length === 0) return

    // We have files to process - prevent default text paste behavior
    e.preventDefault()

    const files = Array.from(clipboardItems)
    setLoadingCount(prev => prev + files.length)

    // Pre-assign sequential names using ref to avoid race conditions
    let nextImageNum = getNextPastedNumber('image', attachmentsRef.current)
    const fileNames: string[] = files.map(file => {
      if (!file.name || file.name === 'image.png' || file.name === 'image.jpg' || file.name === 'blob') {
        const ext = file.type.split('/')[1] || 'png'
        return `pasted-image-${nextImageNum++}.${ext}`
      }
      return file.name
    })

    for (let i = 0; i < files.length; i++) {
      await processFileAttachment(files[i], fileNames[i])
    }
  }

  // Text pastes go in as usual; a console snippet also gets a "Run in background" offer
  const handleTextPaste = React.useCallback((text: string) => {
    const command = consoleSnippetCommand(text)
    if (command) onConsoleSnippetPaste?.({ command, text })
  }, [onConsoleSnippetPaste])

  // Handle long text paste - convert to file attachment
  const handleLongTextPaste = React.useCallback((text: string) => {
    const nextNum = getNextPastedNumber('text', attachmentsRef.current)
    const fileName = `pasted-text-${nextNum}.txt`
    const attachment: FileAttachment = {
      type: 'text',
      path: fileName,
      name: fileName,
      mimeType: 'text/plain',
      text: text,
      size: new Blob([text]).size,
    }
    if (refuseOversizedAttachment(attachment)) return
    setAttachments(prev => [...prev, attachment])
    // Focus input after adding attachment
    richInputRef.current?.focus()
  }, [refuseOversizedAttachment])

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current = 0
    setIsDraggingOver(false)
    if (disabled) return

    const files = Array.from(e.dataTransfer.files)
    setLoadingCount(files.length)

    for (const file of files) {
      await processFileAttachment(file)
    }
  }

  // Submit message - backend handles queueing and interruption
  const submitMessage = React.useCallback(() => {
    const hasContent = input.trim() || attachments.length > 0 || followUpItems.length > 0
    if (!hasContent || disabled) return false

    // Tutorial may disable sending to guide user through specific steps
    if (disableSend) return false

    // Too much to send in one message: say so and keep the draft (the send would drop the connection)
    const sizeProblem = checkAttachmentSizes(attachments, maxMessageBytesRef.current)
    if (sizeProblem) {
      showAttachmentSizeProblem(sizeProblem)
      return false
    }

    // Parse all @mentions (skills, sources, folders)
    const skillSlugs = skills.map(s => s.slug)
    const sourceSlugs = sources.map(s => s.config.slug)
    const mentions = parseMentions(input, skillSlugs, sourceSlugs)

    // Enable any mentioned sources that aren't already enabled
    if (mentions.sources.length > 0 && onSourcesChange) {
      const newSlugs = [...new Set([...optimisticSourceSlugs, ...mentions.sources])]
      if (newSlugs.length > optimisticSourceSlugs.length) {
        setOptimisticSourceSlugs(newSlugs)
        onSourcesChange(newSlugs)
      }
    }

    const attachmentSnapshot = attachments

    onSubmit(
      input.trim(),
      attachmentSnapshot.length > 0 ? attachmentSnapshot : undefined,
      mentions.skills.length > 0 ? mentions.skills : undefined
    )
    setInput('')
    setAttachments([])
    // Clear draft immediately (cancel any pending debounced sync)
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current)
    onInputChange?.('')
    onAttachmentsChange?.([])
    prevInputValueRef.current = ''

    // Restore focus after state updates
    requestAnimationFrame(() => {
      richInputRef.current?.focus()
    })

    return true
  }, [input, attachments, followUpItems, disabled, disableSend, onInputChange, onAttachmentsChange, onSubmit, skills, sources, optimisticSourceSlugs, onSourcesChange, onWorkingDirectoryChange, homeDir, showAttachmentSizeProblem])

  // Listen for craft:submit-input events (simulate pressing the Send button)
  React.useEffect(() => {
    const handleSubmitInput = (e: CustomEvent<{ sessionId?: string }>) => {
      const targetSessionId = e.detail?.sessionId
      if (!shouldHandleScopedInputEvent({ sessionId, isFocusedPanel, targetSessionId })) return
      submitMessage()
    }

    window.addEventListener('craft:submit-input', handleSubmitInput as EventListener)
    return () => window.removeEventListener('craft:submit-input', handleSubmitInput as EventListener)
  }, [sessionId, isFocusedPanel, submitMessage])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    submitMessage()
  }

  const handleStop = (silent = false) => {
    onStop?.(silent)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // During IME composition, ESC should cancel composition, not trigger app/menu ESC behavior.
    if (e.key === 'Escape' && e.nativeEvent.isComposing) {
      return
    }

    // Don't submit when mention menu is open AND has visible content
    if (inlineMention.isOpen) {
      // Only intercept navigation/selection keys if menu actually shows items or is loading
      const hasVisibleContent = inlineMention.sections.some(s => s.items.length > 0) || inlineMention.isSearching
      if (hasVisibleContent && (e.key === 'Enter' || e.key === 'Tab' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        // These keys are handled by the InlineMentionMenu component
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        inlineMention.close()
        return
      }
    }

    // Don't submit when slash command menu is open - let it handle the Enter key
    if (inlineSlash.isOpen) {
      if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        // These keys are handled by the InlineSlashCommand component
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        inlineSlash.close()
        return
      }
    }

    // Don't submit when label menu is open - let it handle navigation keys
    if (inlineLabel.isOpen) {
      if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        inlineLabel.close()
        return
      }
    }

    // Plain Arrow Up with no draft content cancels the running turn and recalls
    // its prompt through ChatDisplay.handleStop. The pure guard deliberately
    // treats whitespace, attachments, loading files, and follow-up chips as draft
    // content so normal editing is never hijacked.
    if (shouldRecallPromptOnArrowUp({
      key: e.key,
      shiftKey: e.shiftKey,
      metaKey: e.metaKey,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      isComposing: e.nativeEvent.isComposing,
      isProcessing,
      input,
      attachmentCount: attachments.length,
      loadingAttachmentCount: loadingCount,
      followUpItemCount: followUpItems.length,
      inlineMenuOpen: inlineMention.isOpen || inlineSlash.isOpen || inlineLabel.isOpen,
      disabled,
      disableSend,
    })) {
      e.preventDefault()
      handleStop()
      return
    }

    // Skip submission during IME composition - user is confirming composed characters, not sending
    // Handle send key based on user preference:
    // - 'enter': Enter sends (Shift+Enter for newline)
    // - 'cmd-enter': ⌘/Ctrl+Enter sends (Enter for newline)
    if (sendMessageKey === 'enter') {
      // Enter sends, Shift+Enter adds newline
      if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.nativeEvent.isComposing) {
        e.preventDefault()
        submitMessage()
      }
      // Also allow Cmd/Ctrl+Enter to send (power user shortcut)
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
        e.preventDefault()
        submitMessage()
      }
    } else {
      // cmd-enter mode: ⌘/Ctrl+Enter sends, plain Enter adds newline
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
        e.preventDefault()
        submitMessage()
      }
      // Plain Enter is allowed to pass through (adds newline)
    }
    if (e.key === 'Escape') {
      // Skip blur if a popover/overlay is open — let the overlay handle ESC instead.
      // This prevents the input from consuming ESC when focus gets pulled back here
      // while a popover is still visible (portal DOM isolation means the event won't
      // reach the popover's DismissableLayer otherwise).
      if (!hasOpenOverlay()) {
        richInputRef.current?.blur()
      }
    }
  }

  // Handle input changes from RichTextInput
  const handleInputChange = React.useCallback((value: string) => {
    const nextValue = coerceInputText(value)
    // Get previous input value before updating state
    const prevValue = inputRef.current

    setInput(nextValue)
    syncToParent(nextValue) // Debounced sync to parent for draft persistence

    // Sync source selection when mentions are removed from input
    if (onSourcesChange) {
      const sourceSlugs = sources.map(s => s.config.slug)

      // Parse mentions from previous and current input
      const prevMentions = parseMentions(prevValue, [], sourceSlugs)
      const currMentions = parseMentions(nextValue, [], sourceSlugs)

      // Remove sources that were mentioned before but not anymore
      const removedSources = prevMentions.sources.filter(slug => !currMentions.sources.includes(slug))
      if (removedSources.length > 0) {
        const newSlugs = optimisticSourceSlugs.filter(slug => !removedSources.includes(slug))
        setOptimisticSourceSlugs(newSlugs)
        onSourcesChange(newSlugs)
      }
    }
  }, [syncToParent, sources, optimisticSourceSlugs, onSourcesChange])

  // Handle input with cursor position (for menu detection)
  const handleRichInput = React.useCallback((value: string, cursorPosition: number) => {
    const nextValue = coerceInputText(value)

    // Update inline slash command state
    inlineSlash.handleInputChange(nextValue, cursorPosition)

    // Update inline mention state (for @mentions - skills, sources, folders)
    inlineMention.handleInputChange(nextValue, cursorPosition)

    // Update inline label state (for #labels)
    inlineLabel.handleInputChange(nextValue, cursorPosition)

    // Auto-capitalize first letter (but not for slash commands, @mentions, or #labels)
    // Only if autoCapitalisation setting is enabled
    let newValue = nextValue
    if (autoCapitalisation && nextValue.length > 0 && nextValue.charAt(0) !== '/' && nextValue.charAt(0) !== '@' && nextValue.charAt(0) !== '#') {
      const capitalizedFirst = nextValue.charAt(0).toUpperCase()
      if (capitalizedFirst !== nextValue.charAt(0)) {
        newValue = capitalizedFirst + nextValue.slice(1)
        // Set cursor position BEFORE state update so it's used when useEffect syncs the value
        richInputRef.current?.setSelectionRange(cursorPosition, cursorPosition)
        setInput(newValue)
        syncToParent(newValue)
        return
      }
    }

    // Apply smart typography (-> to →, etc.)
    const typography = applySmartTypography(nextValue, cursorPosition)
    if (typography.replaced) {
      newValue = typography.text
      // Set cursor position BEFORE state update so it's used when useEffect syncs the value
      richInputRef.current?.setSelectionRange(typography.cursor, typography.cursor)
      setInput(newValue)
      syncToParent(newValue)
    }
  }, [inlineSlash, inlineMention, inlineLabel, syncToParent, autoCapitalisation])

  // Handle inline slash command selection (removes the /command text)
  const handleInlineSlashCommandSelect = React.useCallback((commandId: SlashCommandId) => {
    const newValue = inlineSlash.handleSelectCommand(commandId)
    setInput(newValue)
    syncToParent(newValue)
    richInputRef.current?.focus()
  }, [inlineSlash, syncToParent])

  // Handle inline slash folder selection (inserts a directory badge)
  const handleInlineSlashFolderSelect = React.useCallback((path: string) => {
    const newValue = inlineSlash.handleSelectFolder(path)
    setInput(newValue)
    syncToParent(newValue)
    richInputRef.current?.focus()
  }, [inlineSlash, syncToParent])

  // Handle inline mention selection (inserts appropriate mention text)
  const handleInlineMentionSelect = React.useCallback((item: MentionItem) => {
    const { value: newValue, cursorPosition } = inlineMention.handleSelect(item)
    setInput(newValue)
    syncToParent(newValue)
    // Focus input and restore cursor position after badge renders
    setTimeout(() => {
      richInputRef.current?.focus()
      richInputRef.current?.setSelectionRange(cursorPosition, cursorPosition)
    }, 0)
  }, [inlineMention, syncToParent])

  // Handle inline label selection (removes the #label text from input)
  const handleInlineLabelSelect = React.useCallback((labelId: string) => {
    const newValue = inlineLabel.handleSelect(labelId)
    setInput(newValue)
    syncToParent(newValue)
    richInputRef.current?.focus()
  }, [inlineLabel, syncToParent])

  // Handle inline state selection from # menu (removes #text, changes session state)
  const handleInlineStateSelect = React.useCallback((stateId: string) => {
    const newValue = inlineLabel.handleSelect('')
    setInput(newValue)
    syncToParent(newValue)
    if (sessionId) {
      onSessionStatusChange?.(sessionId, stateId)
    }
    richInputRef.current?.focus()
  }, [inlineLabel, syncToParent, sessionId, onSessionStatusChange])

  const followUpLayoutKey = React.useMemo(
    () => followUpItems.map(item => [
      item.id,
      item.index ?? '',
      item.noteLabel,
      item.selectedText,
      item.color ?? '',
    ].join('::')).join('|'),
    [followUpItems]
  )
  const previousFollowUpLayoutKeyRef = React.useRef<string | null>(null)
  const [animateFollowUpLayout, setAnimateFollowUpLayout] = React.useState(false)

  React.useEffect(() => {
    const previous = previousFollowUpLayoutKeyRef.current
    previousFollowUpLayoutKeyRef.current = followUpLayoutKey

    if (previous == null || previous === followUpLayoutKey) return

    setAnimateFollowUpLayout(true)
    const timer = window.setTimeout(() => {
      setAnimateFollowUpLayout(false)
    }, 220)

    return () => window.clearTimeout(timer)
  }, [followUpLayoutKey])

  const hasContent = input.trim() || attachments.length > 0 || followUpItems.length > 0

  // Pre-flight image-support check: warn when staged images would be silently
  // stripped by Pi SDK because the active custom-endpoint model is text-only.
  // Gate on pi_compat — built-in catalogs (anthropic/pi) are owned by the SDK
  // and we can't repair them from the UI here.
  const hasStagedImages = attachments.some(a => a.type === 'image' || a.mimeType?.startsWith('image/'))
  const showVisionWarning =
    hasStagedImages
    && !!effectiveConnectionDetails
    && isCompatProvider(effectiveConnectionDetails.providerType)
    && !modelSupportsImages(effectiveConnectionDetails, currentModel)
  const contextDisplay = getContextDisplay(contextStatus, getModelContextWindow(currentModel))
  const contextLabels = getContextDisplayLabels(contextDisplay, t)

  React.useLayoutEffect(() => {
    if (contentScrollRef.current) scrollFocusedCaretIntoView(contentScrollRef.current)
  }, [composerMaxHeight, attachments, followUpItems, showVisionWarning, isCollapsedInCompact])

  const handleToggleSourceSlug = (slug: string) => {
    const isEnabled = optimisticSourceSlugs.includes(slug)
    const newSlugs = isEnabled
      ? optimisticSourceSlugs.filter(currentSlug => currentSlug !== slug)
      : [...optimisticSourceSlugs, slug]
    setOptimisticSourceSlugs(newSlugs)
    onSourcesChange?.(newSlugs)
  }

  return (
    <form onSubmit={handleSubmit}>
      <div
        ref={containerRef}
        className={cn(
          // Own the panel query boundary: standalone/playground composers must collapse chips
          // at the input's width too, not depend on an AppShell ancestor being present.
          '@container/panel flex flex-col min-h-0 overflow-hidden transition-colors',
          // Container styling - only when not wrapped by InputContainer
          !unstyled && 'rounded-xl bg-raised shadow-elev-2',
          // Drop target: inset focus ring + accent tint (never clipped by the card)
          isDraggingOver && 'ring-2 ring-inset ring-focus bg-accent-tint'
        )}
        style={{ maxHeight: composerMaxHeight }}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* Inline Slash Command Autocomplete */}
        <InlineSlashCommand
          open={inlineSlash.isOpen}
          onOpenChange={(open) => !open && inlineSlash.close()}
          sections={inlineSlash.sections}
          activeCommands={activeCommands}
          onSelectCommand={handleInlineSlashCommandSelect}
          onSelectFolder={handleInlineSlashFolderSelect}
          filter={inlineSlash.filter}
          position={inlineSlash.position}
        />

        {/* Inline Mention Autocomplete (skills, sources, files) */}
        <InlineMentionMenu
          open={inlineMention.isOpen}
          onOpenChange={(open) => !open && inlineMention.close()}
          sections={inlineMention.sections}
          onSelect={handleInlineMentionSelect}
          filter={inlineMention.filter}
          position={inlineMention.position}
          workspaceId={workspaceId}
          maxWidth={280}
          isSearching={inlineMention.isSearching}
        />

        {/* Inline Label & State Autocomplete (#labels / #states) */}
        <InlineLabelMenu
          open={inlineLabel.isOpen}
          onOpenChange={(open) => !open && inlineLabel.close()}
          items={inlineLabel.items}
          onSelect={handleInlineLabelSelect}
          onAddLabel={handleAddLabel}
          filter={inlineLabel.filter}
          position={inlineLabel.position}
          states={inlineLabel.states}
          activeStateId={inlineLabel.activeStateId}
          onSelectState={handleInlineStateSelect}
        />

        {/* Controlled EditPopover for "Add New Label" — opens when user selects
            the option from the # menu with no matches.
            Spread the full config so optional fields like `inlineExecution`,
            `displayLabel`, and `displayLabelKey` reach the popover. The previous
            cherry-pick dropped `inlineExecution: true`, which made the popover
            fall back to the same-window deep-link path; that worked inside
            Electron but launched the desktop app from the WebUI via `craftagents://`.
            Match the AppShell pattern (which already uses spread). */}
        {addLabelEditConfig && (
          <EditPopover
            trigger={<span className="absolute top-0 left-0 w-0 h-0 overflow-hidden" />}
            open={addLabelPopoverOpen}
            onOpenChange={setAddLabelPopoverOpen}
            {...addLabelEditConfig}
            defaultValue={addLabelPrefill}
            secondaryAction={workspaceRootPath ? {
              label: 'Edit File',
              filePath: `${workspaceRootPath}/labels/config.json`,
            } : undefined}
            side="top"
            align="start"
          />
        )}

        {/* Text and ancillary content share one scroll region. Keeping actions
            outside it reserves their measured flex height, even with many chips. */}
        <div ref={contentScrollRef} className="min-h-0 overflow-y-auto overscroll-contain" data-composer-content>
        {/* Pre-flight image-support warning — only for pi_compat connections
            where the renderer can both detect text-only models and offer to
            flip the per-model supportsImages override on the spot. */}
        {showVisionWarning && effectiveConnectionDetails && (
          <ImageSupportWarningBanner
            modelName={currentModelDisplayName}
            onEnable={() => handleToggleModelVision(effectiveConnectionDetails.slug, currentModel, true)}
          />
        )}

        {/* Attachment Preview */}
        <AttachmentPreview
          attachments={attachments}
          onRemove={handleRemoveAttachment}
          disabled={disabled}
          loadingCount={loadingCount}
        />

        {/* Follow-up context chips */}
        <FollowUpChips
          items={followUpItems}
          animateLayout={animateFollowUpLayout}
          onItemClick={onFollowUpClick}
          onIndexClick={onFollowUpIndexClick}
        />

        {/* Rich Text Input with inline mention badges */}
        {/* In compact mode, hide input while the agent is processing — until the
            user clicks / hovers the collapsed bar to expand it back. */}
        {!isCollapsedInCompact && (
        <RichTextInput
          ref={richInputRef}
          value={input}
          onChange={handleInputChange}
          onInput={handleRichInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onLongTextPaste={handleLongTextPaste}
          onTextPaste={handleTextPaste}
          onFocus={() => { setIsFocused(true); onFocusChange?.(true) }}
          onBlur={() => {
            // Save caret position before losing focus (for restoration via craft:focus-input)
            lastCaretPositionRef.current = richInputRef.current?.selectionStart ?? null
            setIsFocused(false)
            onFocusChange?.(false)
          }}
          placeholder={effectivePlaceholder}
          disabled={disabled}
          skills={skills}
          sources={sources}
          workspaceId={workspaceSlug}
          // Copy type (15/24; 16/26 in compact so iOS never zooms), placeholder in tertiary.
          // Narrow panels reserve two lines so a wrapped rotating tip is never clipped.
          className={cn(
            'px-3.5 pt-3.5 pb-3.5',
            compactMode ? 'text-copy-lg min-h-[80px]' : 'text-copy @max-panel-medium/panel:min-h-[76px]',
          )}
          style={{ lineHeight: compactMode ? 'var(--lh-copy-lg)' : 'var(--lh-copy)' }}
          data-tutorial="chat-input"
          spellCheck={spellCheck}
        />
        )}

        </div>

        {/* Bottom Row: Controls - never shrinks into the scrolling draft region. */}
        <div className="relative shrink-0" data-composer-actions>
          {/* Status slot overlay - escape interrupt (highest priority), browser status, etc. */}
          <ToolbarStatusSlot
            showEscapeOverlay={isProcessing && showEscapeOverlay}
            sessionId={sessionId}
          />

          {/* Toolbar (mockup `.cx-bar`): attach · sources · folder · spacer · mode · model · context · send */}
          {/* The first icon's glyph lines up with the draft text (card-pad, 14px): 28px desktop
              buttons pad 6px, 36px compact ones 10px, so the row insets 8px / 4px. */}
          <div className={cn("flex items-center gap-1 pb-1.5", compactMode ? "px-1" : "px-2", isCollapsedInCompact && "pt-1.5")}>
          {/* Hidden file input for attach button (shared by compact and desktop) */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileInputChange}
          />

          {/* Left: attach, sources, working folder. Compact, and desktop panels under 32rem, show
              the chips icon-only (their names stay in tooltips/aria-labels) so the model keeps its
              name. Desktop keeps the three icons (96px) while the row still leaves 11rem for mode ·
              model · context · Send; in a narrower row that floor gives way so Send is never pushed
              out. overflow-hidden is safe — popovers/drawers portal. */}
          <div className={cn(
            "flex items-center gap-1",
            compactMode
              ? "shrink-0 [&_[data-badge-label]]:hidden"
              : "min-w-[clamp(0px,calc(100%-11rem),6rem)] shrink overflow-hidden @max-[32rem]/panel:[&_[data-badge-label]]:hidden"
          )}>
          <IconButton
            aria-label={attachments.length > 0
              ? t("chat.filesCount", { count: attachments.length })
              : t("chat.attachFiles")
            }
            tooltip={t("chat.attachFilesTooltip")}
            icon={<Paperclip />}
            onClick={handleAttachClick}
            disabled={disabled}
            className="input-toolbar-btn"
          />

          {/* Source selector chip - only show if onSourcesChange is provided */}
          {onSourcesChange && (
            <ComposerSourcesChip
              compact={compactMode}
              sources={sources}
              selectedSlugs={optimisticSourceSlugs}
              onToggleSlug={handleToggleSourceSlug}
              open={sourceDropdownOpen}
              setOpen={setSourceDropdownOpen}
              isEmptySession={isEmptySession}
              disabled={disabled}
              buttonRef={sourceButtonRef}
            />
          )}

          {/* Working directory chip */}
          {onWorkingDirectoryChange && (compactMode ? (
            <CompactWorkingDirectorySelector
              workingDirectory={workingDirectory}
              onWorkingDirectoryChange={onWorkingDirectoryChange}
              sessionFolderPath={sessionFolderPath}
              isEmptySession={false}
              workspaceId={workspaceId}
            />
          ) : (
            <WorkingDirectoryBadge
              workingDirectory={workingDirectory}
              onWorkingDirectoryChange={onWorkingDirectoryChange}
              sessionFolderPath={sessionFolderPath}
              isEmptySession={isEmptySession}
              workspaceId={workspaceId}
            />
          ))}

          {/* Coding mode chip — next to the folder: the mode is about the folder's code */}
          {onCodingModeChange && onContinueWithCodingMode && (
            <ComposerCodingChip
              enabled={codingMode}
              locked={!isEmptySession}
              compact={compactMode}
              disabled={disabled}
              onToggle={handleCodingModeToggle}
              onContinueInNewSession={onContinueWithCodingMode}
              workspaceSetup={codingWorkspaceSetup}
            />
          )}

          {/* Crafty chip — only in the session Crafty sends to (macOS) */}
          <CraftyComposerChip sessionId={sessionId} workspaceId={workspaceId} />
          </div>

          {/* Spacer — doubles as a tap / hover target while the input is
              collapsed during processing in compact mode, so the user can
              type a follow-up without waiting for the agent to finish. */}
          {isCollapsedInCompact ? (
            <button
              type="button"
              onClick={onRequestExpand}
              onMouseEnter={onRequestExpand}
              aria-label={t('chat.tapToType')}
              className="motion-press mx-1 flex h-control min-w-0 flex-1 cursor-pointer items-center justify-center rounded-md text-tertiary hover:bg-fill-hover hover:text-secondary"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
          ) : (
            <div className="flex-1" />
          )}

          {/* Right: mode · model absorb the squeeze — the model label truncates, and in narrow
              panels the mode chip folds to its icon. Context and Send sit outside this group and
              never shrink, so Send stays inside the card (craft-agents-oss#798). The 4px inset
              keeps focus rings visible inside the clipping group. */}
          <div className="-m-1 flex min-w-0 shrink items-center gap-1 overflow-hidden p-1">
          {compactMode
            ? onPermissionModeChange && (
              <CompactPermissionModeSelector
                permissionMode={permissionMode}
                onPermissionModeChange={onPermissionModeChange}
              />
            )
            : showPermissionModeChip && (
              <ComposerModeChip
                permissionMode={permissionMode}
                onPermissionModeChange={onPermissionModeChange}
                sessionId={sessionId}
              />
            )}

          {/* Model/Connection selector — drawer in compact (when enabled), dropdown on desktop */}
          {compactMode ? (
            enableCompactModelPicker && (
              <CompactModelSelector
                currentModel={currentModel}
                currentConnection={currentConnection}
                onModelChange={onModelChange}
                onConnectionChange={onConnectionChange}
                thinkingLevel={thinkingLevel}
                onThinkingLevelChange={onThinkingLevelChange}
                isEmptySession={isEmptySession}
                connectionUnavailable={connectionUnavailable}
                disableAccountSwitch={isProcessing}
                contextStatus={contextStatus}
              />
            )
          ) : (
            <ComposerModelMenu
              open={modelDropdownOpen}
              onOpenChange={setModelDropdownOpen}
              connectionUnavailable={connectionUnavailable}
              llmConnections={llmConnections}
              effectiveConnection={effectiveConnection}
              effectiveConnectionDetails={effectiveConnectionDetails}
              currentConnectionDetails={currentConnectionDetails}
              accountSwitchTargets={accountSwitchTargets}
              disableAccountSwitch={isProcessing}
              connectionsByProvider={connectionsByProvider}
              connectionDefaultModel={connectionDefaultModel}
              pickerMode={pickerMode}
              currentModel={currentModel}
              currentModelDisplayName={currentModelDisplayName}
              availableModels={availableModels}
              isEmptySession={isEmptySession}
              onModelChange={onModelChange}
              onConnectionChange={onConnectionChange}
              onToggleVision={handleToggleModelVision}
              thinkingLevel={thinkingLevel}
              thinkingDisabled={thinkingDisabled}
              onThinkingLevelChange={onThinkingLevelChange}
              contextDisplay={contextDisplay}
              contextLabels={contextLabels}
              isCompacting={contextStatus?.isCompacting}
            />
          )}

          </div>

          {/* Context usage meter. Percent text is truthful and may exceed 100%; action requires explicit canCompact. */}
          <ContextUsageChip
            display={contextDisplay}
            labels={contextLabels}
            isProcessing={isProcessing}
            showMeter={!compactMode}
            onCompact={() => onSubmit('/compact', [])}
          />

          {/* Send/Stop Button - Always show stop when processing */}
          <SendButton
            isProcessing={isProcessing}
            disabled={!hasContent || disabled || disableSend}
            onStop={() => handleStop(false)}
          />
          </div>
        </div>
      </div>
      {/* Remote servers: folder browser for the coding-mode folder prompt (local uses the native dialog) */}
      <ServerDirectoryBrowser
        open={codingFolderPicker.showServerBrowser}
        mode={codingFolderPicker.serverBrowserMode}
        onSelect={codingFolderPicker.confirmServerBrowser}
        onCancel={codingFolderPicker.cancelServerBrowser}
      />
    </form>
  )
}

/**
 * WorkingDirectoryBadge - chat-input trigger for the shared WorkingDirectorySelector.
 *
 * Renders the context-badge trigger; the picker popover + folder state machine
 * live in {@link WorkingDirectorySelector} so the Tasks editor reuses the same
 * picker (and can supply its own trigger).
 */
function WorkingDirectoryBadge({
  workingDirectory,
  onWorkingDirectoryChange,
  sessionFolderPath,
  isEmptySession = false,
  workspaceId,
}: {
  workingDirectory?: string
  onWorkingDirectoryChange: (path: string) => void
  sessionFolderPath?: string
  isEmptySession?: boolean
  workspaceId?: string
}) {
  const { t } = useTranslation()
  return (
    <WorkingDirectorySelector
      workingDirectory={workingDirectory}
      onWorkingDirectoryChange={onWorkingDirectoryChange}
      sessionFolderPath={sessionFolderPath}
      workspaceId={workspaceId}
      renderTrigger={({ open, hasFolder, folderName, workingDirectory: wd, homeDir, gitBranch }) => (
        <span className="shrink min-w-0 overflow-hidden">
          <FreeFormInputContextBadge
            icon={<Icon_Home className="h-4 w-4" />}
            label={folderName ?? t('chat.workInFolder')}
            isExpanded={isEmptySession}
            hasSelection={hasFolder}
            showChevron={true}
            isOpen={open}
            tooltip={
              hasFolder ? (
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium">{t("chat.workingDirectory")}</span>
                  <span className="text-label-sm text-secondary">{formatPathForDisplay(wd, homeDir)}</span>
                  {gitBranch && <span className="text-label-sm text-secondary">{t("chat.onBranch", { branch: gitBranch })}</span>}
                </span>
              ) : t("chat.chooseWorkingDirectory")
            }
          />
        </span>
      )}
    />
  )
}
