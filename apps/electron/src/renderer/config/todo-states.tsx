import * as React from 'react'
import type { StatusConfig } from '@craft-agent/shared/statuses'
import { isEmoji } from '@craft-agent/shared/utils/icon-constants'
import { resolveEntityColor, getDefaultStatusColor } from '@craft-agent/shared/colors'
import type { EntityColor } from '@craft-agent/shared/colors'
import { StatusIcon } from '@/components/ui/status-icon'
import { iconCache } from '@/lib/icon-cache'

// ============================================================================
// Types
// ============================================================================

// Dynamic status ID (any string now)
export type TodoStateId = string

export interface TodoStateConfig {
  id: string
  label: string
  color?: EntityColor
}

export interface TodoState extends TodoStateConfig {
  /**
   * Resolved CSS color string for inline style application.
   * System colors resolve to var(--name) or color-mix(...).
   * Custom colors resolve to the appropriate light/dark hex value.
   */
  resolvedColor: string
  icon: React.ReactNode
  /**
   * Whether the icon responds to color styling (uses currentColor).
   * - true: SVGs with currentColor - apply status color
   * - false: Emojis, images, SVGs with hardcoded colors - render at full opacity
   */
  iconColorable: boolean
  category?: 'open' | 'closed'
  isFixed?: boolean
  isDefault?: boolean
}

// ============================================================================
// Status → TodoState Conversion
// ============================================================================

/**
 * Convert StatusConfig to TodoState.
 * Resolves EntityColor to a CSS color string for inline style use.
 * System colors (e.g., "accent") resolve to CSS variable references that
 * auto-adapt to light/dark theme. Custom colors use isDark to pick the right value.
 *
 * Colorability is determined synchronously:
 * - Emoji icons → not colorable (they have their own colors)
 * - Everything else (SVGs, fallback) → colorable (uses currentColor)
 */
export function statusConfigToTodoState(
  config: StatusConfig,
  workspaceId: string,
  isDark: boolean
): TodoState {
  // Emojis have their own colors and don't respond to CSS color inheritance.
  // SVGs with currentColor and the fallback Circle icon are colorable.
  const iconColorable = !isEmoji(config.icon)

  // Resolve EntityColor → CSS color string for inline style
  const entityColor = config.color ?? getDefaultStatusColor(config.id)
  const resolvedColor = resolveEntityColor(entityColor, isDark)

  return {
    id: config.id,
    label: config.label,
    color: config.color,
    resolvedColor,
    icon: (
      <StatusIcon
        statusId={config.id}
        icon={config.icon}
        workspaceId={workspaceId}
        size="xs"
        chromeless={!iconColorable}
      />
    ),
    iconColorable,
    category: config.category,
    isFixed: config.isFixed,
    isDefault: config.isDefault,
  }
}

/**
 * Convert array of StatusConfig to TodoState[]
 */
export function statusConfigsToTodoStates(
  configs: StatusConfig[],
  workspaceId: string,
  isDark: boolean
): TodoState[] {
  return configs.map(c => statusConfigToTodoState(c, workspaceId, isDark))
}

// ============================================================================
// Helper Functions (updated to work with dynamic states)
// ============================================================================

/**
 * Get the icon for a todo state
 */
export function getStateIcon(
  stateId: string,
  states: TodoState[]
): React.ReactNode {
  const state = states.find(s => s.id === stateId)
  return state?.icon ?? <span className="h-3.5 w-3.5">●</span>
}

/**
 * Get the resolved CSS color for a todo state (ready for inline style)
 */
export function getStateColor(
  stateId: string,
  states: TodoState[]
): string | undefined {
  return states.find(s => s.id === stateId)?.resolvedColor
}

/**
 * Get the label for a todo state
 */
export function getStateLabel(
  stateId: string,
  states: TodoState[]
): string {
  const state = states.find(s => s.id === stateId)
  return state?.label ?? stateId
}

/**
 * Get a complete state object by ID
 */
export function getState(
  stateId: string,
  states: TodoState[]
): TodoState | undefined {
  return states.find(s => s.id === stateId)
}

/**
 * Clear status icon cache (useful when statuses are updated).
 * Clears status-prefixed entries from the unified icon cache.
 */
export function clearIconCache(): void {
  for (const key of iconCache.keys()) {
    if (key.startsWith('status:')) iconCache.delete(key)
  }
}
