/**
 * Route Parser
 *
 * Parses route strings back into structured navigation objects.
 * Used by both the navigate() function and deep link handler.
 *
 * Supports two route formats:
 * - Legacy: tab/{type}[/{id}], sidebar/{filter}[/{id}], action/{name}[/{id}]
 * - Compound: {sidebar}[/{details-type}/{details-id}] - new hierarchical format
 */

import type {
  NavigationState,
  ChatFilter,
  SettingsSubpage,
  SourceCategory,
} from './types'

// =============================================================================
// Legacy Route Types
// =============================================================================

export type RouteType = 'tab' | 'action' | 'sidebar' | 'view'

export interface ParsedRoute {
  type: RouteType
  name: string
  id?: string
  params: Record<string, string>
}

// =============================================================================
// Compound Route Types (new format)
// =============================================================================

export type NavigatorType = 'chats' | 'sources' | 'settings'

export interface ParsedCompoundRoute {
  /** The navigator type */
  navigator: NavigatorType
  /** Chat filter (only for chats navigator) */
  chatFilter?: ChatFilter
  /** Details page info (null for empty state) */
  details: {
    type: string
    id: string
  } | null
}

// =============================================================================
// Compound Route Parsing
// =============================================================================

/**
 * Known sidebar prefixes that indicate a compound route
 */
const COMPOUND_ROUTE_PREFIXES = [
  'inbox', 'archive', 'flagged', 'agent', 'state', 'sources', 'settings'
]

/**
 * Check if a route is a compound route (new format)
 */
export function isCompoundRoute(route: string): boolean {
  const firstSegment = route.split('/')[0]
  return COMPOUND_ROUTE_PREFIXES.includes(firstSegment)
}

/**
 * Parse a compound route into structured navigation
 *
 * Examples:
 *   'inbox' -> { navigator: 'chats', chatFilter: { kind: 'inbox' }, details: null }
 *   'inbox/chat/abc123' -> { navigator: 'chats', chatFilter: { kind: 'inbox' }, details: { type: 'chat', id: 'abc123' } }
 *   'flagged/chat/abc123' -> { navigator: 'chats', chatFilter: { kind: 'flagged' }, details: { type: 'chat', id: 'abc123' } }
 *   'agent/my-agent/chat/abc123' -> { navigator: 'chats', chatFilter: { kind: 'agent', agentId: 'my-agent' }, details: { type: 'chat', id: 'abc123' } }
 *   'sources' -> { navigator: 'sources', details: null }
 *   'sources/source/github' -> { navigator: 'sources', details: { type: 'source', id: 'github' } }
 *   'settings' -> { navigator: 'settings', details: { type: 'general', id: 'general' } }
 *   'settings/shortcuts' -> { navigator: 'settings', details: { type: 'shortcuts', id: 'shortcuts' } }
 */
