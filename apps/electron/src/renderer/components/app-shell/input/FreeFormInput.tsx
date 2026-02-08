import * as React from 'react'
import * as ReactDOM from 'react-dom'
import { Command as CommandPrimitive } from 'cmdk'
import { toast } from 'sonner'
import {
  Paperclip,
  ArrowUp,
  Square,
  Check,
  DatabaseZap,
  ChevronDown,
  Loader2,
  Lock,
  AlertCircle,
} from 'lucide-react'
import { Icon_Home, Icon_Folder } from '@craft-agent/ui'

import * as storage from '@/lib/local-storage'

import { Button } from '@/components/ui/button'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuPortal,
} from '@/components/ui/dropdown-menu'
import {
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
  StyledDropdownMenuSubTrigger,
  StyledDropdownMenuSubContent,
} from '@/components/ui/styled-dropdown'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { isMac, PATH_SEP, getPathBasename } from '@/lib/platform'
import { applySmartTypography } from '@/lib/smart-typography'
import { AttachmentPreview } from '../AttachmentPreview'
import { ANTHROPIC_MODELS, getModelShortName, getModelContextWindow, isCodexModel } from '@config/models'
import { resolveEffectiveConnectionSlug, isCompatProvider } from '@config/llm-connections'
import { useOptionalAppShellContext } from '@/context/AppShellContext'
import { EditPopover, getEditConfig } from '@/components/ui/EditPopover'
import { SourceAvatar } from '@/components/ui/source-avatar'
import { FreeFormInputContextBadge } from './FreeFormInputContextBadge'
import type { FileAttachment, LoadedSource, LoadedSkill } from '../../../../shared/types'
import type { PermissionMode } from '@craft-agent/shared/agent/modes'
import { PERMISSION_MODE_ORDER } from '@craft-agent/shared/agent/modes'
import { type ThinkingLevel, THINKING_LEVELS, getThinkingLevelName } from '@craft-agent/shared/agent/thinking-levels'
import { useEscapeInterrupt } from '@/context/EscapeInterruptContext'
import { hasOpenOverlay } from '@/lib/overlay-detection'
import { EscapeInterruptOverlay } from './EscapeInterruptOverlay'

/**
 * Format token count for display (e.g., 1500 -> "1.5k", 200000 -> "200k")
 */
