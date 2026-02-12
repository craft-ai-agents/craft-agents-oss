/**
 * MCP App Widget Detection Utilities
 *
 * Extracts MCP Apps widget metadata from ActivityItem content JSON.
 * Widgets are identified by _meta["mcp-use/widget"].type === "mcpApps".
 */

import type { ActivityItem } from '../chat/TurnCard'

export interface McpAppWidgetData {
  /** The widget HTML content */
  html: string
  /** Display name for the widget */
  name: string
  /** CSP metadata for iframe sandboxing */
  csp?: {
    connectDomains?: string[]
    resourceDomains?: string[]
    baseUriDomains?: string[]
  }
  /** Widget props from metadata */
  props?: Record<string, unknown>
  /** Resource URI from the tool result */
  resourceUri?: string
  /** Whether widget is in dev mode (use permissive CSP) */
  dev?: boolean
  /** Tool input arguments */
  toolInput?: Record<string, unknown>
  /** Tool output/result content */
  toolOutput?: unknown
  /** The source activity */
  activity: ActivityItem
}

// Cache positive results only — null results are not cached because activity
// content may not be available yet during streaming (tool_start arrives before
// tool_result). Caching null would permanently block widget detection.
const widgetCache = new Map<string, McpAppWidgetData>()

/**
 * Extract MCP Apps widget data from an activity item.
 * Returns null if the activity is not an MCP Apps widget.
 */
export function extractMcpAppWidget(activity: ActivityItem): McpAppWidgetData | null {
  const cached = widgetCache.get(activity.id)
  if (cached) return cached

  const result = extractMcpAppWidgetUncached(activity)
  if (result) {
    widgetCache.set(activity.id, result)
  }
  return result
}

function extractMcpAppWidgetUncached(activity: ActivityItem): McpAppWidgetData | null {
  // Only process completed tool activities with content
  if (activity.type !== 'tool' || !activity.content) return null

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(activity.content)
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== 'object') return null

  // Check for _meta["mcp-use/widget"]
  const meta = parsed._meta as Record<string, unknown> | undefined
  if (!meta) return null

  const widgetMeta = meta['mcp-use/widget'] as Record<string, unknown> | undefined
  if (!widgetMeta) return null
  // Accept both "mcpApps" and "appsSdk" widget types
  if (widgetMeta.type !== 'mcpApps' && widgetMeta.type !== 'appsSdk') return null

  const html = widgetMeta.html as string | undefined
  if (!html) return null

  // CSP can be in _meta["mcp-use/widget"].csp or _meta.ui.csp
  const uiMeta = meta.ui as Record<string, unknown> | undefined
  const csp = (widgetMeta.csp || uiMeta?.csp) as McpAppWidgetData['csp'] | undefined

  // Props can be in _meta["mcp-use/widget"].props or _meta["mcp-use/props"]
  const props = (widgetMeta.props || meta['mcp-use/props']) as Record<string, unknown> | undefined

  return {
    html,
    name: (widgetMeta.name as string) || activity.displayName || activity.toolName || 'MCP App',
    csp,
    props,
    resourceUri: (widgetMeta.resourceUri || uiMeta?.resourceUri) as string | undefined,
    dev: widgetMeta.dev === true,
    toolInput: activity.toolInput,
    toolOutput: parsed,
    activity,
  }
}

/**
 * Check if any activities in the list contain MCP Apps widgets.
 */
export function hasMcpAppWidgets(activities: ActivityItem[]): boolean {
  return activities.some(a => extractMcpAppWidget(a) !== null)
}

/**
 * Derive a server ID from a tool name pattern like `mcp__{serverName}__{tool}`.
 * Returns the serverName portion for origin isolation.
 */
export function deriveServerId(activity: ActivityItem): string {
  const toolName = activity.toolName || ''
  const match = toolName.match(/^mcp__([^_]+)__/)
  if (match && match[1]) return match[1]
  // Fallback to a hash of the tool name
  return toolName.replace(/[^a-zA-Z0-9]/g, '-') || 'unknown'
}