export function parseCompoundRoute(route: string): ParsedCompoundRoute | null {
  const segments = route.split('/').filter(Boolean)
  if (segments.length === 0) return null

  const first = segments[0]

  // Settings navigator
  if (first === 'settings') {
    const subpage = (segments[1] || 'general') as SettingsSubpage
    const validSubpages: SettingsSubpage[] = ['general', 'shortcuts', 'preferences']
    if (!validSubpages.includes(subpage)) return null
    return {
      navigator: 'settings',
      details: { type: subpage, id: subpage },
    }
  }

  // Sources navigator
  if (first === 'sources') {
    if (segments.length === 1) {
      return { navigator: 'sources', details: null }
    }
    // Category filter: sources/{category}
    const validCategories = ['local-files', 'online-sources', 'local-mcp']
    if (segments.length === 2 && validCategories.includes(segments[1])) {
      return {
        navigator: 'sources',
        details: { type: 'category', id: segments[1] },
      }
    }
    if (segments[1] === 'source') {
      // Handle agent-scoped sources: sources/source/{agentSlug}/{sourceSlug}
      if (segments.length >= 4) {
        return {
          navigator: 'sources',
          details: { type: 'source', id: `${segments[2]}/${segments[3]}` },
        }
      }
      // Workspace-level source: sources/source/{sourceSlug}
      if (segments[2]) {
        return {
          navigator: 'sources',
          details: { type: 'source', id: segments[2] },
        }
      }
    }
    return null
  }

  // Chats navigator (inbox, archive, flagged, agent, state)
  let chatFilter: ChatFilter
  let detailsStartIndex: number

  switch (first) {
    case 'inbox':
      chatFilter = { kind: 'inbox' }
      detailsStartIndex = 1
      break
    case 'archive':
      chatFilter = { kind: 'archive' }
      detailsStartIndex = 1
      break
    case 'flagged':
      chatFilter = { kind: 'flagged' }
      detailsStartIndex = 1
      break
    case 'agent':
      if (!segments[1]) return null
      chatFilter = { kind: 'agent', agentId: segments[1] }
      detailsStartIndex = 2
      break
    case 'state':
      if (!segments[1]) return null
      // Cast is safe because we're constructing from URL
      chatFilter = { kind: 'state', stateId: segments[1] as ChatFilter & { kind: 'state' } extends { stateId: infer T } ? T : never }
      detailsStartIndex = 2
      break
    default:
      return null
  }

  // Check for details
  if (segments.length > detailsStartIndex) {
    const detailsType = segments[detailsStartIndex]
    const detailsId = segments[detailsStartIndex + 1]
    if (detailsType === 'chat' && detailsId) {
      return {
        navigator: 'chats',
        chatFilter,
        details: { type: 'chat', id: detailsId },
      }
    }
  }

  return {
    navigator: 'chats',
    chatFilter,
    details: null,
  }
}

/**
 * Build a compound route string from parsed state
 */
export function buildCompoundRoute(parsed: ParsedCompoundRoute): string {
  if (parsed.navigator === 'settings') {
    const detailsType = parsed.details?.type || 'general'
    return detailsType === 'general' ? 'settings' : `settings/${detailsType}`
  }

  if (parsed.navigator === 'sources') {
    if (!parsed.details) return 'sources'
    return `sources/source/${parsed.details.id}`
  }

  // Chats navigator
  let base: string
  const filter = parsed.chatFilter
  if (!filter) return 'inbox'

  switch (filter.kind) {
    case 'inbox':
      base = 'inbox'
      break
    case 'archive':
      base = 'archive'
      break
    case 'flagged':
      base = 'flagged'
      break
    case 'agent':
      base = `agent/${filter.agentId}`
      break
    case 'state':
      base = `state/${filter.stateId}`
      break
    default:
      base = 'inbox'
  }

  if (!parsed.details) return base
  return `${base}/chat/${parsed.details.id}`
}

// =============================================================================
// Legacy Route Parsing
// =============================================================================

/**
 * Parse a route string into structured navigation (legacy format)
 *
 * Examples:
 *   'tab/settings' -> { type: 'tab', name: 'settings', params: {} }
 *   'tab/chat/abc123' -> { type: 'tab', name: 'chat', id: 'abc123', params: {} }
 *   'action/new-chat?agentId=x' -> { type: 'action', name: 'new-chat', params: { agentId: 'x' } }
 *   'sidebar/agent/my-agent' -> { type: 'sidebar', name: 'agent', id: 'my-agent', params: {} }
 */
