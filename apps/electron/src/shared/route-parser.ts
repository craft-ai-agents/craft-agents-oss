/**
 * Route Parser
 *
 * Parses route strings back into structured navigation objects.
 * Used by both the navigate() function and deep link handler.
 *
 * Supports route formats:
 * - Action: action/{name}[/{id}] - Trigger side effects
 * - Compound: {filter}[/chat/{sessionId}] - View routes for full navigation state
 */

import type {
  NavigationState,
  ChatFilter,
  SettingsSubpage,
  SourceCategory,
} from './types'

// =============================================================================
// Route Types
// =============================================================================

export type RouteType = 'action' | 'view'

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
  /** Source category (only for sources navigator) */
  sourceCategory?: 'local-files' | 'online-sources' | 'local-mcp'
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
 * Known prefixes that indicate a compound route
 */
const COMPOUND_ROUTE_PREFIXES = [
  'allChats', 'flagged', 'state', 'sources', 'settings'
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
 *   'allChats' -> { navigator: 'chats', chatFilter: { kind: 'allChats' }, details: null }
 *   'allChats/chat/abc123' -> { navigator: 'chats', chatFilter: { kind: 'allChats' }, details: { type: 'chat', id: 'abc123' } }
 *   'flagged/chat/abc123' -> { navigator: 'chats', chatFilter: { kind: 'flagged' }, details: { type: 'chat', id: 'abc123' } }
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

    const validCategories = ['local-files', 'online-sources', 'local-mcp']
    const second = segments[1]

    // Check if second segment is a category
    if (validCategories.includes(second)) {
      const category = second as 'local-files' | 'online-sources' | 'local-mcp'

      // Category only: sources/{category}
      if (segments.length === 2) {
        return {
          navigator: 'sources',
          sourceCategory: category,
          details: { type: 'category', id: category },
        }
      }

      // Category with source: sources/{category}/source/{sourceSlug}
      if (segments.length >= 4 && segments[2] === 'source' && segments[3]) {
        return {
          navigator: 'sources',
          sourceCategory: category,
          details: { type: 'source', id: segments[3] },
        }
      }

      return null
    }

    // No category, direct source: sources/source/{sourceSlug}
    if (second === 'source' && segments[2]) {
      return {
        navigator: 'sources',
        details: { type: 'source', id: segments[2] },
      }
    }

    return null
  }

  // Chats navigator (allChats, flagged, state)
  let chatFilter: ChatFilter
  let detailsStartIndex: number

  switch (first) {
    case 'allChats':
      chatFilter = { kind: 'allChats' }
      detailsStartIndex = 1
      break
    case 'flagged':
      chatFilter = { kind: 'flagged' }
      detailsStartIndex = 1
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
  if (!filter) return 'allChats'

  switch (filter.kind) {
    case 'allChats':
      base = 'allChats'
      break
    case 'flagged':
      base = 'flagged'
      break
    case 'state':
      base = `state/${filter.stateId}`
      break
    default:
      base = 'allChats'
  }

  if (!parsed.details) return base
  return `${base}/chat/${parsed.details.id}`
}

// =============================================================================
// Route Parsing
// =============================================================================

/**
 * Parse a route string into structured navigation
 *
 * Examples:
 *   'allChats' -> { type: 'view', name: 'allChats', params: {} }
 *   'allChats/chat/abc123' -> { type: 'view', name: 'chat', id: 'abc123', params: { filter: 'allChats' } }
 *   'settings/shortcuts' -> { type: 'view', name: 'shortcuts', params: {} }
 *   'action/new-chat' -> { type: 'action', name: 'new-chat', params: {} }
 */
export function parseRoute(route: string): ParsedRoute | null {
  try {
    // Check if this is a compound route (preferred format)
    if (isCompoundRoute(route)) {
      const compound = parseCompoundRoute(route)
      if (compound) {
        return convertCompoundToViewRoute(compound)
      }
    }

    // Parse action routes: action/{name}[/{id}]
    const [pathPart, queryPart] = route.split('?')
    const segments = pathPart.split('/').filter(Boolean)

    if (segments.length < 2) {
      return null
    }

    const type = segments[0]
    if (type !== 'action') {
      return null
    }

    const name = segments[1]
    const id = segments[2]

    // Parse query params
    const params: Record<string, string> = {}
    if (queryPart) {
      const searchParams = new URLSearchParams(queryPart)
      searchParams.forEach((value, key) => {
        params[key] = value
      })
    }

    return { type: 'action', name, id, params }
  } catch {
    return null
  }
}

/**
 * Convert a parsed compound route to ParsedRoute format (type: 'view')
 */
