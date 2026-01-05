import * as React from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import { cn } from '@/lib/utils'
import {
  type TodoStateId,
  type TodoState,
  getStateIcon,
  getStateColor,
} from '@/config/todo-states'

/** Check if a string is a hex color code (e.g., #3B82F6) */
function isHexColor(str: string | undefined): boolean {
  return !!str && /^#[0-9A-Fa-f]{6}$/.test(str)
}

// Re-export types for backwards compatibility
export { type TodoStateId, type TodoState, getStateIcon, getStateColor }

// ============================================================================
// Shared Styles (matching slash-command-menu)
// ============================================================================

const MENU_CONTAINER_STYLE = 'min-w-[140px] overflow-hidden rounded-[8px] bg-background text-foreground shadow-modal-small'
const MENU_LIST_STYLE = 'max-h-[240px] overflow-y-auto p-1 [&_[cmdk-list-sizer]]:space-y-px'
const MENU_ITEM_STYLE = 'flex cursor-pointer select-none items-center gap-3 rounded-[6px] px-3 py-1.5 text-[13px]'
const MENU_ITEM_SELECTED = 'bg-accent text-accent-foreground'

// ============================================================================
// StateItemContent - Shared item rendering
// ============================================================================

function StateItemContent({ state }: { state: TodoState }) {
  return (
    <>
      <span
        className={cn("shrink-0 flex items-center mt-px", !isHexColor(state.color) && (state.color || "text-muted-foreground"))}
        style={isHexColor(state.color) ? { color: state.color } : undefined}
      >
        {state.icon}
      </span>
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
  states = [],
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

