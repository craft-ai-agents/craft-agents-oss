import * as React from 'react'
import type { StatusConfig } from '@craft-agent/shared/statuses'
import { isEmoji, ICON_EXTENSIONS } from '@craft-agent/shared/utils/icon-constants'
import { statusIconCache, clearStatusIconCaches } from '@/lib/icon-cache'

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
 * Try to load an icon file, checking multiple extensions.
 * Returns { content, extension } or null if not found.
 */
async function tryLoadIconFile(
  workspaceId: string,
  statusId: string
): Promise<{ content: string; extension: string } | null> {
  for (const ext of ICON_EXTENSIONS) {
    const relativePath = `statuses/icons/${statusId}${ext}`
    const cacheKey = `${workspaceId}:${relativePath}`

    // Check cache first (using shared statusIconCache from lib/icon-cache)
    const cached = statusIconCache.get(cacheKey)
    if (cached) {
      return { content: cached, extension: ext }
    }

    // Try to load from filesystem
    try {
      const content = await window.electronAPI.readWorkspaceImage(workspaceId, relativePath)
      statusIconCache.set(cacheKey, content)
      return { content, extension: ext }
    } catch {
      // File doesn't exist, try next extension
      continue
    }
  }
  return null
}

/**
 * Resolve status icon to React.ReactNode with colorability info.
 * Handles emoji, auto-discovered files, and fallback.
 *
 * Icon resolution priority:
 * 1. Config icon (emoji set in config.json) - allows user override
 * 2. Local file (statuses/icons/{statusId}.svg, .png, etc.)
 * 3. Fallback bullet
 *
 * Returns { node, colorable } where:
 * - colorable=true: Icon uses currentColor, should inherit status color
 * - colorable=false: Icon has its own colors (emoji, image, hardcoded SVG)
 */
export async function resolveStatusIcon(
  statusId: string,
  icon: string | undefined,
  workspaceId: string,
  className: string = ICON_SIZE
): Promise<ResolvedIcon> {
  // Priority 1: Check if icon field is set in config (emoji takes precedence)
  // This allows users to override default file icons by setting "icon" in config.json
  if (icon && isEmoji(icon)) {
    return {
      node: <span className="text-[13px] leading-none">{icon}</span>,
      colorable: false,
    }
  }

  // Priority 2: Try to load local icon file (auto-discovered by ID)
  // This includes default icons created by ensureDefaultIconFiles() and downloaded URLs
  const iconFile = await tryLoadIconFile(workspaceId, statusId)
  if (iconFile) {
    if (iconFile.extension === '.svg') {
      const sanitized = sanitizeSvg(iconFile.content)
      const colorable = svgUsesCurrentColor(iconFile.content)
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
            src={iconFile.content}
            className={className}
            alt=""
            style={{ display: 'inline-block' }}
          />
        ),
        colorable: false,
      }
    }
  }

  // Priority 3: Fallback bullet - colorable
  return {
    node: <span className={className}>●</span>,
    colorable: true,
  }
}

/**
 * Hook to resolve status icon with loading state
 * Use this in components that need synchronous rendering with async icon loading
 */
export function useStatusIcon(
  statusId: string,
  icon: string | undefined,
  workspaceId: string,
  className: string = ICON_SIZE
): React.ReactNode {
  const [resolvedIcon, setResolvedIcon] = React.useState<React.ReactNode>(
    <span className={className}>●</span>
  )

  React.useEffect(() => {
    // Extract just the node from ResolvedIcon, discarding colorable info
    // (useStatusIcon is only used for simple icon rendering, not full status state)
    resolveStatusIcon(statusId, icon, workspaceId, className).then(resolved => setResolvedIcon(resolved.node))
  }, [statusId, icon, workspaceId, className])

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
  const resolvedIcon = await resolveStatusIcon(config.id, config.icon, workspaceId)

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
  clearStatusIconCaches()
}
