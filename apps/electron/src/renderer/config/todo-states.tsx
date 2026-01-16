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
  color?: string
}

// ============================================================================
// Default Status Colors (design system semantic colors)
// ============================================================================

/**
 * Default color mapping for built-in statuses.
 * Uses Tailwind classes that map to our design system semantic colors.
 * Custom statuses without a color will fall back to 'text-foreground/50'.
 */
const DEFAULT_STATUS_COLORS: Record<string, string> = {
  'backlog': 'text-foreground/50',   // Muted - not yet planned
  'todo': 'text-foreground/50',       // Muted - ready to work on
  'in-progress': 'text-success',     // Green - active work (kept for existing configs)
  'needs-review': 'text-info',       // Amber - attention needed
  'done': 'text-accent',             // Purple - completed
  'cancelled': 'text-foreground/50', // Muted - inactive
}

/** Fallback color for custom statuses without explicit color */
const DEFAULT_FALLBACK_COLOR = 'text-foreground/50'

/**
 * Get the effective color for a status.
 * Returns the explicit color if set, otherwise the design system default.
 */
export function getDefaultStatusColor(statusId: string): string {
  return DEFAULT_STATUS_COLORS[statusId] ?? DEFAULT_FALLBACK_COLOR
}

export interface TodoState extends TodoStateConfig {
  /** Color is always resolved (either from config or design system default) */
  color: string
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

/** Result from resolving a status icon */
interface ResolvedIcon {
  node: React.ReactNode
  /** True if icon uses currentColor and should inherit status color */
  colorable: boolean
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
 * Check if an SVG uses currentColor (meaning it should inherit the status color).
 * SVGs with hardcoded colors should render at full opacity.
 */
function svgUsesCurrentColor(svgContent: string): boolean {
  // Check for currentColor in fill or stroke attributes
  return svgContent.includes('currentColor')
}

/**
 * Resolve status icon to React.ReactNode with colorability info.
 * Handles both emoji and file-based icons.
 *
 * Returns { node, colorable } where:
 * - colorable=true: Icon uses currentColor, should inherit status color
 * - colorable=false: Icon has its own colors (emoji, image, hardcoded SVG)
 */
export async function resolveStatusIcon(
  icon: StatusIcon,
  workspaceId: string,
  className: string = ICON_SIZE
): Promise<ResolvedIcon> {
  switch (icon.type) {
    case 'emoji':
      // Emojis have their own colors - never apply status color
      return {
        node: <span className="text-[13px] leading-none">{icon.value}</span>,
        colorable: false,
      }

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
          // Fallback to bullet - colorable since it's just text
          return {
            node: <span className={className}>●</span>,
            colorable: true,
          }
        }
      }

      // Detect file type by extension
      if (icon.value.endsWith('.svg')) {
        const sanitized = sanitizeSvg(fileContent)
        const colorable = svgUsesCurrentColor(fileContent)
        return {
          node: (
            <div
              className={className}
              dangerouslySetInnerHTML={{ __html: sanitized }}
              style={{ display: 'inline-block' }}
            />
          ),
          colorable,
        }
      } else {
        // PNG, JPG, etc. - images have their own colors
        return {
          node: (
            <img
              src={fileContent}
              className={className}
              alt=""
              style={{ display: 'inline-block' }}
            />
          ),
          colorable: false,
        }
      }
    }

    default:
      // Fallback bullet - colorable
      return {
        node: <span className={className}>●</span>,
        colorable: true,
      }
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
    // Extract just the node from ResolvedIcon, discarding colorable info
    // (useStatusIcon is only used for simple icon rendering, not full status state)
    resolveStatusIcon(icon, workspaceId, className).then(resolved => setResolvedIcon(resolved.node))
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
  const resolvedIcon = await resolveStatusIcon(config.icon, workspaceId)

  return {
    id: config.id,
    label: config.label,
    // Use explicit color if provided, otherwise fall back to design system default
    color: config.color ?? getDefaultStatusColor(config.id),
    icon: resolvedIcon.node,
    iconColorable: resolvedIcon.colorable,
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