function convertCompoundToViewRoute(compound: ParsedCompoundRoute): ParsedRoute {
  // Settings
  if (compound.navigator === 'settings') {
    const subpage = compound.details?.type || 'general'
    if (subpage === 'general') {
      return { type: 'view', name: 'settings', params: {} }
    }
    return { type: 'view', name: subpage, params: {} }
  }

  // Sources
  if (compound.navigator === 'sources') {
    if (!compound.details) {
      return { type: 'view', name: 'sources', params: {} }
    }
    if (compound.details.type === 'category') {
      return { type: 'view', name: 'sources', params: { category: compound.details.id } }
    }
    return { type: 'view', name: 'source-info', id: compound.details.id, params: {} }
  }

  // Chats
  if (compound.chatFilter) {
    const filter = compound.chatFilter
    if (compound.details) {
      return {
        type: 'view',
        name: 'chat',
        id: compound.details.id,
        params: {
          filter: filter.kind,
          ...(filter.kind === 'state' ? { stateId: filter.stateId } : {}),
        },
      }
    }
    return {
      type: 'view',
      name: filter.kind,
      id: filter.kind === 'state' ? filter.stateId : undefined,
      params: {},
    }
  }

  return { type: 'view', name: 'allChats', params: {} }
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
 * - Compound routes: allChats, allChats/chat/abc, sources, sources/source/github, settings/shortcuts
 *
 * Returns null for action routes (they don't map to a navigation state) and invalid routes.
 */
export function parseRouteToNavigationState(route: string): NavigationState | null {
  // Parse compound routes
  if (isCompoundRoute(route)) {
    const compound = parseCompoundRoute(route)
    if (compound) {
      return convertCompoundToNavigationState(compound)
    }
  }

  // Parse as route (may be action or view)
  const parsed = parseRoute(route)
  if (!parsed) return null

  // Actions don't map to navigation state
  if (parsed.type === 'action') return null

  // Convert view routes to NavigationState
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
    const category = compound.sourceCategory

    if (!compound.details) {
      return { navigator: 'sources', category, details: null }
    }
    // Handle category filter (no source selected)
    if (compound.details.type === 'category') {
      return {
        navigator: 'sources',
        category: compound.details.id as SourceCategory,
        details: null,
      }
    }
    // Source selected - preserve category if present
    return {
      navigator: 'sources',
      category,
      details: { type: 'source', sourceSlug: compound.details.id },
    }
  }

  // Chats
  const filter = compound.chatFilter || { kind: 'allChats' as const }
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
 * Convert a ParsedRoute (view type) to NavigationState
 */
function convertParsedRouteToNavigationState(parsed: ParsedRoute): NavigationState | null {
  // Only handle view routes (compound routes converted to view type)
  if (parsed.type !== 'view') {
    return null
  }

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
          },
        }
      }
      return { navigator: 'sources', details: null }
    case 'chat':
      if (parsed.id) {
        // Reconstruct filter from params
        const filterKind = (parsed.params.filter || 'allChats') as ChatFilter['kind']
        let filter: ChatFilter
        if (filterKind === 'state' && parsed.params.stateId) {
          filter = { kind: 'state', stateId: parsed.params.stateId }
        } else {
          filter = { kind: filterKind as 'allChats' | 'flagged' }
        }
        return {
          navigator: 'chats',
          filter,
          details: { type: 'chat', sessionId: parsed.id },
        }
      }
      return { navigator: 'chats', filter: { kind: 'allChats' }, details: null }
    case 'allChats':
      return {
        navigator: 'chats',
        filter: { kind: 'allChats' },
        details: null,
      }
    case 'flagged':
      return {
        navigator: 'chats',
        filter: { kind: 'flagged' },
        details: null,
      }
    case 'state':
      if (parsed.id) {
        return {
          navigator: 'chats',
          filter: { kind: 'state', stateId: parsed.id },
          details: null,
        }
      }
      return { navigator: 'chats', filter: { kind: 'allChats' }, details: null }
    default:
      return null
  }
}

/**
 * Build a route string from NavigationState
 */
export function buildRouteFromNavigationState(state: NavigationState): string {
  if (state.navigator === 'settings') {
    return state.subpage === 'general' ? 'settings' : `settings/${state.subpage}`
  }

  if (state.navigator === 'sources') {
    const base = state.category ? `sources/${state.category}` : 'sources'
    if (state.details) {
      // Include category in URL if present: sources/{category}/source/{slug}
      if (state.category) {
        return `sources/${state.category}/source/${state.details.sourceSlug}`
      }
      return `sources/source/${state.details.sourceSlug}`
    }
    return base
  }

  // Chats
  const filter = state.filter
  let base: string
  switch (filter.kind) {
    case 'allChats':
      base = 'allChats'
      break
    case 'flagged':
      base = 'flagged'
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
