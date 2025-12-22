import * as React from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import { cn } from '@/lib/utils'
import {
  CircleDashed,
  CircleProgress,
  CircleEye,
  CircleCheckFilled,
  CircleXFilled,
} from '@/components/icons/TodoStateIcons'

// ============================================================================
// Types
// ============================================================================

export type TodoStateId = 'todo' | 'in-progress' | 'needs-review' | 'done' | 'cancelled'

export interface TodoState {
  id: TodoStateId
  label: string
  icon: React.ReactNode
  color?: string
  shortcut?: string
}

// ============================================================================
// Icon size constant
// ============================================================================

const MENU_ICON_SIZE = 'h-3.5 w-3.5'

// ============================================================================
// Default States (can be customized by user later)
// ============================================================================

export const DEFAULT_TODO_STATES: TodoState[] = [
  {
    id: 'todo',
    label: 'Todo',
    icon: <CircleDashed className={MENU_ICON_SIZE} />,
    color: 'text-muted-foreground',
    shortcut: 't',
  },
  {
    id: 'in-progress',
    label: 'In Progress',
    icon: <CircleProgress className={MENU_ICON_SIZE} />,
    color: 'text-amber-500',
    shortcut: 'p',
  },
  {
    id: 'needs-review',
    label: 'Needs Review',
    icon: <CircleEye className={MENU_ICON_SIZE} />,
    color: 'text-teal-500',
    shortcut: 'v',
  },
  {
    id: 'done',
    label: 'Done',
    icon: <CircleCheckFilled className={MENU_ICON_SIZE} />,
    color: 'text-[#9570BE]',
    shortcut: 'd',
  },
  {
    id: 'cancelled',
    label: 'Cancelled',
    icon: <CircleXFilled className={MENU_ICON_SIZE} />,
    color: 'text-muted-foreground/60',
    shortcut: 'x',
  },
]

// ============================================================================
// Shared Styles (matching slash-command-menu)
// ============================================================================

const MENU_CONTAINER_STYLE = 'min-w-[140px] overflow-hidden rounded-[8px] bg-background text-popover-foreground shadow-modal-small'
const MENU_LIST_STYLE = 'max-h-[240px] overflow-y-auto p-1 [&_[cmdk-list-sizer]]:space-y-px'
const MENU_ITEM_STYLE = 'flex cursor-pointer select-none items-center gap-3 rounded-[6px] px-3 py-1.5 text-[13px]'
const MENU_ITEM_SELECTED = 'bg-accent text-accent-foreground'

// ============================================================================
// StateItemContent - Shared item rendering
// ============================================================================

function StateItemContent({ state }: { state: TodoState }) {
  return (
    <>
      <div className={cn("shrink-0", state.color || "text-muted-foreground")}>
        {state.icon}
      </div>
      <div className="flex-1 min-w-0">{state.label}</div>
      {state.shortcut && (
        <kbd className="ml-auto text-[11px] text-muted-foreground/60 uppercase">
          {state.shortcut}
        </kbd>
      )}
    </>
  )
}

// ============================================================================
// TodoStateMenu Component - For selecting/changing a session's state
// ============================================================================

export interface TodoStateMenuProps {
  states?: TodoState[]
  activeState: TodoStateId
  onSelect: (stateId: TodoStateId) => void
  className?: string
}

export function TodoStateMenu({
  states = DEFAULT_TODO_STATES,
  activeState,
  onSelect,
  className,
}: TodoStateMenuProps) {
  // Build shortcut map for keyboard handling
  const shortcutMap = React.useMemo(() => {
    const map = new Map<string, TodoStateId>()
    for (const state of states) {
      if (state.shortcut) {
        map.set(state.shortcut.toLowerCase(), state.id)
      }
    }
    return map
  }, [states])

  const handleKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    // Only handle single letter keys without modifiers
    if (e.metaKey || e.ctrlKey || e.altKey) return

    const key = e.key.toLowerCase()
    const stateId = shortcutMap.get(key)
    if (stateId) {
      e.preventDefault()
      e.stopPropagation()
      onSelect(stateId)
    }
  }, [shortcutMap, onSelect])

  return (
    <CommandPrimitive
      className={cn(MENU_CONTAINER_STYLE, className)}
      shouldFilter={false}
      onKeyDown={handleKeyDown}
    >
      <CommandPrimitive.List className={MENU_LIST_STYLE}>
        {states.map((state) => {
          const isActive = activeState === state.id
          return (
            <CommandPrimitive.Item
              key={state.id}
              value={state.id}
              onSelect={() => onSelect(state.id)}
              className={cn(
                MENU_ITEM_STYLE,
                'outline-none',
                isActive ? 'bg-foreground/7' : 'data-[selected=true]:bg-foreground/3'
              )}
            >
              <StateItemContent state={state} />
            </CommandPrimitive.Item>
          )
        })}
      </CommandPrimitive.List>
    </CommandPrimitive>
  )
}

// ============================================================================
// Helpers: Get icon/color for a state
// ============================================================================

export function getStateIcon(stateId: TodoStateId, states: TodoState[] = DEFAULT_TODO_STATES): React.ReactNode {
  const state = states.find(s => s.id === stateId)
  return state?.icon ?? <CircleDashed className={MENU_ICON_SIZE} />
}

export function getStateColor(stateId: TodoStateId, states: TodoState[] = DEFAULT_TODO_STATES): string | undefined {
  const state = states.find(s => s.id === stateId)
  return state?.color
}
