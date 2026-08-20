/**
 * Default Entity Colors
 *
 * Default color assignments for built-in entities (statuses, etc).
 * These are used when an entity config doesn't specify an explicit color.
 *
 * Moved from renderer's todo-states.tsx to shared module so both
 * backend validation and frontend rendering use the same defaults.
 */

import type { CustomColor, EntityColor } from './types.ts'

// ============================================================================
// Status Defaults
// ============================================================================

/**
 * Canonical palette for built-in Kanban-backed statuses.
 *
 * This is intentionally independent of semantic system tokens such as `info`.
 * Board columns use the light variants while status rendering resolves the
 * appropriate theme variant from the same definitions.
 */
export const DEFAULT_BUILTIN_STATUS_PALETTE = {
  backlog: { light: '#94a3b8', dark: '#cbd5e1' },
  todo: { light: '#3b82f6', dark: '#60a5fa' },
  'in-progress': { light: '#3b82f6', dark: '#60a5fa' },
  'needs-review': { light: '#f59e0b', dark: '#fbbf24' },
  done: { light: '#10b981', dark: '#34d399' },
} as const satisfies Record<string, CustomColor>

/** Default colors for all built-in statuses. */
export const DEFAULT_STATUS_COLORS: Record<string, EntityColor> = {
  ...DEFAULT_BUILTIN_STATUS_PALETTE,
  cancelled: 'foreground/50',
}

/** Fallback color for statuses without explicit color or known default */
export const DEFAULT_STATUS_FALLBACK: EntityColor = 'foreground/50'

/**
 * Get the default color for a status ID.
 * Returns the known default if the status is built-in, otherwise the fallback.
 */
export function getDefaultStatusColor(statusId: string): EntityColor {
  return DEFAULT_STATUS_COLORS[statusId] ?? DEFAULT_STATUS_FALLBACK
}
