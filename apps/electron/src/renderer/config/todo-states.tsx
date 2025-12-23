import * as React from 'react'
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

export interface TodoStateConfig {
  id: TodoStateId
  label: string
  color: string
  shortcut?: string
}

export interface TodoState extends TodoStateConfig {
  icon: React.ReactNode
}

// ============================================================================
// Icon size constant
// ============================================================================

const ICON_SIZE = 'h-3.5 w-3.5'

// ============================================================================
// Default State Configurations
// Structure supports future user customization (colors, labels, shortcuts)
// ============================================================================

export const DEFAULT_TODO_STATES: TodoState[] = [
  {
    id: 'todo',
    label: 'Todo',
    icon: <CircleDashed className={ICON_SIZE} />,
    color: 'text-muted-foreground',
    shortcut: 't',
  },
  {
    id: 'in-progress',
    label: 'In Progress',
    icon: <CircleProgress className={ICON_SIZE} />,
    color: 'text-blue-500',
    shortcut: 'p',
  },
  {
    id: 'needs-review',
    label: 'Needs Review',
    icon: <CircleEye className={ICON_SIZE} />,
    color: 'text-amber-500',
    shortcut: 'v',
  },
  {
    id: 'done',
    label: 'Done',
    icon: <CircleCheckFilled className={ICON_SIZE} />,
    color: 'text-[#9570BE]',
    shortcut: 'd',
  },
  {
    id: 'cancelled',
    label: 'Cancelled',
    icon: <CircleXFilled className={ICON_SIZE} />,
    color: 'text-muted-foreground/60',
    shortcut: 'x',
  },
]

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the icon for a todo state
 */
export function getStateIcon(
  stateId: TodoStateId,
  states: TodoState[] = DEFAULT_TODO_STATES
): React.ReactNode {
  const state = states.find(s => s.id === stateId)
  return state?.icon ?? <CircleDashed className={ICON_SIZE} />
}

/**
 * Get the color class for a todo state
 */
export function getStateColor(
  stateId: TodoStateId,
  states: TodoState[] = DEFAULT_TODO_STATES
): string | undefined {
  const state = states.find(s => s.id === stateId)
  return state?.color
}

/**
 * Get the label for a todo state
 */
export function getStateLabel(
  stateId: TodoStateId,
  states: TodoState[] = DEFAULT_TODO_STATES
): string {
  const state = states.find(s => s.id === stateId)
  return state?.label ?? stateId
}

/**
 * Get the shortcut for a todo state
 */
export function getStateShortcut(
  stateId: TodoStateId,
  states: TodoState[] = DEFAULT_TODO_STATES
): string | undefined {
  const state = states.find(s => s.id === stateId)
  return state?.shortcut
}

/**
 * Get a complete state object by ID
 */
export function getState(
  stateId: TodoStateId,
  states: TodoState[] = DEFAULT_TODO_STATES
): TodoState | undefined {
  return states.find(s => s.id === stateId)
}
