import * as React from 'react'
import type { StatusConfig, StatusIcon } from '@craft-agent/shared/statuses'

// ============================================================================
// Types
// ============================================================================

// Dynamic status ID (any string now)
export type TodoStateId = string

export interface TodoStateConfig {
  id: string
  label: string
  color: string
  shortcut?: string
}

export interface TodoState extends TodoStateConfig {
  icon: React.ReactNode
  category?: 'open' | 'closed'
  isFixed?: boolean
  isDefault?: boolean
}

// ============================================================================
// Icon size constant
// ============================================================================

const ICON_SIZE = 'h-3.5 w-3.5'

// ============================================================================
// Icon Cache (to avoid re-reading files on every render)
// ============================================================================

const iconCache = new Map<string, string>()

/**
 * Sanitize SVG content (basic XSS prevention)
 * Removes script tags and event handlers
 */
function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/on\w+="[^"]*"/gi, '')
    .replace(/on\w+='[^']*'/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/\s+width="[^"]*"/gi, '')      // Remove width attribute
    .replace(/\s+height="[^"]*"/gi, '')     // Remove height attribute
}

/**
 * Resolve status icon to React.ReactNode
 * Handles both emoji and file-based icons
 */
export async function resolveStatusIcon(
  icon: StatusIcon,
  workspaceId: string,
  className: string = ICON_SIZE
): Promise<React.ReactNode> {
  switch (icon.type) {
    case 'emoji':
      return <span className={className}>{icon.value}</span>

    case 'file': {
      // Check cache first
      const relativePath = `statuses/icons/${icon.value}`
      const cacheKey = `${workspaceId}:${relativePath}`
      let fileContent = iconCache.get(cacheKey)

      if (!fileContent) {
        try {
          fileContent = await window.electronAPI.readWorkspaceImage(workspaceId, relativePath)
          iconCache.set(cacheKey, fileContent)
        } catch (error) {
          console.error(`[resolveStatusIcon] Failed to load icon ${icon.value}:`, error)
          // Fallback to empty span
          return <span className={className}>●</span>
        }
      }

      // Detect file type by extension
      if (icon.value.endsWith('.svg')) {
        const sanitized = sanitizeSvg(fileContent)
        return (
          <div
            className={className}
            dangerouslySetInnerHTML={{ __html: sanitized }}
            style={{ display: 'inline-block' }}
          />
        )
      } else {
        // PNG, JPG, etc. - readWorkspaceImage returns a data URL
        return (
          <img
            src={fileContent}
            className={className}
            alt=""
            style={{ display: 'inline-block' }}
          />
        )
      }
    }

    default:
      // Fallback
      return <span className={className}>●</span>
  }
}

/**
 * Synchronous version that returns a placeholder while loading
 * Use this in components that can't handle async rendering
 */
export function resolveStatusIconSync(
  icon: StatusIcon,
  workspaceId: string,
  className: string = ICON_SIZE
): React.ReactNode {
  const [resolvedIcon, setResolvedIcon] = React.useState<React.ReactNode>(
    <span className={className}>●</span>
  )

  React.useEffect(() => {
    resolveStatusIcon(icon, workspaceId, className).then(setResolvedIcon)
  }, [icon, workspaceId, className])

  return resolvedIcon
}

/**
 * Convert StatusConfig to TodoState with resolved icon
 * This is async because icon loading may require IPC
 */
export async function statusConfigToTodoState(
  config: StatusConfig,
  workspaceId: string
): Promise<TodoState> {
  const icon = await resolveStatusIcon(config.icon, workspaceId)

  return {
    id: config.id,
    label: config.label,
    color: config.color,
    shortcut: config.shortcut,
    icon,
    category: config.category,
    isFixed: config.isFixed,
    isDefault: config.isDefault,
  }
}

/**
 * Convert array of StatusConfig to TodoState[]
 */
export async function statusConfigsToTodoStates(
  configs: StatusConfig[],
  workspaceId: string
): Promise<TodoState[]> {
  return Promise.all(configs.map(c => statusConfigToTodoState(c, workspaceId)))
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
  return state?.icon ?? <span className={ICON_SIZE}>●</span>
}

/**
 * Get the color class for a todo state
 */
export function getStateColor(
  stateId: string,
  states: TodoState[]
): string | undefined {
  return states.find(s => s.id === stateId)?.color
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
 * Get the shortcut for a todo state
 */
export function getStateShortcut(
  stateId: string,
  states: TodoState[]
): string | undefined {
  return states.find(s => s.id === stateId)?.shortcut
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
 * Clear icon cache (useful when statuses are updated)
 */
export function clearIconCache(): void {
  iconCache.clear()
}
