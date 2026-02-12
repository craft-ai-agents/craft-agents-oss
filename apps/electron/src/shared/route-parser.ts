/**
 * Route Parser
 *
 * Parses route strings back into structured navigation objects.
 * Used by both the navigate() function and deep link handler.
 *
 * Supports route formats:
 * - Action: action/{name}[/{id}] - Trigger side effects
 * - Compound: {filter}[/session/{sessionId}] - View routes for full navigation state
 */

import type {
  NavigationState,
  SessionFilter,
  SourceFilter,
  RightSidebarPanel,
  ProjectsNavigationState,
  ProjectNavigationState,
} from './types'
import { isValidSettingsSubpage, type SettingsSubpage } from './settings-registry'

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

export type NavigatorType = 'sessions' | 'sources' | 'skills' | 'settings' | 'projects' | 'project'

export interface ParsedCompoundRoute {
  /** The navigator type */
  navigator: NavigatorType
  /** Session filter (only for sessions navigator) */
  sessionFilter?: SessionFilter
  /** Source filter (only for sources navigator) */
  sourceFilter?: SourceFilter
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
  'allSessions', 'flagged', 'archived', 'state', 'label', 'view', 'sources', 'skills', 'settings', 'projects', 'project'
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
 *   'allSessions' -> { navigator: 'sessions', sessionFilter: { kind: 'allSessions' }, details: null }
 *   'allSessions/session/abc123' -> { navigator: 'sessions', sessionFilter: { kind: 'allSessions' }, details: { type: 'session', id: 'abc123' } }
 *   'flagged/session/abc123' -> { navigator: 'sessions', sessionFilter: { kind: 'flagged' }, details: { type: 'session', id: 'abc123' } }
 *   'sources' -> { navigator: 'sources', details: null }
 *   'sources/api' -> { navigator: 'sources', sourceFilter: { kind: 'type', sourceType: 'api' }, details: null }
 *   'sources/mcp' -> { navigator: 'sources', sourceFilter: { kind: 'type', sourceType: 'mcp' }, details: null }
 *   'sources/local' -> { navigator: 'sources', sourceFilter: { kind: 'type', sourceType: 'local' }, details: null }
 *   'sources/source/github' -> { navigator: 'sources', details: { type: 'source', id: 'github' } }
 *   'sources/api/source/gmail' -> { navigator: 'sources', sourceFilter: { kind: 'type', sourceType: 'api' }, details: { type: 'source', id: 'gmail' } }
 *   'settings' -> { navigator: 'settings', details: { type: 'app', id: 'app' } }
 *   'settings/shortcuts' -> { navigator: 'settings', details: { type: 'shortcuts', id: 'shortcuts' } }
 */
export function parseCompoundRoute(route: string): ParsedCompoundRoute | null {
  const segments = route.split('/').filter(Boolean)
  if (segments.length === 0) return null

  const first = segments[0]

  // Projects navigator (list view)
  if (first === 'projects') {
    if (segments.length === 1) {
      return { navigator: 'projects', details: null }
    }
    // projects/project/{projectSlug}
    if (segments[1] === 'project' && segments[2]) {
      return {
        navigator: 'projects',
        details: { type: 'project', id: segments[2] },
      }
    }
    return null
  }

  // Single project navigator
  if (first === 'project') {
    if (!segments[1]) return null
    const projectSlug = segments[1]

    if (segments.length === 2) {
      return { navigator: 'project' as NavigatorType, details: null, sessionFilter: { kind: 'allSessions' as const } }
    }

    // project/{slug}/chat/{sessionId}
    if (segments[2] === 'chat' && segments[3]) {
      return {
        navigator: 'project' as NavigatorType,
        details: { type: 'chat', id: segments[3] },
        sessionFilter: { kind: 'allSessions' as const },
      }
    }

    // project/{slug}/file/{filePath...}
    if (segments[2] === 'file' && segments[3]) {
      const filePath = decodeURIComponent(segments.slice(3).join('/'))
      return {
        navigator: 'project' as NavigatorType,
        details: { type: 'file', id: filePath },
        sessionFilter: { kind: 'allSessions' as const },
      }
    }

    return null
  }

  // Settings navigator
  if (first === 'settings') {
    const subpage = segments[1] || 'app'
    if (!isValidSettingsSubpage(subpage)) return null
    return {
      navigator: 'settings',
      details: { type: subpage, id: subpage },
    }
  }

  // Sources navigator - supports type filters (api, mcp, local)
  if (first === 'sources') {
    if (segments.length === 1) {
      return { navigator: 'sources', details: null }
    }

    // Check for type filter: sources/api, sources/mcp, sources/local
    const validSourceTypes = ['api', 'mcp', 'local']
    if (validSourceTypes.includes(segments[1])) {
      const sourceType = segments[1] as 'api' | 'mcp' | 'local'
      const sourceFilter: SourceFilter = { kind: 'type', sourceType }

      // Check for source selection within filtered view: sources/api/source/{sourceSlug}
      if (segments[2] === 'source' && segments[3]) {
        return {
          navigator: 'sources',
          sourceFilter,
          details: { type: 'source', id: segments[3] },
        }
      }

      // Just the filter, no selection
      return { navigator: 'sources', sourceFilter, details: null }
    }

    // Unfiltered source selection: sources/source/{sourceSlug}
    if (segments[1] === 'source' && segments[2]) {
      return {
        navigator: 'sources',
        details: { type: 'source', id: segments[2] },
      }
    }

    return null
  }

  // Skills navigator
  if (first === 'skills') {
    if (segments.length === 1) {
      return { navigator: 'skills', details: null }
    }

    // skills/skill/{skillSlug}
    if (segments[1] === 'skill' && segments[2]) {
      return {
        navigator: 'skills',
        details: { type: 'skill', id: segments[2] },
      }
    }

    return null
  }

  // Sessions navigator (allSessions, flagged, state)
  let sessionFilter: SessionFilter
  let detailsStartIndex: number

  switch (first) {
    case 'allSessions':
      sessionFilter = { kind: 'allSessions' }
      detailsStartIndex = 1
      break
    case 'flagged':
      sessionFilter = { kind: 'flagged' }
      detailsStartIndex = 1
      break
    case 'archived':
      sessionFilter = { kind: 'archived' }
      detailsStartIndex = 1
      break
    case 'state':
      if (!segments[1]) return null
      // Cast is safe because we're constructing from URL
      sessionFilter = { kind: 'state', stateId: segments[1] as SessionFilter & { kind: 'state' } extends { stateId: infer T } ? T : never }
      detailsStartIndex = 2
      break
    case 'label':
      if (!segments[1]) return null
      // Label IDs are URL-decoded (simple slugs, no special characters expected)
      sessionFilter = { kind: 'label', labelId: decodeURIComponent(segments[1]) }
      detailsStartIndex = 2
      break
    case 'view':
      if (!segments[1]) return null
      sessionFilter = { kind: 'view', viewId: decodeURIComponent(segments[1]) }
      detailsStartIndex = 2
      break
    default:
      return null
  }

  // Check for details
  if (segments.length > detailsStartIndex) {
    const detailsType = segments[detailsStartIndex]
    const detailsId = segments[detailsStartIndex + 1]
    if (detailsType === 'session' && detailsId) {
      return {
        navigator: 'sessions',
        sessionFilter,
        details: { type: 'session', id: detailsId },
      }
    }
  }

  return {
    navigator: 'sessions',
    sessionFilter,
    details: null,
  }
}

/**
 * Build a compound route string from parsed state
 */
export function buildCompoundRoute(parsed: ParsedCompoundRoute): string {
  if (parsed.navigator === 'settings') {
    const detailsType = parsed.details?.type || 'app'
    return `settings/${detailsType}`
  }

  if (parsed.navigator === 'sources') {
    // Build base from filter (sources, sources/api, sources/mcp, sources/local)
    let base = 'sources'
    if (parsed.sourceFilter?.kind === 'type') {
      base = `sources/${parsed.sourceFilter.sourceType}`
    }
    if (!parsed.details) return base
    return `${base}/source/${parsed.details.id}`
  }

  if (parsed.navigator === 'skills') {
    if (!parsed.details) return 'skills'
    return `skills/skill/${parsed.details.id}`
  }

  if (parsed.navigator === 'projects') {
    if (!parsed.details) return 'projects'
    return `projects/project/${parsed.details.id}`
  }

  // Note: 'project' navigator routes are built by buildRouteFromNavigationState directly
  // since they need projectSlug which isn't in ParsedCompoundRoute

  // Sessions navigator
  let base: string
  const filter = parsed.sessionFilter
  if (!filter) return 'allSessions'

  switch (filter.kind) {
    case 'allSessions':
      base = 'allSessions'
      break
    case 'flagged':
      base = 'flagged'
      break
    case 'archived':
      base = 'archived'
      break
    case 'state':
      base = `state/${filter.stateId}`
      break
    case 'label':
      base = `label/${encodeURIComponent(filter.labelId)}`
      break
    case 'view':
      base = `view/${encodeURIComponent(filter.viewId)}`
      break
    default:
      base = 'allSessions'
  }

  if (!parsed.details) return base
  return `${base}/session/${parsed.details.id}`
}

// =============================================================================
// Route Parsing
// =============================================================================

/**
 * Parse a route string into structured navigation
 *
 * Examples:
 *   'allSessions' -> { type: 'view', name: 'allSessions', params: {} }
 *   'allSessions/session/abc123' -> { type: 'view', name: 'session', id: 'abc123', params: { filter: 'allSessions' } }
 *   'settings/shortcuts' -> { type: 'view', name: 'shortcuts', params: {} }
 *   'action/new-session' -> { type: 'action', name: 'new-session', params: {} }
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
    const subpage = compound.details?.type || 'app'
    if (subpage === 'app') {
      return { type: 'view', name: 'settings', params: {} }
    }
    return { type: 'view', name: subpage, params: {} }
  }

  // Sources
  if (compound.navigator === 'sources') {
    if (!compound.details) {
      return { type: 'view', name: 'sources', params: {} }
    }
    return { type: 'view', name: 'source-info', id: compound.details.id, params: {} }
  }

  // Skills
  if (compound.navigator === 'skills') {
    if (!compound.details) {
      return { type: 'view', name: 'skills', params: {} }
    }
    return { type: 'view', name: 'skill-info', id: compound.details.id, params: {} }
  }

  // Sessions
  if (compound.sessionFilter) {
    const filter = compound.sessionFilter
    if (compound.details) {
      return {
        type: 'view',
        name: 'session',
        id: compound.details.id,
        params: {
          filter: filter.kind,
          ...(filter.kind === 'state' ? { stateId: filter.stateId } : {}),
          ...(filter.kind === 'label' ? { labelId: filter.labelId } : {}),
          ...(filter.kind === 'view' ? { viewId: filter.viewId } : {}),
        },
      }
    }
    return {
      type: 'view',
      name: filter.kind,
      id: filter.kind === 'state' ? filter.stateId : (filter.kind === 'label' ? filter.labelId : (filter.kind === 'view' ? filter.viewId : undefined)),
      params: {},
    }
  }

  return { type: 'view', name: 'allSessions', params: {} }
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
 * - Compound routes: allSessions, allSessions/session/abc, sources, sources/source/github, settings/shortcuts
 * - Right sidebar param: ?sidebar=sessionMetadata
 *
 * Returns null for action routes (they don't map to a navigation state) and invalid routes.
 */
export function parseRouteToNavigationState(
  route: string,
  sidebarParam?: string
): NavigationState | null {
  // Handle project routes directly (they need special projectSlug extraction)
  const segments = route.split('/').filter(Boolean)
  if (segments[0] === 'project' && segments[1]) {
    const projectSlug = segments[1]
    const rightSidebar = parseRightSidebarParam(sidebarParam)
    let state: NavigationState

    if (segments[2] === 'chat' && segments[3]) {
      state = {
        navigator: 'project',
        projectSlug,
        filter: { kind: 'allSessions' },
        details: { type: 'chat', sessionId: segments[3] },
      }
    } else if (segments[2] === 'file' && segments[3]) {
      const filePath = decodeURIComponent(segments.slice(3).join('/'))
      state = {
        navigator: 'project',
        projectSlug,
        filter: { kind: 'allSessions' },
        details: { type: 'file', filePath },
      }
    } else {
      state = {
        navigator: 'project',
        projectSlug,
        filter: { kind: 'allSessions' },
        details: null,
      }
    }

    if (rightSidebar) return { ...state, rightSidebar }
    return state
  }

  // Parse compound routes
  if (isCompoundRoute(route)) {
    const compound = parseCompoundRoute(route)
    if (compound) {
      const state = convertCompoundToNavigationState(compound)
      // Add rightSidebar if param provided
      const rightSidebar = parseRightSidebarParam(sidebarParam)
      if (rightSidebar) {
        return { ...state, rightSidebar }
      }
      return state
    }
  }

  // Parse as route (may be action or view)
  const parsed = parseRoute(route)
  if (!parsed) return null

  // Actions don't map to navigation state
  if (parsed.type === 'action') return null

  // Convert view routes to NavigationState
  const state = convertParsedRouteToNavigationState(parsed)
  if (state) {
    // Add rightSidebar if param provided
    const rightSidebar = parseRightSidebarParam(sidebarParam)
    if (rightSidebar) {
      return { ...state, rightSidebar }
    }
  }
  return state
}

/**
 * Convert a ParsedCompoundRoute to NavigationState
 */
function convertCompoundToNavigationState(compound: ParsedCompoundRoute): NavigationState {
  // Projects list
  if (compound.navigator === 'projects') {
    if (!compound.details) {
      return { navigator: 'projects', details: null }
    }
    return {
      navigator: 'projects',
      details: { type: 'project', projectSlug: compound.details.id },
    }
  }

  // Single project
  if (compound.navigator === 'project') {
    // Extract projectSlug from the route - we need a different approach
    // The parsed compound stores the slug in sessionFilter context or details
    const filter = compound.sessionFilter || { kind: 'allSessions' as const }
    if (compound.details) {
      if (compound.details.type === 'chat') {
        return {
          navigator: 'project',
          projectSlug: '', // Will be set by the route parser
          filter,
          details: { type: 'chat', sessionId: compound.details.id },
        }
      }
      if (compound.details.type === 'file') {
        return {
          navigator: 'project',
          projectSlug: '',
          filter,
          details: { type: 'file', filePath: compound.details.id },
        }
      }
    }
    return {
      navigator: 'project',
      projectSlug: '',
      filter,
      details: null,
    }
  }

  // Settings
  if (compound.navigator === 'settings') {
    const subpage = (compound.details?.type || 'app') as SettingsSubpage
    return { navigator: 'settings', subpage }
  }

  // Sources - include filter if present
  if (compound.navigator === 'sources') {
    if (!compound.details) {
      return {
        navigator: 'sources',
        filter: compound.sourceFilter,
        details: null,
      }
    }
    return {
      navigator: 'sources',
      filter: compound.sourceFilter,
      details: { type: 'source', sourceSlug: compound.details.id },
    }
  }

  // Skills
  if (compound.navigator === 'skills') {
    if (!compound.details) {
      return { navigator: 'skills', details: null }
    }
    return {
      navigator: 'skills',
      details: { type: 'skill', skillSlug: compound.details.id },
    }
  }

  // Sessions
  const filter = compound.sessionFilter || { kind: 'allSessions' as const }
  if (compound.details) {
    return {
      navigator: 'sessions',
      filter,
      details: { type: 'session', sessionId: compound.details.id },
    }
  }
  return {
    navigator: 'sessions',
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
      return { navigator: 'settings', subpage: 'app' }
    case 'workspace':
      return { navigator: 'settings', subpage: 'workspace' }
    case 'permissions':
      return { navigator: 'settings', subpage: 'permissions' }
    case 'labels':
      return { navigator: 'settings', subpage: 'labels' }
    case 'shortcuts':
      return { navigator: 'settings', subpage: 'shortcuts' }
    case 'preferences':
      return { navigator: 'settings', subpage: 'preferences' }
    case 'sources':
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
    case 'skills':
      return { navigator: 'skills', details: null }
    case 'skill-info':
      if (parsed.id) {
        return {
          navigator: 'skills',
          details: {
            type: 'skill',
            skillSlug: parsed.id,
          },
        }
      }
      return { navigator: 'skills', details: null }
    case 'session':
      if (parsed.id) {
        // Reconstruct filter from params
        const filterKind = (parsed.params.filter || 'allSessions') as SessionFilter['kind']
        let filter: SessionFilter
        if (filterKind === 'state' && parsed.params.stateId) {
          filter = { kind: 'state', stateId: parsed.params.stateId }
        } else if (filterKind === 'label' && parsed.params.labelId) {
          filter = { kind: 'label', labelId: parsed.params.labelId }
        } else if (filterKind === 'view' && parsed.params.viewId) {
          filter = { kind: 'view', viewId: parsed.params.viewId }
        } else {
          filter = { kind: filterKind as 'allSessions' | 'flagged' | 'archived' }
        }
        return {
          navigator: 'sessions',
          filter,
          details: { type: 'session', sessionId: parsed.id },
        }
      }
      return { navigator: 'sessions', filter: { kind: 'allSessions' }, details: null }
    case 'allSessions':
      return {
        navigator: 'sessions',
        filter: { kind: 'allSessions' },
        details: null,
      }
    case 'flagged':
      return {
        navigator: 'sessions',
        filter: { kind: 'flagged' },
        details: null,
      }
    case 'archived':
      return {
        navigator: 'sessions',
        filter: { kind: 'archived' },
        details: null,
      }
    case 'state':
      if (parsed.id) {
        return {
          navigator: 'sessions',
          filter: { kind: 'state', stateId: parsed.id },
          details: null,
        }
      }
      return { navigator: 'sessions', filter: { kind: 'allSessions' }, details: null }
    case 'label':
      if (parsed.id) {
        return {
          navigator: 'sessions',
          filter: { kind: 'label', labelId: parsed.id },
          details: null,
        }
      }
      return { navigator: 'sessions', filter: { kind: 'allSessions' }, details: null }
    case 'view':
      if (parsed.id) {
        return {
          navigator: 'sessions',
          filter: { kind: 'view', viewId: parsed.id },
          details: null,
        }
      }
      return { navigator: 'sessions', filter: { kind: 'allSessions' }, details: null }
    default:
      return null
  }
}

/**
 * Build a route string from NavigationState
 */
export function buildRouteFromNavigationState(state: NavigationState): string {
  if (state.navigator === 'settings') {
    return `settings/${state.subpage}`
  }

  if (state.navigator === 'sources') {
    // Build base from filter (sources, sources/api, sources/mcp, sources/local)
    let base = 'sources'
    if (state.filter?.kind === 'type') {
      base = `sources/${state.filter.sourceType}`
    }
    if (state.details) {
      return `${base}/source/${state.details.sourceSlug}`
    }
    return base
  }

  if (state.navigator === 'skills') {
    if (state.details?.type === 'skill') {
      return `skills/skill/${state.details.skillSlug}`
    }
    return 'skills'
  }

  if (state.navigator === 'projects') {
    if (state.details) {
      return `projects/project/${state.details.projectSlug}`
    }
    return 'projects'
  }

  if (state.navigator === 'project') {
    const base = `project/${state.projectSlug}`
    if (state.details) {
      if (state.details.type === 'chat') {
        return `${base}/chat/${state.details.sessionId}`
      }
      if (state.details.type === 'file') {
        return `${base}/file/${encodeURIComponent(state.details.filePath)}`
      }
    }
    return base
  }

  // Sessions
  const filter = state.filter
  let base: string
  switch (filter.kind) {
    case 'allSessions':
      base = 'allSessions'
      break
    case 'flagged':
      base = 'flagged'
      break
    case 'archived':
      base = 'archived'
      break
    case 'state':
      base = `state/${filter.stateId}`
      break
    case 'label':
      base = `label/${encodeURIComponent(filter.labelId)}`
      break
    case 'view':
      base = `view/${encodeURIComponent(filter.viewId)}`
      break
  }

  if (state.details) {
    return `${base}/session/${state.details.sessionId}`
  }
  return base
}

// =============================================================================
// Right Sidebar Param Parsing
// =============================================================================

/**
 * Parse right sidebar param from URL query string
 *
 * Examples:
 *   'sessionMetadata' -> { type: 'sessionMetadata' }
 *   'history' -> { type: 'history' }
 *   'files' -> { type: 'files' }
 *   'files/src/main.ts' -> { type: 'files', path: 'src/main.ts' }
 *   'none' -> { type: 'none' }
 */
export function parseRightSidebarParam(sidebarStr?: string): RightSidebarPanel | undefined {
  if (!sidebarStr) return undefined

  if (sidebarStr === 'sessionMetadata') {
    return { type: 'sessionMetadata' }
  }
  if (sidebarStr === 'history') {
    return { type: 'history' }
  }
  if (sidebarStr.startsWith('files')) {
    const path = sidebarStr.substring(6) // Remove 'files/' prefix
    return { type: 'files', path: path || undefined }
  }
  if (sidebarStr === 'none') {
    return { type: 'none' }
  }

  return undefined
}

/**
 * Build right sidebar param for URL query string
 *
 * Returns undefined for 'none' type (omit from URL to keep URLs clean)
 */
export function buildRightSidebarParam(panel?: RightSidebarPanel): string | undefined {
  if (!panel || panel.type === 'none') return undefined

  switch (panel.type) {
    case 'sessionMetadata':
      return 'sessionMetadata'
    case 'history':
      return 'history'
    case 'files':
      return panel.path ? `files/${panel.path}` : 'files'
    default:
      return undefined
  }
}

/**
 * Build full URL with navigation state and sidebar param
 */
export function buildUrlWithState(navState: NavigationState): string {
  const route = buildRouteFromNavigationState(navState)
  const params = new URLSearchParams()
  params.set('route', route)

  const sidebarParam = buildRightSidebarParam(navState.rightSidebar)
  if (sidebarParam) {
    params.set('sidebar', sidebarParam)
  }

  return `?${params.toString()}`
}