export function parseRoute(route: string): ParsedRoute | null {
  try {
    // Check if this is a compound route
    if (isCompoundRoute(route)) {
      const compound = parseCompoundRoute(route)
      if (compound) {
        // Convert compound route to legacy ParsedRoute format for compatibility
        return convertCompoundToLegacy(compound)
      }
    }

    // Split route and query string
    const [pathPart, queryPart] = route.split('?')
    const segments = pathPart.split('/').filter(Boolean)

    if (segments.length < 2) {
      return null
    }

    const type = segments[0] as RouteType
    if (!['tab', 'action', 'sidebar'].includes(type)) {
      return null
    }

    const name = segments[1]
    const id = segments[2] // Optional ID segment
    const secondaryId = segments[3] // For source-info with agent slug

    // Parse query params
    const params: Record<string, string> = {}
    if (queryPart) {
      const searchParams = new URLSearchParams(queryPart)
      searchParams.forEach((value, key) => {
        params[key] = value
      })
    }

    // Handle special cases with path-based params
    // For source-info with agentSlug: tab/source-info/{agentSlug}/{sourceSlug}
    if (name === 'source-info' && secondaryId) {
      params.agentSlug = id!
      params.id = secondaryId
      return { type, name, id: secondaryId, params }
    }

    return { type, name, id, params }
  } catch {
    return null
  }
}

/**
 * Convert a parsed compound route to legacy ParsedRoute format
 */
function convertCompoundToLegacy(compound: ParsedCompoundRoute): ParsedRoute {
  // Settings -> tab/settings, tab/shortcuts, tab/preferences
  if (compound.navigator === 'settings') {
    const subpage = compound.details?.type || 'general'
    if (subpage === 'general') {
      return { type: 'view', name: 'settings', params: {} }
    }
    return { type: 'view', name: subpage, params: {} }
  }

  // Sources -> sidebar/sources or tab/source-info
  if (compound.navigator === 'sources') {
    if (!compound.details) {
      return { type: 'view', name: 'sources', params: {} }
    }
    // Handle category filter: sources/{category}
    if (compound.details.type === 'category') {
      return { type: 'view', name: 'sources', params: { category: compound.details.id } }
    }
    // Parse source ID which may include agent slug
    const sourceId = compound.details.id
    if (sourceId.includes('/')) {
      const [agentSlug, sourceSlug] = sourceId.split('/')
      return {
        type: 'view',
        name: 'source-info',
        id: sourceSlug,
        params: { agentSlug },
      }
    }
    return { type: 'view', name: 'source-info', id: sourceId, params: {} }
  }

  // Chats -> sidebar filter + optional chat details
  if (compound.chatFilter) {
    const filter = compound.chatFilter
    if (compound.details) {
      // Has a selected session
      return {
        type: 'view',
        name: 'chat',
        id: compound.details.id,
        params: {
          filter: filter.kind,
          ...(filter.kind === 'agent' ? { agentId: filter.agentId } : {}),
          ...(filter.kind === 'state' ? { stateId: filter.stateId } : {}),
        },
      }
    }
    // Just the filter, no session selected
    return {
      type: 'view',
      name: filter.kind,
      id: filter.kind === 'agent' ? filter.agentId : filter.kind === 'state' ? filter.stateId : undefined,
      params: {},
    }
  }

  // Fallback
  return { type: 'view', name: 'inbox', params: {} }
}

/**
 * Check if a string is a valid route
 */
export function isValidRoute(route: string): boolean {
  return parseRoute(route) !== null
}

/**
 * Convert a parsed route back to a route string
 */
export function stringifyRoute(parsed: ParsedRoute): string {
  let route = `${parsed.type}/${parsed.name}`

  if (parsed.id) {
    route += `/${parsed.id}`
  }

  const params = { ...parsed.params }
  // Remove id from params if it was in the path
  delete params.id

  if (Object.keys(params).length > 0) {
    const searchParams = new URLSearchParams(params)
    route += `?${searchParams.toString()}`
  }

  return route
}

// =============================================================================
// NavigationState Parsing (new unified system)
// =============================================================================

/**
 * Parse a route string directly to NavigationState (the unified state)
 *
 * This is the preferred way to parse routes - returns the unified state that
 * determines all 3 panels (sidebar, navigator, main content).
 *
 * Supports:
 * - Compound routes: inbox, inbox/chat/abc, sources, sources/source/github, settings/shortcuts
 * - Legacy tab routes: tab/chat/abc (converted to NavigationState)
 * - Legacy sidebar routes: sidebar/inbox (converted to NavigationState)
 *
 * Returns null for action routes (they don't map to a navigation state) and invalid routes.
 */
