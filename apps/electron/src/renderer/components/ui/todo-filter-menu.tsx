import * as React from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import { cn } from '@/lib/utils'
import {
  type TodoStateId,
  type TodoState,
  getStateIcon,
  getStateColor,
} from '@/config/todo-states'

// Re-export types for backwards compatibility
export { type TodoStateId, type TodoState, getStateIcon, getStateColor }

// ============================================================================
// Shared Styles (matching slash-command-menu)
// ============================================================================

const MENU_CONTAINER_STYLE = 'min-w-[180px] overflow-hidden rounded-[8px] bg-background text-foreground shadow-modal-small'
const MENU_LIST_STYLE = 'max-h-[240px] overflow-y-auto p-1 [&_[cmdk-list-sizer]]:space-y-px'
const MENU_ITEM_STYLE = 'flex cursor-pointer select-none items-center gap-3 rounded-[6px] px-3 py-1.5 text-[13px]'

// ============================================================================
// StateItemContent - Shared item rendering
// ============================================================================

function StateItemContent({ state }: { state: TodoState }) {
  // Only apply color styling if the icon is colorable (uses currentColor)
  // Emojis and images should render at full opacity with their own colors
  const applyColor = state.iconColorable

  return (
    <>
      <span
        className="shrink-0 flex items-center"
        style={applyColor ? { color: state.resolvedColor } : undefined}
      >
        {state.icon}
      </span>
      <div className="flex-1 min-w-0">{state.label}</div>
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
  const [filter, setFilter] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)

  // Focus input when menu opens
  React.useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus()
    }, 0)
    return () => clearTimeout(timer)
  }, [])

  // Find default value - prefer active state, otherwise first item
  const defaultValue = activeState || states[0]?.id

  return (
    <CommandPrimitive
      className={cn(MENU_CONTAINER_STYLE, className)}
      defaultValue={defaultValue}
    >
      <div className="border-b border-border/50 px-3 py-2">
        <CommandPrimitive.Input
          ref={inputRef}
          value={filter}
          onValueChange={setFilter}
          placeholder="Filter statuses..."
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
        />
      </div>
      <CommandPrimitive.List className={MENU_LIST_STYLE}>
        <CommandPrimitive.Empty className="py-3 text-center text-sm text-muted-foreground">
          No status found
        </CommandPrimitive.Empty>
        {states.map((state) => {
          const isActive = activeState === state.id
          return (
            <CommandPrimitive.Item
              key={state.id}
              value={state.label}
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