function formatTokenCount(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(tokens >= 10000 ? 0 : 1)}k`
  }
  return tokens.toString()
}

/** Platform-specific modifier key for keyboard shortcuts */
const cmdKey = isMac ? '⌘' : 'Ctrl'

/** Default rotating placeholders for onboarding/empty state */
const DEFAULT_PLACEHOLDERS = [
  'What would you like to work on?',
  'Use Shift + Tab to switch between Explore and Execute',
  'Type @ to mention files, folders, or skills',
  'Type # to apply labels to this conversation',
  'Press Shift + Return to add a new line',
  `Press ${cmdKey} + B to toggle the sidebar`,
  `Press ${cmdKey} + . for focus mode`,
]

/** Fisher-Yates shuffle — returns a new array in random order */
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

export interface FreeFormInputProps {
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
  ultrathinkEnabled?: boolean
  onUltrathinkChange?: (enabled: boolean) => void
  permissionMode?: PermissionMode
  onPermissionModeChange?: (mode: PermissionMode) => void
  /** Enabled permission modes for Shift+Tab cycling (min 2 modes) */
  enabledModes?: PermissionMode[]
  // Controlled input value (for persisting across mode switches and conversation changes)
  /** Current input value - if provided, component becomes controlled */
  inputValue?: string
  /** Callback when input value changes */
  onInputChange?: (value: string) => void
  /** When true, removes container styling (shadow, bg, rounded) - used when wrapped by InputContainer */
  unstyled?: boolean
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
  /** Current todo state of the session (for # menu state selection) */
  currentTodoState?: string
  /** Disable send action (for tutorial guidance) */
  disableSend?: boolean
  /** Whether the session is empty (no messages yet) - affects context badge prominence */
  isEmptySession?: boolean
  /** Context status for showing compaction indicator and token usage */
  contextStatus?: {
    /** True when SDK is actively compacting the conversation */
    isCompacting?: boolean
    /** Input tokens used so far in this session */
    inputTokens?: number
    /** Model's context window size in tokens */
    contextWindow?: number
  }
  /** Enable compact mode - hides attach, sources, working directory for popover embedding */
  compactMode?: boolean
  // Connection selection (hierarchical connection → model selector)
  /** Current LLM connection slug (locked after first message) */
  currentConnection?: string
  /** Callback when connection changes (only works when session is empty) */
  onConnectionChange?: (connectionSlug: string) => void
  /** When true, the session's locked connection has been removed */
  connectionUnavailable?: boolean
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
  placeholder = DEFAULT_PLACEHOLDERS,
  disabled = false,
  isProcessing = false,
  onSubmit,
  onStop,
  inputRef: externalInputRef,
  currentModel,
  onModelChange,
  thinkingLevel = 'think',
  onThinkingLevelChange,
  ultrathinkEnabled = false,
  onUltrathinkChange,
  permissionMode = 'ask',
  onPermissionModeChange,
  enabledModes = ['safe', 'ask', 'allow-all'],
  inputValue,
  onInputChange,
  unstyled = false,
  onHeightChange,
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
  currentTodoState,
  disableSend = false,
  isEmptySession = false,
  contextStatus,
  compactMode = false,
  currentConnection,
  onConnectionChange,
  connectionUnavailable = false,
}: FreeFormInputProps) {
  // Read connection default model, connections, and workspace info from context.
  // Uses optional variant so playground (no provider) doesn't crash.
  const appShellCtx = useOptionalAppShellContext()
  const llmConnections = appShellCtx?.llmConnections ?? []
  const workspaceDefaultConnection = appShellCtx?.workspaceDefaultLlmConnection

  // Derive connectionDefaultModel per-session from the effective connection.
  // Only non-null for compat providers (custom endpoints with fixed models).
  // Standard providers (anthropic, openai, bedrock, vertex) → null → normal model picker.
  const connectionDefaultModel = React.useMemo(() => {
    const effectiveSlug = resolveEffectiveConnectionSlug(currentConnection, workspaceDefaultConnection, llmConnections)
    const conn = llmConnections.find(c => c.slug === effectiveSlug)
    if (!conn) return null
    if (!isCompatProvider(conn.providerType)) return null
    // Allow model switching when connection has multiple models
    if (conn.models && conn.models.length > 1) return null
    return conn.defaultModel ?? null
  }, [currentConnection, workspaceDefaultConnection, llmConnections])

  // Compute available models from the effective connection.
  // All connections have models populated by backfillAllConnectionModels().
  const availableModels = React.useMemo(() => {
    // Connection removed — don't fall through to another connection's models
    if (connectionUnavailable) return []

    // Determine effective connection using the canonical fallback chain
    const effectiveSlug = resolveEffectiveConnectionSlug(currentConnection, workspaceDefaultConnection, llmConnections)
    const connection = llmConnections.find(c => c.slug === effectiveSlug)

    if (!connection) {
      return ANTHROPIC_MODELS // Safety net — shouldn't happen
    }

    return connection.models || ANTHROPIC_MODELS
  }, [llmConnections, currentConnection, workspaceDefaultConnection, connectionUnavailable])

  const availableThinkingLevels = THINKING_LEVELS

  // Group connections by provider type for hierarchical dropdown
  // Each provider (Anthropic, OpenAI) can have multiple connections (API Key, Claude Max, etc.)
  const connectionsByProvider = React.useMemo(() => {
    const groups: Record<string, typeof llmConnections> = {
      'Anthropic': [],
      'OpenAI': [],
    }
    for (const conn of llmConnections) {
      const provider = conn.providerType || 'anthropic'
      // Group by SDK: anthropic/anthropic_compat/bedrock/vertex use Anthropic SDK
      if (provider === 'anthropic' || provider === 'anthropic_compat' || provider === 'bedrock' || provider === 'vertex') {
        groups['Anthropic'].push(conn)
      } else if (provider === 'openai' || provider === 'openai_compat') {
        groups['OpenAI'].push(conn)
      }
    }
    // Return only non-empty groups
    return Object.entries(groups).filter(([, conns]) => conns.length > 0)
  }, [llmConnections])

  // Find current connection details for display
  const currentConnectionDetails = React.useMemo(() => {
    if (!currentConnection) return null
    return llmConnections.find(c => c.slug === currentConnection) ?? null
  }, [llmConnections, currentConnection])

  // Effective connection: canonical fallback chain (session → workspace default → global default → first)
  const effectiveConnection = resolveEffectiveConnectionSlug(currentConnection, workspaceDefaultConnection, llmConnections)

  // Effective connection details (with fallbacks) for model list
  // Unlike currentConnectionDetails which is null when no explicit connection is set,
  // this resolves to the actual connection being used (including workspace default)
  const effectiveConnectionDetails = React.useMemo(() => {
    if (!effectiveConnection) return null
    return llmConnections.find(c => c.slug === effectiveConnection) ?? null
  }, [llmConnections, effectiveConnection])

  // Access todoStates and onTodoStateChange from context for the # menu state picker
  const todoStates = appShellCtx?.todoStates ?? []
  const onTodoStateChange = appShellCtx?.onTodoStateChange
  // Resolve workspace rootPath for "Add New Label" deep link
  const workspaceRootPath = React.useMemo(() => {
    if (!appShellCtx || !workspaceId) return null
    return appShellCtx.workspaces.find(w => w.id === workspaceId)?.rootPath ?? null
  }, [appShellCtx, workspaceId])

  // Shuffle placeholder order once per mount so each session feels fresh
  const shuffledPlaceholder = React.useMemo(
    () => Array.isArray(placeholder) ? shuffleArray(placeholder) : placeholder,
    [] // eslint-disable-line react-hooks/exhaustive-deps -- intentionally shuffle only on mount
  )

  // Performance optimization: Always use internal state for typing to avoid parent re-renders
  // Sync FROM parent on mount/change (for restoring drafts)
  // Sync TO parent on blur/submit (debounced persistence)
  const [input, setInput] = React.useState(inputValue ?? '')
  const [attachments, setAttachments] = React.useState<FileAttachment[]>([])

  // Ref to track current attachments for use in event handlers (avoids stale closure issues)
  const attachmentsRef = React.useRef<FileAttachment[]>([])
  React.useEffect(() => {
    attachmentsRef.current = attachments
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
  const prevInputValueRef = React.useRef(inputValue)
  React.useEffect(() => {
    if (inputValue !== undefined && inputValue !== prevInputValueRef.current) {
      setInput(inputValue)
      prevInputValueRef.current = inputValue
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
  const [sourceFilter, setSourceFilter] = React.useState('')
  const [isFocused, setIsFocused] = React.useState(false)
  const [inputMaxHeight, setInputMaxHeight] = React.useState(540)
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

  // Calculate max height: min(66% of window height, 540px)
  React.useEffect(() => {
    const updateMaxHeight = () => {
      const maxFromWindow = Math.floor(window.innerHeight * 0.66)
      setInputMaxHeight(Math.min(maxFromWindow, 540))
    }
    updateMaxHeight()
    window.addEventListener('resize', updateMaxHeight)
    return () => window.removeEventListener('resize', updateMaxHeight)
  }, [])

  const dragCounterRef = React.useRef(0)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const sourceButtonRef = React.useRef<HTMLButtonElement>(null)
  const sourceFilterInputRef = React.useRef<HTMLInputElement>(null)
  const [sourceDropdownPosition, setSourceDropdownPosition] = React.useState<{ top: number; left: number } | null>(null)

  // Merge refs for RichTextInput
  const internalInputRef = React.useRef<RichTextInputHandle>(null)
  const richInputRef = externalInputRef || internalInputRef

  // Track last caret position for focus restoration (e.g., after permission mode popover closes)
  const lastCaretPositionRef = React.useRef<number | null>(null)

  // Listen for craft:insert-text events (generic mechanism for inserting text into input)
  // Used by components that want to pre-fill the input with text
  React.useEffect(() => {
    const handleInsertText = (e: CustomEvent<{ text: string }>) => {
      const { text } = e.detail
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
  }, [syncToParent, richInputRef])

  // Listen for craft:approve-plan events (used by ResponseCard's Accept Plan button)
  // This disables safe mode AND submits the message in one action
  // Only process events for this session (sessionId must match)
  React.useEffect(() => {
    const handleApprovePlan = (e: CustomEvent<{ text?: string; sessionId?: string }>) => {
      // Only handle if this event is for our session
      if (e.detail?.sessionId && e.detail.sessionId !== sessionId) {
        return
      }
      const text = e.detail?.text
      if (!text) {
        toast.error('No details provided')
        return
      }
      // Switch to allow-all (Auto) mode if in Explore mode (allow execution without prompts)
      // Only switch if currently in safe mode - if user is in 'ask' mode, respect their choice
      if (permissionMode === 'safe') {
        onPermissionModeChange?.('allow-all')
      }
      // Submit the message
      onSubmit(text, undefined)
    }

    window.addEventListener('craft:approve-plan', handleApprovePlan as EventListener)
    return () => window.removeEventListener('craft:approve-plan', handleApprovePlan as EventListener)
  }, [sessionId, permissionMode, onPermissionModeChange, onSubmit])

  // Listen for craft:approve-plan-with-compact events (Accept & Compact option)
  // This compacts the conversation first, then executes the plan.
  // The pending state is persisted to survive page reloads (CMD+R).
  React.useEffect(() => {
    const handleApprovePlanWithCompact = async (e: CustomEvent<{ sessionId?: string; planPath?: string }>) => {
      // Only handle if this event is for our session
      if (e.detail?.sessionId && e.detail.sessionId !== sessionId) {
        return
      }

      const planPath = e.detail?.planPath

      // Switch to allow-all (Auto) mode if in Explore mode
      if (permissionMode === 'safe') {
        onPermissionModeChange?.('allow-all')
      }

      // Persist the pending plan execution state BEFORE sending /compact.
      // This allows reload recovery if CMD+R happens during compaction.
      if (planPath && sessionId) {
        await window.electronAPI.sessionCommand(sessionId, {
          type: 'setPendingPlanExecution',
          planPath,
        })
      }

      // Send /compact to trigger compaction
      onSubmit('/compact', undefined)

      // Set up a one-time listener for compaction complete.
      // This handles the normal case (no reload during compaction).
      const handleCompactionComplete = async (compactEvent: CustomEvent<{ sessionId?: string }>) => {
        // Only handle if this is for our session
        if (compactEvent.detail?.sessionId !== sessionId) {
          return
        }

        // Remove the listener (one-time use)
        window.removeEventListener('craft:compaction-complete', handleCompactionComplete as unknown as EventListener)

        // Send the execution message with explicit plan path
        // After compaction, Claude doesn't automatically remember the plan file
        if (planPath) {
          onSubmit(`Read the plan at ${planPath} and execute it.`, undefined)
        } else {
          onSubmit('Plan approved, please execute.', undefined)
        }

        // Clear the pending state since we just sent the execution message
        if (sessionId) {
          await window.electronAPI.sessionCommand(sessionId, {
            type: 'clearPendingPlanExecution',
          })
        }
      }

      window.addEventListener('craft:compaction-complete', handleCompactionComplete as unknown as EventListener)
    }

    window.addEventListener('craft:approve-plan-with-compact', handleApprovePlanWithCompact as unknown as EventListener)
    return () => window.removeEventListener('craft:approve-plan-with-compact', handleApprovePlanWithCompact as unknown as EventListener)
  }, [sessionId, permissionMode, onPermissionModeChange, onSubmit])

  // Reload recovery: Check for pending plan execution on mount.
  // If the page reloaded after compaction completed (awaitingCompaction = false),
  // we need to send the plan execution message that was interrupted by the reload.
  // Also listen for compaction-complete in case CMD+R happened during compaction.
  React.useEffect(() => {
    if (!sessionId) return

    let hasExecuted = false

    const executePendingPlan = async () => {
      if (hasExecuted) return

      const pending = await window.electronAPI.getPendingPlanExecution(sessionId)
      if (!pending || pending.awaitingCompaction) return

      // Compaction completed but we never sent the execution message (page reloaded).
      // Send it now and clear the pending state.
      hasExecuted = true
      onSubmit(`Read the plan at ${pending.planPath} and execute it.`, undefined)

      await window.electronAPI.sessionCommand(sessionId, {
        type: 'clearPendingPlanExecution',
      })
    }

    // Check immediately on mount (handles case where compaction already completed)
    executePendingPlan()

    // Also listen for compaction-complete in case CMD+R happened during compaction.
    // When compaction finishes after reload, this listener will trigger execution.
    const handleCompactionComplete = async (e: CustomEvent<{ sessionId: string }>) => {
      if (e.detail?.sessionId !== sessionId) return
      // Small delay to ensure markCompactionComplete has been called
      await new Promise(resolve => setTimeout(resolve, 100))
      executePendingPlan()
    }

    window.addEventListener('craft:compaction-complete', handleCompactionComplete as unknown as EventListener)
    return () => {
      window.removeEventListener('craft:compaction-complete', handleCompactionComplete as unknown as EventListener)
    }
  }, [sessionId, onSubmit])

  // Listen for craft:focus-input events (restore focus after popover/dropdown closes)
  React.useEffect(() => {
    const handleFocusInput = () => {
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
  }, [richInputRef])

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
    const handlePasteFiles = async (e: CustomEvent<{ files: File[] }>) => {
      if (disabled) return

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
        try {
          const attachment = await readFileAsAttachment(files[i], fileNames[i])
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
  }, [disabled, richInputRef])

  // Build active commands list for slash command menu
  const activeCommands = React.useMemo(() => {
    const active: SlashCommandId[] = []
    // Add the currently active permission mode
    if (permissionMode === 'safe') active.push('safe')
    else if (permissionMode === 'ask') active.push('ask')
    else if (permissionMode === 'allow-all') active.push('allow-all')
    if (ultrathinkEnabled) active.push('ultrathink')
    return active
  }, [permissionMode, ultrathinkEnabled])

  // Handle slash command selection (mode/feature commands)
  const handleSlashCommand = React.useCallback((commandId: SlashCommandId) => {
    if (commandId === 'safe') onPermissionModeChange?.('safe')
    else if (commandId === 'ask') onPermissionModeChange?.('ask')
    else if (commandId === 'allow-all') onPermissionModeChange?.('allow-all')
    else if (commandId === 'ultrathink') onUltrathinkChange?.(!ultrathinkEnabled)
  }, [permissionMode, ultrathinkEnabled, onPermissionModeChange, onUltrathinkChange])

  // Handle folder selection from slash command menu
  const handleSlashFolderSelect = React.useCallback((path: string) => {
    if (onWorkingDirectoryChange) {
      addRecentDir(path)
      setRecentFolders(getRecentDirs())
      onWorkingDirectoryChange(path)
    }
  }, [onWorkingDirectoryChange])

  // Get recent folders and home directory for slash menu and mention menu
  const [recentFolders, setRecentFolders] = React.useState<string[]>([])
  const [homeDir, setHomeDir] = React.useState<string>('')

  React.useEffect(() => {
    setRecentFolders(getRecentDirs())
    window.electronAPI?.getHomeDir?.().then((dir: string) => {
      if (dir) setHomeDir(dir)
    })
  }, [])

  // Inline slash command hook (modes, features, and folders)
  const inlineSlash = useInlineSlashCommand({
    inputRef: richInputRef,
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

    // Files via @ mention: [file:path] in text is sufficient context for the agent.
    // Skills also don't need special handling beyond text insertion.
  }, [optimisticSourceSlugs, onSourcesChange])

  // Inline mention hook (for skills, sources, and files)
  const inlineMention = useInlineMention({
    inputRef: richInputRef,
    skills,
    sources,
    basePath: workingDirectory,
    onSelect: handleMentionSelect,
    workspaceId,
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
    todoStates,
    activeStateId: currentTodoState,
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
    setAddLabelPrefill(prefill ? `Add new label ${prefill}` : '')

    // Open the EditPopover for label creation
    setAddLabelPopoverOpen(true)
  }, [workspaceRootPath, inlineLabel, syncToParent])

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

  // In compact mode, immediately report collapsed height when processing state changes
  // This ensures smooth animation timing when input collapses/expands
  React.useEffect(() => {
    if (!onHeightChange || !compactMode) return
    if (isProcessing) {
      // Collapsed state - only bottom bar visible (~44px)
      onHeightChange(44)
    }
    // When not processing, ResizeObserver will report the full height
  }, [compactMode, isProcessing, onHeightChange])

  // Check if running in Electron environment (has electronAPI)
  const hasElectronAPI = typeof window !== 'undefined' && !!window.electronAPI

  // File attachment handlers
  const handleAttachClick = async () => {
    if (disabled || !hasElectronAPI) return
    try {
      const paths = await window.electronAPI.openFileDialog()
      for (const path of paths) {
        const attachment = await window.electronAPI.readFileAttachment(path)
        if (attachment) {
          setAttachments(prev => [...prev, attachment])
        }
      }
    } catch (error) {
      console.error('[FreeFormInput] Failed to attach files:', error)
    }
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
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = async () => {
        const result = reader.result as ArrayBuffer
        const base64 = btoa(
          new Uint8Array(result).reduce((data, byte) => data + String.fromCharCode(byte), '')
        )

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
          path: fileName,
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
      try {
        const attachment = await readFileAsAttachment(files[i], fileNames[i])
        if (attachment) {
          setAttachments(prev => [...prev, attachment])
        }
      } catch (error) {
        console.error('[FreeFormInput] Failed to read pasted file:', error)
      }
      setLoadingCount(prev => prev - 1)
    }
  }

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
    setAttachments(prev => [...prev, attachment])
    // Focus input after adding attachment
    richInputRef.current?.focus()
  }, []) // No deps needed - uses ref

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current = 0
    setIsDraggingOver(false)
    if (disabled) return

    const files = Array.from(e.dataTransfer.files)
    setLoadingCount(files.length)

    for (const file of files) {
      const filePath = (file as File & { path?: string }).path
      if (filePath && hasElectronAPI) {
        try {
          const attachment = await window.electronAPI.readFileAttachment(filePath)
          if (attachment) {
            setAttachments(prev => [...prev, attachment])
            setLoadingCount(prev => prev - 1)
            continue
          }
        } catch (error) {
          console.error('[FreeFormInput] Failed to read via IPC:', error)
        }
      }

      try {
        const attachment = await readFileAsAttachment(file)
        if (attachment) {
          setAttachments(prev => [...prev, attachment])
        }
      } catch (error) {
        console.error('[FreeFormInput] Failed to read dropped file:', error)
      }
      setLoadingCount(prev => prev - 1)
    }
  }

  // Submit message - backend handles queueing and interruption
  const submitMessage = React.useCallback(() => {
    const hasContent = input.trim() || attachments.length > 0
    if (!hasContent || disabled) return false

    // Tutorial may disable sending to guide user through specific steps
    if (disableSend) return false

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

    onSubmit(
      input.trim(),
      attachments.length > 0 ? attachments : undefined,
      mentions.skills.length > 0 ? mentions.skills : undefined
    )
    setInput('')
    setAttachments([])
    // Clear draft immediately (cancel any pending debounced sync)
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current)
    onInputChange?.('')
    prevInputValueRef.current = ''

    // Restore focus after state updates
    requestAnimationFrame(() => {
      richInputRef.current?.focus()
    })

    return true
  }, [input, attachments, disabled, disableSend, onInputChange, onSubmit, skills, sources, optimisticSourceSlugs, onSourcesChange, onWorkingDirectoryChange, homeDir])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    submitMessage()
  }

  const handleStop = (silent = false) => {
    onStop?.(silent)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Shift+Tab cycles through enabled permission modes
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault()
      e.stopPropagation()
      // Use enabled modes or fallback to all modes
      const modes = enabledModes.length >= 2 ? enabledModes : PERMISSION_MODE_ORDER
      const currentIndex = modes.indexOf(permissionMode)
      // If current mode not in enabled list, jump to first enabled mode
      const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % modes.length
      const nextMode = modes[nextIndex]
      onPermissionModeChange?.(nextMode)
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

    // Skip submission during IME composition - user is confirming composed characters, not sending
    // Handle send key based on user preference:
    // - 'enter': Enter sends (Shift+Enter for newline)
    // - 'cmd-enter': ⌘/Ctrl+Enter sends (Enter for newline)
    if (sendMessageKey === 'enter') {
      // Enter sends, Shift+Enter adds newline
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
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
    // Get previous input value before updating state
    const prevValue = inputRef.current

    setInput(value)
    syncToParent(value) // Debounced sync to parent for draft persistence

    // Sync source selection when mentions are removed from input
    if (onSourcesChange) {
      const sourceSlugs = sources.map(s => s.config.slug)

      // Parse mentions from previous and current input
      const prevMentions = parseMentions(prevValue, [], sourceSlugs)
      const currMentions = parseMentions(value, [], sourceSlugs)

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
    // Update inline slash command state
    inlineSlash.handleInputChange(value, cursorPosition)

    // Update inline mention state (for @mentions - skills, sources, folders)
    inlineMention.handleInputChange(value, cursorPosition)

    // Update inline label state (for #labels)
    inlineLabel.handleInputChange(value, cursorPosition)

    // Auto-capitalize first letter (but not for slash commands, @mentions, or #labels)
    // Only if autoCapitalisation setting is enabled
    let newValue = value
    if (autoCapitalisation && value.length > 0 && value.charAt(0) !== '/' && value.charAt(0) !== '@' && value.charAt(0) !== '#') {
      const capitalizedFirst = value.charAt(0).toUpperCase()
      if (capitalizedFirst !== value.charAt(0)) {
        newValue = capitalizedFirst + value.slice(1)
        // Set cursor position BEFORE state update so it's used when useEffect syncs the value
        richInputRef.current?.setSelectionRange(cursorPosition, cursorPosition)
        setInput(newValue)
        syncToParent(newValue)
        return
      }
    }

    // Apply smart typography (-> to →, etc.)
    const typography = applySmartTypography(value, cursorPosition)
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

  // Handle inline slash folder selection (inserts [dir:/path] badge)
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
      onTodoStateChange?.(sessionId, stateId)
    }
    richInputRef.current?.focus()
  }, [inlineLabel, syncToParent, sessionId, onTodoStateChange])

  const hasContent = input.trim() || attachments.length > 0

  return (
    <form onSubmit={handleSubmit}>
      <div
        ref={containerRef}
        className={cn(
          'overflow-hidden transition-all',
          // Container styling - only when not wrapped by InputContainer
          !unstyled && 'rounded-[16px] shadow-middle',
          !unstyled && 'bg-background',
          isDraggingOver && 'ring-2 ring-foreground ring-offset-2 ring-offset-background bg-foreground/5'
        )}
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
            the option from the # menu with no matches */}
        {addLabelEditConfig && (
          <EditPopover
            trigger={<span className="absolute top-0 left-0 w-0 h-0 overflow-hidden" />}
            open={addLabelPopoverOpen}
            onOpenChange={setAddLabelPopoverOpen}
            context={addLabelEditConfig.context}
            example={addLabelEditConfig.example}
            overridePlaceholder={addLabelEditConfig.overridePlaceholder}
            defaultValue={addLabelPrefill}
            model={addLabelEditConfig.model}
            systemPromptPreset={addLabelEditConfig.systemPromptPreset}
            secondaryAction={workspaceRootPath ? {
              label: 'Edit File',
              filePath: `${workspaceRootPath}/labels/config.json`,
            } : undefined}
            side="top"
            align="start"
          />
        )}

        {/* Attachment Preview */}
        <AttachmentPreview
          attachments={attachments}
          onRemove={handleRemoveAttachment}
          disabled={disabled}
          loadingCount={loadingCount}
        />

        {/* Rich Text Input with inline mention badges */}
        {/* In compact mode, hide input while processing (collapses to just bottom bar) */}
        {!(compactMode && isProcessing) && (
        <RichTextInput
          ref={richInputRef}
          value={input}
          onChange={handleInputChange}
          onInput={handleRichInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onLongTextPaste={handleLongTextPaste}
          onFocus={() => { setIsFocused(true); onFocusChange?.(true) }}
          onBlur={() => {
            // Save caret position before losing focus (for restoration via craft:focus-input)
            lastCaretPositionRef.current = richInputRef.current?.selectionStart ?? null
            setIsFocused(false)
            onFocusChange?.(false)
          }}
          placeholder={shuffledPlaceholder}
          disabled={disabled}
          skills={skills}
          sources={sources}
          workspaceId={workspaceId}
          className="pl-5 pr-4 pt-4 pb-3 overflow-y-auto min-h-[88px]"
          style={{ maxHeight: inputMaxHeight }}
          data-tutorial="chat-input"
          spellCheck={spellCheck}
        />
        )}

        {/* Bottom Row: Controls - wrapped in relative container for escape overlay */}
        <div className="relative">
          {/* Escape interrupt overlay - shown on first Esc press during processing */}
          <EscapeInterruptOverlay isVisible={isProcessing && showEscapeOverlay} />

          <div className={cn("flex items-center gap-1 px-2 py-2", !compactMode && "border-t border-border/50")}>
          {/* Left side: Context badges - shrinkable so model + send always stay visible */}
          {/* Hidden in compact mode (EditPopover embedding) */}
          {!compactMode && (
          <div className="flex items-center gap-1 min-w-32 shrink overflow-hidden">
          {/* 1. Attach Files Badge */}
          <FreeFormInputContextBadge
            icon={<Paperclip className="h-4 w-4" />}
            // Show count ("1 file" / "X files") instead of filename for cleaner UI
            label={attachments.length > 0
              ? attachments.length === 1
                ? "1 file"
                : `${attachments.length} files`
              : "Attach Files"
            }
            isExpanded={isEmptySession}
            hasSelection={attachments.length > 0}
            showChevron={false}
            onClick={handleAttachClick}
            tooltip="Attach files"
            disabled={disabled}
          />

          {/* 2. Source Selector Badge - only show if onSourcesChange is provided */}
          {onSourcesChange && (
            <div className="relative shrink min-w-0 overflow-hidden">
              <FreeFormInputContextBadge
                buttonRef={sourceButtonRef}
                icon={
                  optimisticSourceSlugs.length === 0 ? (
                    <DatabaseZap className="h-4 w-4" />
                  ) : (
                    <div className="flex items-center -ml-0.5">
                      {(() => {
                        const enabledSources = sources.filter(s => optimisticSourceSlugs.includes(s.config.slug))
                        const displaySources = enabledSources.slice(0, 3)
                        const remainingCount = enabledSources.length - 3
                        return (
                          <>
                            {displaySources.map((source, index) => (
                              <div
                                key={source.config.slug}
                                className={cn("relative h-5 w-5 rounded-[4px] bg-background shadow-minimal flex items-center justify-center", index > 0 && "-ml-1")}
                                style={{ zIndex: index + 1 }}
                              >
                                <SourceAvatar source={source} size="xs" />
                              </div>
                            ))}
                            {remainingCount > 0 && (
                              <div
                                className="-ml-1 h-5 w-5 rounded-[4px] bg-background shadow-minimal flex items-center justify-center text-[8px] font-medium text-muted-foreground"
                                style={{ zIndex: displaySources.length + 1 }}
                              >
                                +{remainingCount}
                              </div>
                            )}
                          </>
                        )
                      })()}
                    </div>
                  )
                }
                label={
                  optimisticSourceSlugs.length === 0
                    ? "Choose Sources"
                    : (() => {
                        const enabledSources = sources.filter(s => optimisticSourceSlugs.includes(s.config.slug))
                        if (enabledSources.length === 1) return enabledSources[0].config.name
                        if (enabledSources.length === 2) return enabledSources.map(s => s.config.name).join(', ')
                        return `${enabledSources.length} sources`
                      })()
                }
                isExpanded={isEmptySession}
                hasSelection={optimisticSourceSlugs.length > 0}
                showChevron={true}
                isOpen={sourceDropdownOpen}
                disabled={disabled}
                data-tutorial="source-selector-button"
                onClick={() => {
                  if (!sourceDropdownOpen && sourceButtonRef.current) {
                    const rect = sourceButtonRef.current.getBoundingClientRect()
                    setSourceDropdownPosition({
                      top: rect.top,
                      left: rect.left,
                    })
                    // Focus filter input after popover opens
                    setTimeout(() => sourceFilterInputRef.current?.focus(), 0)
                  } else {
                    // Clear filter when closing
                    setSourceFilter('')
                  }
                  setSourceDropdownOpen(!sourceDropdownOpen)
                }}
                tooltip="Sources"
              />
              {sourceDropdownOpen && sourceDropdownPosition && ReactDOM.createPortal(
                <>
                  <div
                    className="fixed inset-0 z-floating-backdrop"
                    onClick={() => {
                      setSourceDropdownOpen(false)
                      setSourceFilter('')
                    }}
                  />
                  <div
                    className="fixed z-floating-menu min-w-[200px] overflow-hidden rounded-[8px] bg-background text-foreground shadow-modal-small"
                    style={{
                      top: sourceDropdownPosition.top - 8,
                      left: sourceDropdownPosition.left,
                      transform: 'translateY(-100%)',
                    }}
                  >
                    {sources.length === 0 ? (
                      <div className="text-xs text-muted-foreground p-3 select-none">
                        No sources configured.
                        <br />
                        Add sources in Settings.
                      </div>
                    ) : (
                      <CommandPrimitive
                        className="min-w-[200px]"
                        shouldFilter={false}
                      >
                        <div className="border-b border-border/50 px-3 py-2">
                          <CommandPrimitive.Input
                            ref={sourceFilterInputRef}
                            value={sourceFilter}
                            onValueChange={setSourceFilter}
                            placeholder="Search sources..."
                            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground placeholder:select-none"
                          />
                        </div>
                        <CommandPrimitive.List className="max-h-[240px] overflow-y-auto p-1">
                          {sources
                            .filter(source => source.config.name.toLowerCase().includes(sourceFilter.toLowerCase()))
                            .map((source, index) => {
                              const isEnabled = optimisticSourceSlugs.includes(source.config.slug)
                              return (
                                <CommandPrimitive.Item
                                  key={source.config.slug}
                                  value={source.config.slug}
                                  data-tutorial={index === 0 ? "source-dropdown-item-first" : undefined}
                                  onSelect={() => {
                                    const newSlugs = isEnabled
                                      ? optimisticSourceSlugs.filter(slug => slug !== source.config.slug)
                                      : [...optimisticSourceSlugs, source.config.slug]
                                    // Optimistic update - UI updates immediately
                                    setOptimisticSourceSlugs(newSlugs)
                                    // Then trigger async server update
                                    onSourcesChange?.(newSlugs)
                                  }}
                                  className={cn(
                                    "flex cursor-pointer select-none items-center gap-3 rounded-[6px] px-3 py-2 text-[13px]",
                                    "outline-none data-[selected=true]:bg-foreground/5",
                                    isEnabled && "bg-foreground/3"
                                  )}
                                >
                                  <div className="shrink-0 text-muted-foreground flex items-center">
                                    <SourceAvatar
                                      source={source}
                                      size="sm"
                                    />
                                  </div>
                                  <div className="flex-1 min-w-0 truncate">{source.config.name}</div>
                                  <div className={cn(
                                    "shrink-0 h-4 w-4 rounded-full bg-current flex items-center justify-center",
                                    !isEnabled && "opacity-0"
                                  )}>
                                    <Check className="h-2.5 w-2.5 text-white dark:text-black" strokeWidth={3} />
                                  </div>
                                </CommandPrimitive.Item>
                              )
                            })}
                        </CommandPrimitive.List>
                      </CommandPrimitive>
                    )}
                  </div>
                </>,
                document.body
              )}
            </div>
          )}

          {/* 3. Working Directory Selector Badge */}
          {onWorkingDirectoryChange && (
            <WorkingDirectoryBadge
              workingDirectory={workingDirectory}
              onWorkingDirectoryChange={onWorkingDirectoryChange}
              sessionFolderPath={sessionFolderPath}
              isEmptySession={isEmptySession}
            />
          )}
          </div>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Right side: Model + Send - never shrink so they're always visible */}
          <div className="flex items-center shrink-0">
          {/* 5. Model/Connection Selector - Hidden in compact mode (EditPopover embedding) */}
          {!compactMode && (
          <DropdownMenu open={modelDropdownOpen} onOpenChange={setModelDropdownOpen}>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "inline-flex items-center h-7 px-1.5 gap-0.5 text-[13px] shrink-0 rounded-[6px] hover:bg-foreground/5 transition-colors select-none",
                      modelDropdownOpen && "bg-foreground/5",
                      connectionUnavailable && "text-destructive"
                    )}
                  >
                    {connectionUnavailable ? (
                      <>
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                        Unavailable
                      </>
                    ) : (
                      <>
                        {getModelShortName(connectionDefaultModel ?? currentModel)}
                        {!connectionDefaultModel && <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />}
                      </>
                    )}
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="top">Model</TooltipContent>
            </Tooltip>
            <StyledDropdownMenuContent side="top" align="end" sideOffset={8} className="min-w-[260px]">
              {/* Connection unavailable message */}
              {connectionUnavailable ? (
                <div className="flex flex-col items-center justify-center py-6 px-4 text-center">
                  <AlertCircle className="h-8 w-8 text-destructive mb-2" />
                  <div className="font-medium text-sm mb-1">Connection Unavailable</div>
                  <div className="text-xs text-muted-foreground">
                    The connection used by this session has been removed. Create a new session to continue.
                  </div>
                </div>
              ) : connectionDefaultModel ? (
                <StyledDropdownMenuItem
                  disabled
                  className="flex items-center justify-between px-2 py-2 rounded-lg"
                >
                  <div className="text-left">
                    <div className="font-medium text-sm">{connectionDefaultModel}</div>
                    <div className="text-xs text-muted-foreground">Connection default</div>
                  </div>
                  <Check className="h-4 w-4 text-foreground shrink-0 ml-3" />
                </StyledDropdownMenuItem>
              ) : isEmptySession && llmConnections.length > 1 ? (
                /* Hierarchical view: Provider → Connection → Models (for new sessions with multiple connections) */
                connectionsByProvider.map(([providerName, connections], index) => (
                  <React.Fragment key={providerName}>
                    {/* Provider group label */}
                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide select-none">
                      {providerName}
                    </div>
                    {connections.map((conn) => {
                      const isCurrentConnection = effectiveConnection === conn.slug
                      const isAuthenticated = conn.isAuthenticated
                      return (
                        <DropdownMenuSub key={conn.slug}>
                          <StyledDropdownMenuSubTrigger
                            disabled={!isAuthenticated}
                            className={cn(
                              "flex items-center justify-between px-2 py-2 rounded-lg",
                              isCurrentConnection && "bg-foreground/5"
                            )}
                          >
                            <div className="text-left flex-1">
                              <div className="font-medium text-sm flex items-center gap-2">
                                {conn.name}
                                {isCurrentConnection && <Check className="h-3 w-3 text-foreground" />}
                              </div>
                              {!isAuthenticated && (
                                <div className="text-xs text-muted-foreground">Not authenticated</div>
                              )}
                            </div>
                          </StyledDropdownMenuSubTrigger>
                          {isAuthenticated && (
                            <StyledDropdownMenuSubContent className="min-w-[220px]">
                              {/* Show models for this connection - use provider-specific models as fallback */}
                              {(conn.models || ANTHROPIC_MODELS).map((model) => {
                                const modelId = typeof model === 'string' ? model : model.id
                                const modelName = typeof model === 'string' ? getModelShortName(model) : model.name
                                const isSelectedModel = isCurrentConnection && currentModel === modelId
                                return (
                                  <StyledDropdownMenuItem
                                    key={modelId}
                                    onSelect={() => {
                                      // If selecting a different connection, update both connection and model
                                      if (!isCurrentConnection && onConnectionChange) {
                                        onConnectionChange(conn.slug)
                                      }
                                      // Always pass connection with model for proper persistence
                                      onModelChange(modelId, conn.slug)
                                    }}
                                    className="flex items-center justify-between px-2 py-2 rounded-lg cursor-pointer"
                                  >
                                    <div className="font-medium text-sm">{modelName}</div>
                                    {isSelectedModel && (
                                      <Check className="h-4 w-4 text-foreground shrink-0 ml-3" />
                                    )}
                                  </StyledDropdownMenuItem>
                                )
                              })}
                            </StyledDropdownMenuSubContent>
                          )}
                        </DropdownMenuSub>
                      )
                    })}
                    {index < connectionsByProvider.length - 1 && (
                      <StyledDropdownMenuSeparator className="my-1" />
                    )}
                  </React.Fragment>
                ))
              ) : (
                /* Flat model list (single connection or session started) */
                <>
                  {/* Lock indicator showing which connection is being used */}
                  {!isEmptySession && currentConnectionDetails && llmConnections.length > 1 && (
                    <>
                      <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground select-none">
                        <Lock className="h-3 w-3" />
                        <span>Using {currentConnectionDetails.name}</span>
                      </div>
                      <StyledDropdownMenuSeparator className="my-1" />
                    </>
                  )}
                  {/* Model options based on effective connection's provider type */}
                  {availableModels.map((model) => {
                    const modelId = typeof model === 'string' ? model : model.id
                    const modelName = typeof model === 'string' ? getModelShortName(model) : model.name
                    const isSelected = currentModel === modelId
                    const description = typeof model !== 'string' && 'description' in model ? (model.description as string) : ''
                    return (
                      <StyledDropdownMenuItem
                        key={modelId}
                        onSelect={() => onModelChange(modelId, effectiveConnection)}
                        className="flex items-center justify-between px-2 py-2 rounded-lg cursor-pointer"
                      >
                        <div className="text-left">
                          <div className="font-medium text-sm">{modelName}</div>
                          {description && (
                            <div className="text-xs text-muted-foreground">{description}</div>
                          )}
                        </div>
                        {isSelected && (
                          <Check className="h-4 w-4 text-foreground shrink-0 ml-3" />
                        )}
                      </StyledDropdownMenuItem>
                    )
                  })}
                </>
              )}

              {/* Thinking level selector — only shown when thinking levels are available
                  (Claude supports extended thinking, OpenAI backends may not) */}
              {availableThinkingLevels.length > 0 && (
                <>
                  <StyledDropdownMenuSeparator className="my-1" />

                  <DropdownMenuSub>
                    <StyledDropdownMenuSubTrigger className="flex items-center justify-between px-2 py-2 rounded-lg">
                      <div className="text-left flex-1">
                        <div className="font-medium text-sm">{getThinkingLevelName(thinkingLevel)}</div>
                        <div className="text-xs text-muted-foreground">Extended reasoning depth</div>
                      </div>
                    </StyledDropdownMenuSubTrigger>
                    <StyledDropdownMenuSubContent className="min-w-[220px]">
                      {availableThinkingLevels.map(({ id, name, description }) => {
                        const isSelected = thinkingLevel === id
                        return (
                          <StyledDropdownMenuItem
                            key={id}
                            onSelect={() => onThinkingLevelChange?.(id)}
                            className="flex items-center justify-between px-2 py-2 rounded-lg cursor-pointer"
                          >
                            <div className="text-left">
                              <div className="font-medium text-sm">{name}</div>
                              <div className="text-xs text-muted-foreground">{description}</div>
                            </div>
                            {isSelected && (
                              <Check className="h-4 w-4 text-foreground shrink-0 ml-3" />
                            )}
                          </StyledDropdownMenuItem>
                        )
                      })}
                    </StyledDropdownMenuSubContent>
                  </DropdownMenuSub>
                </>
              )}

              {/* Context usage footer - only show when we have token data */}
              {contextStatus?.inputTokens != null && contextStatus.inputTokens > 0 && (
                <>
                  <StyledDropdownMenuSeparator className="my-1" />
                  <div className="px-2 py-1.5 select-none">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Context</span>
                      <span className="flex items-center gap-1.5">
                        {contextStatus.isCompacting && (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        )}
                        {formatTokenCount(contextStatus.inputTokens)} tokens used
                      </span>
                    </div>
                  </div>
                </>
              )}
            </StyledDropdownMenuContent>
          </DropdownMenu>
          )}

          {/* 5.5 Context Usage Warning Badge - shows when approaching auto-compaction threshold */}
          {(() => {
            // Calculate usage percentage based on compaction threshold (~77.5% of context window),
            // not the full context window - this gives users meaningful warnings before compaction kicks in.
            // SDK triggers compaction at ~155k tokens for a 200k context window.
            // Falls back to known per-model context window when SDK hasn't reported usage yet.
            const effectiveContextWindow = contextStatus?.contextWindow || getModelContextWindow(currentModel)
            const compactionThreshold = effectiveContextWindow
              ? Math.round(effectiveContextWindow * 0.775)
              : null
            const usagePercent = contextStatus?.inputTokens && compactionThreshold
              ? Math.min(99, Math.round((contextStatus.inputTokens / compactionThreshold) * 100))
              : null
            // Show badge when >= 80% of compaction threshold AND not currently compacting
            const showWarning = usagePercent !== null && usagePercent >= 80 && !contextStatus?.isCompacting && !isCodexModel(currentModel)

            if (!showWarning) return null

            const handleCompactClick = () => {
              if (!isProcessing) {
                onSubmit('/compact', [])
              }
            }

            return (
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        disabled={isProcessing}
                        className="inline-flex items-center h-6 px-2 text-[12px] font-medium bg-info/10 rounded-[6px] shadow-tinted select-none cursor-pointer hover:bg-info/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{
                          '--shadow-color': 'var(--info-rgb)',
                          color: 'color-mix(in oklab, var(--info) 30%, var(--foreground))',
                        } as React.CSSProperties}
                      >
                        {usagePercent}%
                      </button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {usagePercent}% context used
                  </TooltipContent>
                </Tooltip>
                <StyledDropdownMenuContent align="center" side="top" sideOffset={8}>
                  <StyledDropdownMenuItem
                    onClick={handleCompactClick}
                    disabled={isProcessing}
                  >
                    Compact
                  </StyledDropdownMenuItem>
                </StyledDropdownMenuContent>
              </DropdownMenu>
            )
          })()}

          {/* 6. Send/Stop Button - Always show stop when processing */}
          {isProcessing ? (
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className="h-7 w-7 rounded-full shrink-0 hover:bg-foreground/15 active:bg-foreground/20 ml-2"
              onClick={() => handleStop(false)}
            >
              <Square className="h-3 w-3 fill-current" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              className="h-7 w-7 rounded-full shrink-0 ml-2"
              disabled={!hasContent || disabled}
              data-tutorial="send-button"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          )}
          </div>
          </div>
        </div>
      </div>
    </form>
  )
}

/**
 * Helper functions for recent directories storage
 */
function getRecentDirs(): string[] {
  return storage.get<string[]>(storage.KEYS.recentWorkingDirs, [])
}

function addRecentDir(path: string): void {
  const recent = getRecentDirs().filter(p => p !== path)
  const updated = [path, ...recent].slice(0, 25)
  storage.set(storage.KEYS.recentWorkingDirs, updated)
}

/**
 * Format path for display, with home directory shortened
 */
function formatPathForDisplay(path: string, homeDir: string): string {
  let displayPath = path
  if (homeDir && path.startsWith(homeDir)) {
    const relativePath = path.slice(homeDir.length)
    // Remove leading separator if present, show root separator if empty
    displayPath = relativePath.startsWith(PATH_SEP)
      ? relativePath.slice(1)
      : (relativePath || PATH_SEP)
  }
  return `in ${displayPath}`
}

/**
 * WorkingDirectoryBadge - Context badge for selecting working directory
 * Uses cmdk for filterable folder list when there are more than 5 recent folders.
 */
function WorkingDirectoryBadge({
  workingDirectory,
  onWorkingDirectoryChange,
  sessionFolderPath,
  isEmptySession = false,
}: {
  workingDirectory?: string
  onWorkingDirectoryChange: (path: string) => void
  sessionFolderPath?: string
  isEmptySession?: boolean
}) {
  const [recentDirs, setRecentDirs] = React.useState<string[]>([])
  const [popoverOpen, setPopoverOpen] = React.useState(false)
  const [homeDir, setHomeDir] = React.useState<string>('')
  const [gitBranch, setGitBranch] = React.useState<string | null>(null)
  const [filter, setFilter] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)

  // Load home directory and recent directories on mount
  React.useEffect(() => {
    setRecentDirs(getRecentDirs())
    window.electronAPI?.getHomeDir?.().then((dir: string) => {
      if (dir) setHomeDir(dir)
    })
  }, [])

  // Fetch git branch when working directory changes
  React.useEffect(() => {
    if (workingDirectory) {
      window.electronAPI?.getGitBranch?.(workingDirectory).then((branch: string | null) => {
        setGitBranch(branch)
      })
    } else {
      setGitBranch(null)
    }
  }, [workingDirectory])

  // Reset filter and focus input when popover opens
  React.useEffect(() => {
    if (popoverOpen) {
      setFilter('')
      // Focus input after popover animation completes (only if filter is shown)
      const timer = setTimeout(() => {
        inputRef.current?.focus()
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [popoverOpen])

  const handleChooseFolder = async () => {
    if (!window.electronAPI) return
    setPopoverOpen(false)
    const selectedPath = await window.electronAPI.openFolderDialog()
    if (selectedPath) {
      addRecentDir(selectedPath)
      setRecentDirs(getRecentDirs())
      onWorkingDirectoryChange(selectedPath)
    }
  }

  const handleSelectRecent = (path: string) => {
    addRecentDir(path) // Move to top of recent list
    setRecentDirs(getRecentDirs())
    onWorkingDirectoryChange(path)
    setPopoverOpen(false)
  }

  const handleReset = () => {
    if (sessionFolderPath) {
      onWorkingDirectoryChange(sessionFolderPath)
      setPopoverOpen(false)
    }
  }

  // Filter out current directory from recent list and sort alphabetically by folder name
  const filteredRecent = recentDirs
    .filter(p => p !== workingDirectory)
    .sort((a, b) => {
      const nameA = getPathBasename(a).toLowerCase()
      const nameB = getPathBasename(b).toLowerCase()
      return nameA.localeCompare(nameB)
    })
  // Show filter input only when more than 5 recent folders
  const showFilter = filteredRecent.length > 5

  // Determine label - "Work in Folder" if not set or at session root, otherwise folder name
  const hasFolder = !!workingDirectory && workingDirectory !== sessionFolderPath
  const folderName = hasFolder ? (getPathBasename(workingDirectory) || 'Folder') : 'Work in Folder'

  // Show reset option when a folder is selected and it differs from session folder
  const showReset = hasFolder && sessionFolderPath && sessionFolderPath !== workingDirectory

  // Styles matching todo-filter-menu.tsx for consistency
  const MENU_CONTAINER_STYLE = 'min-w-[200px] max-w-[400px] overflow-hidden rounded-[8px] bg-background text-foreground shadow-modal-small p-0'
  const MENU_LIST_STYLE = 'max-h-[200px] overflow-y-auto p-1 [&_[cmdk-list-sizer]]:space-y-px'
  const MENU_ITEM_STYLE = 'flex cursor-pointer select-none items-center gap-2 rounded-[6px] px-3 py-1.5 text-[13px] outline-none'

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverTrigger asChild>
        <span className="shrink min-w-0 overflow-hidden">
          <FreeFormInputContextBadge
            icon={<Icon_Home className="h-4 w-4" />}
            label={folderName}
            isExpanded={isEmptySession}
            hasSelection={hasFolder}
            showChevron={true}
            isOpen={popoverOpen}
            tooltip={
              hasFolder ? (
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium">Working directory</span>
                  <span className="text-xs opacity-70">{formatPathForDisplay(workingDirectory, homeDir)}</span>
                  {gitBranch && <span className="text-xs opacity-70">on {gitBranch}</span>}
                </span>
              ) : "Choose working directory"
            }
          />
        </span>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={8} className={MENU_CONTAINER_STYLE}>
        <CommandPrimitive shouldFilter={showFilter}>
          {/* Filter input - only shown when more than 5 recent folders */}
          {showFilter && (
            <div className="border-b border-border/50 px-3 py-2">
              <CommandPrimitive.Input
                ref={inputRef}
                value={filter}
                onValueChange={setFilter}
                placeholder="Filter folders..."
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/50 placeholder:select-none"
              />
            </div>
          )}

          <CommandPrimitive.List className={MENU_LIST_STYLE}>
            {/* Current Folder Display - shown at top with checkmark */}
            {hasFolder && (
              <CommandPrimitive.Item
                value={`current-${workingDirectory}`}
                className={cn(MENU_ITEM_STYLE, 'pointer-events-none bg-foreground/5')}
                disabled
              >
                <Icon_Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 min-w-0 truncate">
                  <span>{folderName}</span>
                  <span className="text-muted-foreground ml-1.5">{formatPathForDisplay(workingDirectory, homeDir)}</span>
                </span>
                <Check className="h-4 w-4 shrink-0" />
              </CommandPrimitive.Item>
            )}

            {/* Separator after current folder */}
            {hasFolder && filteredRecent.length > 0 && (
              <div className="h-px bg-border my-1 mx-1" />
            )}

            {/* Recent Directories - filterable (current directory already filtered out via filteredRecent) */}
            {filteredRecent.map((path) => {
              const recentFolderName = getPathBasename(path) || 'Folder'
              return (
                <CommandPrimitive.Item
                  key={path}
                  value={`${recentFolderName} ${path}`}
                  onSelect={() => handleSelectRecent(path)}
                  className={cn(MENU_ITEM_STYLE, 'data-[selected=true]:bg-foreground/5')}
                >
                  <Icon_Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 min-w-0 truncate">
                    <span>{recentFolderName}</span>
                    <span className="text-muted-foreground ml-1.5">{formatPathForDisplay(path, homeDir)}</span>
                  </span>
                </CommandPrimitive.Item>
              )
            })}

            {/* Empty state when filtering */}
            {showFilter && (
              <CommandPrimitive.Empty className="py-3 text-center text-sm text-muted-foreground">
                No folders found
              </CommandPrimitive.Empty>
            )}
          </CommandPrimitive.List>

          {/* Bottom actions - always visible, outside scrollable area */}
          <div className="border-t border-border/50 p-1">
            <button
              type="button"
              onClick={handleChooseFolder}
              className={cn(MENU_ITEM_STYLE, 'w-full hover:bg-foreground/5')}
            >
              Choose Folder...
            </button>
            {showReset && (
              <button
                type="button"
                onClick={handleReset}
                className={cn(MENU_ITEM_STYLE, 'w-full hover:bg-foreground/5')}
              >
                Reset
              </button>
            )}
          </div>
        </CommandPrimitive>
      </PopoverContent>
    </Popover>
  )
}
