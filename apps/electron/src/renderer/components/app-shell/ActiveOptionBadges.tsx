import * as React from 'react'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SlashCommandMenu, DEFAULT_SLASH_COMMAND_GROUPS, type SlashCommandId } from '@/components/ui/slash-command-menu'
import { ChevronDown, X } from 'lucide-react'
import { PERMISSION_MODE_CONFIG, type PermissionMode } from '@craft-agent/shared/agent/modes'
import { ActiveTasksBar, type BackgroundTask } from './ActiveTasksBar'
import { LabelIcon, LabelValueTypeIcon } from '@/components/ui/label-icon'
import { LabelValuePopover } from '@/components/ui/label-value-popover'
import type { LabelConfig } from '@craft-agent/shared/labels'
import { flattenLabels, parseLabelEntry, formatLabelEntry } from '@craft-agent/shared/labels'
import { resolveEntityColor } from '@craft-agent/shared/colors'
import { useTheme } from '@/context/ThemeContext'
import { useDynamicStack } from '@/hooks/useDynamicStack'
import type { TodoState } from '@/config/todo-states'
import { getState } from '@/config/todo-states'
import { TodoStateMenu } from '@/components/ui/todo-filter-menu'
import { useOptionalAppShellContext } from '@/context/AppShellContext'

// ============================================================================
// Permission Mode Icon Component
// ============================================================================

function PermissionModeIcon({ mode, className }: { mode: PermissionMode; className?: string }) {
  const config = PERMISSION_MODE_CONFIG[mode]
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d={config.svgPath} />
    </svg>
  )
}

export interface ActiveOptionBadgesProps {
  /** Show ultrathink badge */
  ultrathinkEnabled?: boolean
  /** Callback when ultrathink is toggled off */
  onUltrathinkChange?: (enabled: boolean) => void
  /** Current permission mode */
  permissionMode?: PermissionMode
  /** Callback when permission mode changes */
  onPermissionModeChange?: (mode: PermissionMode) => void
  /** Background tasks to display */
  tasks?: BackgroundTask[]
  /** Session ID for opening preview windows */
  sessionId?: string
  /** Callback when kill button is clicked on a task */
  onKillTask?: (taskId: string) => void
  /** Callback to insert message into input field */
  onInsertMessage?: (text: string) => void
  /** Label entries applied to this session (e.g., ["bug", "priority::3"]) */
  sessionLabels?: string[]
  /** Available label configs (tree structure) for resolving label display */
  labels?: LabelConfig[]
  /** Callback when a label is removed (legacy — prefer onLabelsChange) */
  onRemoveLabel?: (labelId: string) => void
  /** Callback when session labels array changes (value edits or removals) */
  onLabelsChange?: (updatedLabels: string[]) => void
  /** Label ID whose value popover should auto-open (set when a valued label is added via # menu) */
  autoOpenLabelId?: string | null
  /** Called after the auto-open has been consumed, so the parent can clear the signal */
  onAutoOpenConsumed?: () => void
  // ── State/status badge (in dynamic stack) ──
  /** Available workflow states */
  todoStates?: TodoState[]
  /** Current session state ID */
  currentTodoState?: string
  /** Callback when state changes */
  onTodoStateChange?: (stateId: string) => void
  /** Additional CSS classes */
  className?: string
  /** Whether the session status feature is enabled (hides state badge when false) */
  statusEnabled?: boolean
}

/** Resolved label entry: config + parsed value + original index in sessionLabels */
interface ResolvedLabelEntry {
  config: LabelConfig
  rawValue?: string
  index: number
}

