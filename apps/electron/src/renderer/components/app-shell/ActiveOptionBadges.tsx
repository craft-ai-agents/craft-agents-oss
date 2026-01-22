import * as React from 'react'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SlashCommandMenu, DEFAULT_SLASH_COMMAND_GROUPS, type SlashCommandId } from '@/components/ui/slash-command-menu'
import { ChevronDown, X } from 'lucide-react'
import { PERMISSION_MODE_CONFIG, type PermissionMode } from '@craft-agent/shared/agent/modes'
import { ActiveTasksBar, type BackgroundTask } from './ActiveTasksBar'

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
  /** Additional CSS classes */
  className?: string
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
  className,
}: ActiveOptionBadgesProps) {
  // Only render if badges or tasks are active
  if (!ultrathinkEnabled && !permissionMode && tasks.length === 0) {
    return null
  }

  return (
    <div className={cn("flex items-start gap-2 mb-2 px-px pt-px pb-0.5 overflow-x-auto overflow-y-hidden", className)}>
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

      {/* Background Tasks - DISABLED: UI hidden because task tracking is not reliable.
       * The underlying infrastructure (useBackgroundTasks hook, atoms, event handlers) is kept
       * intact for when we fix the reliability issues. See apps/electron/CLAUDE.md for details.
       */}
      {/* {sessionId && <ActiveTasksBar tasks={tasks} sessionId={sessionId} onKillTask={onKillTask} onInsertMessage={onInsertMessage} />} */}
    </div>
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