export function parseRouteToNavigationState(route: string): NavigationState | null {
  // First, check if this is a compound route
  if (isCompoundRoute(route)) {
    const compound = parseCompoundRoute(route)
    if (compound) {
      return convertCompoundToNavigationState(compound)
    }
  }

  // Parse as legacy route
  const parsed = parseRoute(route)
  if (!parsed) return null

  // Actions don't map to navigation state
  if (parsed.type === 'action') return null

  // Convert legacy routes to NavigationState
  return convertParsedRouteToNavigationState(parsed)
}

/**
 * Convert a ParsedCompoundRoute to NavigationState
 */
function convertCompoundToNavigationState(compound: ParsedCompoundRoute): NavigationState {
  // Settings
  if (compound.navigator === 'settings') {
    const subpage = (compound.details?.type || 'general') as SettingsSubpage
    return { navigator: 'settings', subpage }
  }

  // Sources
  if (compound.navigator === 'sources') {
    if (!compound.details) {
      return { navigator: 'sources', details: null }
    }
    // Handle category filter
    if (compound.details.type === 'category') {
      return {
        navigator: 'sources',
        category: compound.details.id as SourceCategory,
        details: null,
      }
    }
    // Parse source ID which may include agent slug
    const sourceId = compound.details.id
    if (sourceId.includes('/')) {
      const [agentSlug, sourceSlug] = sourceId.split('/')
      return {
        navigator: 'sources',
        details: { type: 'source', sourceSlug, agentSlug },
      }
    }
    return {
      navigator: 'sources',
      details: { type: 'source', sourceSlug: sourceId },
    }
  }

  // Chats
  const filter = compound.chatFilter || { kind: 'inbox' as const }
  if (compound.details) {
    return {
      navigator: 'chats',
      filter,
      details: { type: 'chat', sessionId: compound.details.id },
    }
  }
  return {
    navigator: 'chats',
    filter,
    details: null,
  }
}

/**
 * Convert a legacy ParsedRoute to NavigationState
 */