export function ActiveOptionBadges({
  ultrathinkEnabled = false,
  onUltrathinkChange,
  permissionMode = 'ask',
  onPermissionModeChange,
  tasks = [],
  sessionId,
  onKillTask,
  onInsertMessage,
  sessionLabels = [],
  labels = [],
  onRemoveLabel,
  onLabelsChange,
  autoOpenLabelId,
  onAutoOpenConsumed,
  todoStates = [],
  currentTodoState,
  onTodoStateChange,
  className,
  statusEnabled: statusEnabledProp,
}: ActiveOptionBadgesProps) {
  // Get statusEnabled from context if not provided as prop
  const appShellCtx = useOptionalAppShellContext()
  const statusEnabled = statusEnabledProp ?? appShellCtx?.statusEnabled ?? false

  // Resolve session label entries to their config objects + parsed values.
  // Entries may be bare IDs ("bug") or valued ("priority::3").
  // Preserves the raw value and original index for editing/removal.
  const resolvedLabels = React.useMemo((): ResolvedLabelEntry[] => {
    if (sessionLabels.length === 0 || labels.length === 0) return []
    const flat = flattenLabels(labels)
    const result: ResolvedLabelEntry[] = []
    for (let i = 0; i < sessionLabels.length; i++) {
      const parsed = parseLabelEntry(sessionLabels[i])
      const config = flat.find(l => l.id === parsed.id)
      if (config) {
        result.push({ config, rawValue: parsed.rawValue, index: i })
      }
    }
    return result
  }, [sessionLabels, labels])

  const hasLabels = resolvedLabels.length > 0

  // Resolve the current state from todoStates for the badge display.
  // Every session always has a state — fall back to the default state (or 'todo')
  // when currentTodoState isn't explicitly set, matching SessionList's behavior.
  // Only show state badge when statusEnabled is true.
  const effectiveStateId = currentTodoState || 'todo'
  const resolvedState = todoStates.length > 0 ? getState(effectiveStateId, todoStates) : undefined
  const hasState = statusEnabled && !!resolvedState

  // Show the stacking container when there are labels or a state badge
  const hasStackContent = hasLabels || hasState

  // Dynamic stacking with equal visible strips: ResizeObserver computes per-badge
  // margins directly on children. Wider badges get more negative margins so each
  // shows the same visible strip when stacked. No React re-renders needed.
  // reservedStart: 24 matches the mask gradient width so stacking begins
  // before badges reach the faded zone on the left edge.
  const stackRef = useDynamicStack({ gap: 8, minVisible: 20, reservedStart: 24 })

  // Only render if badges or tasks are active
  if (!ultrathinkEnabled && !permissionMode && tasks.length === 0 && !hasStackContent) {
    return null
  }

  return (
    <div className={cn("flex items-start gap-2 mb-2 px-px pt-px pb-0.5", className)}>
      {/* Permission Mode Badge */}
      {permissionMode && (
        <div className="shrink-0">
          <PermissionModeDropdown
            permissionMode={permissionMode}
            ultrathinkEnabled={ultrathinkEnabled}
            onPermissionModeChange={onPermissionModeChange}
            onUltrathinkChange={onUltrathinkChange}
          />
        </div>
      )}

      {/* Ultrathink Badge */}
      {ultrathinkEnabled && (
        <button
          type="button"
          onClick={() => onUltrathinkChange?.(false)}
          className="h-[30px] pl-2.5 pr-2 text-xs font-medium rounded-[8px] flex items-center gap-1.5 shrink-0 transition-all bg-gradient-to-r from-blue-600/10 via-purple-600/10 to-pink-600/10 hover:from-blue-600/15 hover:via-purple-600/15 hover:to-pink-600/15 shadow-tinted outline-none select-none"
          style={{ '--shadow-color': '147, 51, 234' } as React.CSSProperties}
        >
          <span className="bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
            Ultrathink
          </span>
          <X className="h-3 w-3 text-purple-500 opacity-60 hover:opacity-100 translate-y-px" />
        </button>
      )}

      {/* Stacking container for state badge + label badges.
       * useDynamicStack sets per-child marginLeft directly via ResizeObserver.
       * overflow: clip prevents scroll container while py/-my gives shadow room. */}
      {hasStackContent && (
        <div
          className="min-w-0 flex-1 py-0.5 -my-0.5"
          style={{
            // shadow-minimal replicated as drop-shadow (traces masked alpha, no clipping).
            // Ring uses higher blur+opacity for visible border feel (hard 1px ring can't be replicated exactly).
            // Blur shadows use reduced blur+opacity to stay tight (accounting for no negative spread in drop-shadow).
            filter: 'drop-shadow(0px 0px 0.5px rgba(var(--foreground-rgb), 0.3)) drop-shadow(0px 1px 0.1px rgba(0,0,0,0.04)) drop-shadow(0px 3px 0.2px rgba(0,0,0,0.03))',
          }}
        >
          <div
            ref={stackRef}
            className="flex items-center min-w-0 justify-end py-1 -my-1 pr-2 -mr-2"
            style={{ overflow: 'clip' }}
          >
            {/* State badge — first child in the stack (leftmost in the right-aligned row) */}
            {hasState && resolvedState && (
              <StateBadge
                state={resolvedState}
                todoStates={todoStates}
                onTodoStateChange={onTodoStateChange}
              />
            )}
            {/* Label badges */}
            {resolvedLabels.map(({ config, rawValue, index }) => (
              <LabelBadge
                key={config.id}
                label={config}
                value={rawValue}
                autoOpen={config.id === autoOpenLabelId}
                onAutoOpenConsumed={onAutoOpenConsumed}
                onValueChange={(newValue) => {
                  // Rebuild the sessionLabels array with the updated entry
                  const updated = [...sessionLabels]
                  updated[index] = formatLabelEntry(config.id, newValue)
                  onLabelsChange?.(updated)
                }}
                onRemove={() => {
                  if (onLabelsChange) {
                    onLabelsChange(sessionLabels.filter((_, i) => i !== index))
                  } else {
                    onRemoveLabel?.(config.id)
                  }
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Label Badge Component
// ============================================================================

/**
 * Format a raw value for display based on the label's valueType.
 * Dates render as locale short format; numbers and strings pass through.
 */
function formatDisplayValue(rawValue: string, valueType?: 'string' | 'number' | 'date'): string {
  if (valueType === 'date') {
    const date = new Date(rawValue.includes('T') ? rawValue + ':00Z' : rawValue + 'T00:00:00Z')
    if (!isNaN(date.getTime())) {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    }
  }
  return rawValue
}

/**
 * Renders a single label badge with LabelValuePopover for editing/removal.
 * No box-shadow on the badge itself — all shadows come from the parent
 * wrapper's drop-shadow filter (traces masked alpha without clipping).
 * Shows: [color circle] [name] [· value in mono] [chevron]
 */
function LabelBadge({
  label,
  value,
  autoOpen,
  onAutoOpenConsumed,
  onValueChange,
  onRemove,
}: {
  label: LabelConfig
  value?: string
  /** When true, auto-open the value popover on mount (for newly added valued labels) */
  autoOpen?: boolean
  onAutoOpenConsumed?: () => void
  onValueChange?: (newValue: string | undefined) => void
  onRemove: () => void
}) {
  const { isDark } = useTheme()
  const [open, setOpen] = React.useState(false)

  // Auto-open the value popover when this label was just added via # menu
  // and has a valueType. Opens exactly once, then clears the signal.
  React.useEffect(() => {
    if (autoOpen && label.valueType) {
      setOpen(true)
      onAutoOpenConsumed?.()
    }
  }, [autoOpen, label.valueType, onAutoOpenConsumed])

  // Resolve label color for tinting background and text via CSS color-mix
  const resolvedColor = label.color
    ? resolveEntityColor(label.color, isDark)
    : 'var(--foreground)'

  const displayValue = value ? formatDisplayValue(value, label.valueType) : undefined

  return (
    <LabelValuePopover
      label={label}
      value={value}
      open={open}
      onOpenChange={setOpen}
      onValueChange={onValueChange}
      onRemove={onRemove}
    >
      <button
        type="button"
        className={cn(
          "h-[30px] pl-3 pr-2 text-xs font-medium rounded-[8px] flex items-center shrink-0",
          "outline-none select-none transition-colors",
          // Background: 97% background + 3% label color. Hover: 92% + 8%.
          // Text: 80% foreground + 20% label color.
          // All opaque — drop-shadow traces alpha, badge must stay solid.
          "bg-[color-mix(in_srgb,var(--background)_97%,var(--badge-color))]",
          "hover:bg-[color-mix(in_srgb,var(--background)_92%,var(--badge-color))]",
          "text-[color-mix(in_srgb,var(--foreground)_80%,var(--badge-color))]",
          "relative", // for z-index stacking when overlapped
        )}
        style={{ '--badge-color': resolvedColor } as React.CSSProperties}
      >
        <LabelIcon label={label} size="lg" />
        <span className="whitespace-nowrap ml-2">{label.name}</span>
        {/* Optional typed value: interpunkt separator + value, or placeholder icon if typed but no value set */}
        {displayValue ? (
          <>
            <span className="opacity-30 mx-1">·</span>
            <span className="opacity-60 whitespace-nowrap max-w-[100px] truncate">
              {displayValue}
            </span>
          </>
        ) : (
          label.valueType && (
            <>
              <span className="opacity-30 mx-1">·</span>
              <LabelValueTypeIcon valueType={label.valueType} />
            </>
          )
        )}
        <ChevronDown className="h-3 w-3 opacity-40 ml-1 shrink-0" />
      </button>
    </LabelValuePopover>
  )
}

// ============================================================================
// State Badge Component
// ============================================================================

/**
 * Renders the current workflow state as a badge in the dynamic stacking container.
 * Click opens a TodoStateMenu popover for changing the state.
 * Styled consistently with label badges (h-[30px], rounded-[8px], color-mix tinting).
 */
function StateBadge({
  state,
  todoStates,
  onTodoStateChange,
}: {
  state: TodoState
  todoStates: TodoState[]
  onTodoStateChange?: (stateId: string) => void
}) {
  const [open, setOpen] = React.useState(false)

  const handleSelect = React.useCallback((stateId: string) => {
    setOpen(false)
    onTodoStateChange?.(stateId)
  }, [onTodoStateChange])

  // Use the state's resolved color for tinting (same color-mix pattern as labels)
  const badgeColor = state.resolvedColor || 'var(--foreground)'
  const applyColor = state.iconColorable

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "h-[30px] pl-2.5 pr-2 text-xs font-medium rounded-[8px] flex items-center gap-1.5 shrink-0",
            "outline-none select-none transition-colors",
            // Same color-mix tinting as label badges for visual consistency
            "bg-[color-mix(in_srgb,var(--background)_97%,var(--badge-color))]",
            "hover:bg-[color-mix(in_srgb,var(--background)_92%,var(--badge-color))]",
            "text-[color-mix(in_srgb,var(--foreground)_80%,var(--badge-color))]",
            "relative",
          )}
          style={{ '--badge-color': badgeColor } as React.CSSProperties}
        >
          {/* State icon with resolved color */}
          <span
            className="shrink-0 flex items-center w-3.5 h-3.5 [&>svg]:w-full [&>svg]:h-full [&>img]:w-full [&>img]:h-full [&>span]:text-xs"
            style={applyColor ? { color: state.resolvedColor } : undefined}
          >
            {state.icon}
          </span>
          <span className="whitespace-nowrap">{state.label}</span>
          <ChevronDown className="h-3 w-3 opacity-40 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-0 border-0 shadow-none bg-transparent"
        side="top"
        align="end"
        sideOffset={4}
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('craft:focus-input'))
        }}
      >
        <TodoStateMenu
          activeState={state.id}
          onSelect={handleSelect}
          states={todoStates}
        />
      </PopoverContent>
    </Popover>
  )
}

interface PermissionModeDropdownProps {
  permissionMode: PermissionMode
  ultrathinkEnabled?: boolean
  onPermissionModeChange?: (mode: PermissionMode) => void
  onUltrathinkChange?: (enabled: boolean) => void
}

function PermissionModeDropdown({ permissionMode, ultrathinkEnabled = false, onPermissionModeChange, onUltrathinkChange }: PermissionModeDropdownProps) {
  const [open, setOpen] = React.useState(false)
  // Optimistic local state - updates immediately, syncs with prop
  const [optimisticMode, setOptimisticMode] = React.useState(permissionMode)

  // Sync optimistic state when prop changes (confirmation from backend)
  React.useEffect(() => {
    setOptimisticMode(permissionMode)
  }, [permissionMode])

  // Build active commands including ultrathink state
  const activeCommands = React.useMemo((): SlashCommandId[] => {
    const active: SlashCommandId[] = [optimisticMode as SlashCommandId]
    if (ultrathinkEnabled) active.push('ultrathink')
    return active
  }, [optimisticMode, ultrathinkEnabled])

  // Handle command selection from dropdown
  const handleSelect = React.useCallback((commandId: SlashCommandId) => {
    if (commandId === 'safe' || commandId === 'ask' || commandId === 'allow-all') {
      setOptimisticMode(commandId)
      onPermissionModeChange?.(commandId)
    } else if (commandId === 'ultrathink') {
      onUltrathinkChange?.(!ultrathinkEnabled)
    }
    setOpen(false)
  }, [onPermissionModeChange, onUltrathinkChange, ultrathinkEnabled])

  // Get config for current mode (use optimistic state for instant UI update)
  const config = PERMISSION_MODE_CONFIG[optimisticMode]

  // Mode-specific styling using CSS variables (theme-aware)
  // - safe (Explore): foreground at 60% opacity - subtle, read-only feel
  // - ask (Ask to Edit): info color - amber, prompts for edits
  // - allow-all (Auto): accent color - purple, full autonomy
  const modeStyles: Record<PermissionMode, { className: string; shadowVar: string }> = {
    'safe': {
      className: 'bg-foreground/5 text-foreground/60',
      shadowVar: 'var(--foreground-rgb)',
    },
    'ask': {
      className: 'bg-info/10 text-info',
      shadowVar: 'var(--info-rgb)',
    },
    'allow-all': {
      className: 'bg-accent/5 text-accent',
      shadowVar: 'var(--accent-rgb)',
    },
  }
  const currentStyle = modeStyles[optimisticMode]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-tutorial="permission-mode-dropdown"
          className={cn(
            "h-[30px] pl-2.5 pr-2 text-xs font-medium rounded-[8px] flex items-center gap-1.5 shadow-tinted outline-none select-none",
            currentStyle.className
          )}
          style={{ '--shadow-color': currentStyle.shadowVar } as React.CSSProperties}
        >
          <PermissionModeIcon mode={optimisticMode} className="h-3.5 w-3.5" />
          <span>{config.displayName}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-0 bg-background/80 backdrop-blur-xl backdrop-saturate-150 border-border/50"
        side="top"
        align="start"
        sideOffset={4}
        style={{ borderRadius: '8px', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)' }}
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('craft:focus-input'))
        }}
      >
        <SlashCommandMenu
          commandGroups={DEFAULT_SLASH_COMMAND_GROUPS}
          activeCommands={activeCommands}
          onSelect={handleSelect}
          showFilter
        />
      </PopoverContent>
    </Popover>
  )
}