function convertParsedRouteToNavigationState(parsed: ParsedRoute): NavigationState | null {
  // Handle view routes (already converted from compound)
  if (parsed.type === 'view') {
    switch (parsed.name) {
      case 'settings':
        return { navigator: 'settings', subpage: 'general' }
      case 'shortcuts':
        return { navigator: 'settings', subpage: 'shortcuts' }
      case 'preferences':
        return { navigator: 'settings', subpage: 'preferences' }
      case 'sources':
        if (parsed.params.category) {
          return {
            navigator: 'sources',
            category: parsed.params.category as SourceCategory,
            details: null,
          }
        }
        return { navigator: 'sources', details: null }
      case 'source-info':
        if (parsed.id) {
          return {
            navigator: 'sources',
            details: {
              type: 'source',
              sourceSlug: parsed.id,
              agentSlug: parsed.params.agentSlug,
            },
          }
        }
        return { navigator: 'sources', details: null }
      case 'chat':
        if (parsed.id) {
          // Reconstruct filter from params
          const filterKind = (parsed.params.filter || 'inbox') as ChatFilter['kind']
          let filter: ChatFilter
          if (filterKind === 'agent' && parsed.params.agentId) {
            filter = { kind: 'agent', agentId: parsed.params.agentId }
          } else if (filterKind === 'state' && parsed.params.stateId) {
            filter = { kind: 'state', stateId: parsed.params.stateId }
          } else {
            filter = { kind: filterKind as 'inbox' | 'archive' | 'flagged' }
          }
          return {
            navigator: 'chats',
            filter,
            details: { type: 'chat', sessionId: parsed.id },
          }
        }
        return { navigator: 'chats', filter: { kind: 'inbox' }, details: null }
      case 'inbox':
        return {
          navigator: 'chats',
          filter: { kind: 'inbox' },
          details: null,
        }
      case 'archive':
        return {
          navigator: 'chats',
          filter: { kind: 'archive' },
          details: null,
        }
      case 'flagged':
        return {
          navigator: 'chats',
          filter: { kind: 'flagged' },
          details: null,
        }
      case 'agent':
        if (parsed.id) {
          return {
            navigator: 'chats',
            filter: { kind: 'agent', agentId: parsed.id },
            details: null,
          }
        }
        return { navigator: 'chats', filter: { kind: 'inbox' }, details: null }
      case 'state':
        if (parsed.id) {
          return {
            navigator: 'chats',
            filter: { kind: 'state', stateId: parsed.id },
            details: null,
          }
        }
        return { navigator: 'chats', filter: { kind: 'inbox' }, details: null }
      default:
        return null
    }
  }

  // Handle tab routes
  if (parsed.type === 'tab') {
    switch (parsed.name) {
      case 'settings':
        return { navigator: 'settings', subpage: 'general' }
      case 'shortcuts':
        return { navigator: 'settings', subpage: 'shortcuts' }
      case 'preferences':
        return { navigator: 'settings', subpage: 'preferences' }
      case 'chat':
        // Tab/chat without filter context - default to inbox
        if (parsed.id) {
          return {
            navigator: 'chats',
            filter: { kind: 'inbox' },
            details: { type: 'chat', sessionId: parsed.id },
          }
        }
        return { navigator: 'chats', filter: { kind: 'inbox' }, details: null }
      case 'source-info':
        if (parsed.id) {
          return {
            navigator: 'sources',
            details: {
              type: 'source',
              sourceSlug: parsed.id,
              agentSlug: parsed.params.agentSlug,
            },
          }
        }
        return { navigator: 'sources', details: null }
      default:
        return null
    }
  }

  // Handle sidebar routes
  if (parsed.type === 'sidebar') {
    switch (parsed.name) {
      case 'inbox':
        return { navigator: 'chats', filter: { kind: 'inbox' }, details: null }
      case 'archive':
        return { navigator: 'chats', filter: { kind: 'archive' }, details: null }
      case 'flagged':
        return { navigator: 'chats', filter: { kind: 'flagged' }, details: null }
      case 'agent':
        if (parsed.id) {
          return {
            navigator: 'chats',
            filter: { kind: 'agent', agentId: parsed.id },
            details: null,
          }
        }
        return { navigator: 'chats', filter: { kind: 'inbox' }, details: null }
      case 'state':
        if (parsed.id) {
          return {
            navigator: 'chats',
            filter: { kind: 'state', stateId: parsed.id },
            details: null,
          }
        }
        return { navigator: 'chats', filter: { kind: 'inbox' }, details: null }
      case 'sources':
        return { navigator: 'sources', details: null }
      default:
        return null
    }
  }

  return null
}

/**
 * Build a route string from NavigationState
 */
export function buildRouteFromNavigationState(state: NavigationState): string {
  if (state.navigator === 'settings') {
    return state.subpage === 'general' ? 'settings' : `settings/${state.subpage}`
  }

  if (state.navigator === 'sources') {
    let base = state.category ? `sources/${state.category}` : 'sources'
    if (state.details) {
      const { sourceSlug, agentSlug } = state.details
      if (agentSlug) {
        return `sources/source/${agentSlug}/${sourceSlug}`
      }
      return `sources/source/${sourceSlug}`
    }
    return base
  }

  // Chats
  const filter = state.filter
  let base: string
  switch (filter.kind) {
    case 'inbox':
      base = 'inbox'
      break
    case 'archive':
      base = 'archive'
      break
    case 'flagged':
      base = 'flagged'
      break
    case 'agent':
      base = `agent/${filter.agentId}`
      break
    case 'state':
      base = `state/${filter.stateId}`
      break
  }

  if (state.details) {
    return `${base}/chat/${state.details.sessionId}`
  }
  return base
}
