/**
 * Route Parser
 *
 * Parses route strings back into structured navigation objects.
 * Used by both the navigate() function and deep link handler.
 *
 * Supports route formats:
 * - Action: action/{name}[/{id}] - Trigger side effects
 * - Compound: {filter}[/session/{sessionId}] - View routes for full navigation state
 *
 * Unified-shell surface routes (W1 scaffolding, spec S-02 §3.6) — well-formed
 * surface routes round-trip exactly (parse ↔ build); anything malformed or any
 * consumer path without a surface handler degrades to the nearest existing
 * view until dedicated hosts land (W2/W5):
 *
 * | Route form                        | Parsed NavigationState          | Degradation target (W1)                    |
 * |-----------------------------------|---------------------------------|--------------------------------------------|
 * | knowledge/{kind}/{id}             | navigator 'knowledge'           | sessions/allSessions (until W2 host)       |
 * | knowledge/database/{id}           | 'knowledge', kind 'database'    | same route (database tab rides knowledge)  |
 * | cloud-run/{runId}                 | navigator 'cloud-run'           | sessions/allSessions (runs UI in sessions) |
 * | extension/{extId}[/{viewId}]      | navigator 'extension'           | settings (Extension Center is W5)          |
 * | diff/{proposalId}                 | navigator 'diff'                | sessions/allSessions (until K-05 host)     |
 * | knowledge/{unknownKind}/{id}      | n/a (malformed)                 | sessions/allSessions (lossy, by design)    |
 * | surface routes via parseRoute()   | convertCompoundToViewRoute      | '{allSessions}' view route fallthrough     |
 *
 * Renderers resolve a surface state through `degradeSurfaceNavigationState`
 * until their host component exists; see spec S-02 §3.5 for host mapping.
 */

import type {
  NavigationState,
  SessionFilter,
  SourceFilter,
  AutomationFilter,
  RightSidebarPanel,
  KnowledgeRefKind,
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

export type NavigatorType = 'sessions' | 'sources' | 'skills' | 'notes' | 'automations' | 'projects' | 'settings' | 'browser' | 'memory' | 'connections'
  // Unified-shell surface navigators (W1 scaffolding; hosts land in W2/W5)
  | 'knowledge' | 'cloud-run' | 'extension' | 'diff'

export interface ParsedCompoundRoute {
  /** The navigator type */
  navigator: NavigatorType
  /** Session filter (only for sessions navigator) */
  sessionFilter?: SessionFilter
  /** Source filter (only for sources navigator) */
  sourceFilter?: SourceFilter
  /** Automation filter (only for automations navigator) */
  automationFilter?: AutomationFilter
  /** Sessions presentation mode (only for sessions navigator). 'board' = Kanban; 'table' = dense collection. */
  viewMode?: 'list' | 'board' | 'table'
  /**
   * Details page info (null for empty state).
   * W1 surface navigators reuse this shape: `id` is the entity id (runId /
   * proposalId / extensionId), `kind` carries the SiYuan ref kind for
   * 'knowledge' details, `viewId` the sandbox view for 'extension' details.
   */
  details: {
    type: string
    id: string
    kind?: KnowledgeRefKind
    viewId?: string
  } | null
}

// =============================================================================
// Compound Route Parsing
// =============================================================================

/**
 * Known prefixes that indicate a compound route
 */
const COMPOUND_ROUTE_PREFIXES = [
  'allSessions', 'flagged', 'archived', 'state', 'label', 'view', 'board', 'table', 'sources', 'skills', 'notes', 'automations', 'projects', 'settings', 'browser', 'memory', 'connections',
  // Unified-shell surfaces (W1)
  'knowledge', 'cloud-run', 'extension', 'diff',
]

/**
 * Check if a route is a compound route (new format)
 */
export function isCompoundRoute(route: string): boolean {
  const firstSegment = route.split('?')[0].split('/')[0]
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
 *   'settings' -> { navigator: 'settings', details: null }  // navigator-only view
 *   'settings/shortcuts' -> { navigator: 'settings', details: { type: 'shortcuts', id: 'shortcuts' } }
 */
export function parseCompoundRoute(route: string): ParsedCompoundRoute | null {
  // Compound routes are pure slash-segment paths; defensively strip any query tail
  // so a stray `?x=y` never leaks into segment parsing (e.g. into a labelId).
  const [pathPart] = route.split('?')
  const segments = pathPart.split('/').filter(Boolean)
  if (segments.length === 0) return null

  const first = segments[0]

  // Kanban board — standalone route. A view of all sessions in board mode.
  // Encoded as its own prefix (not `allSessions/board`) so it never collides
  // with the positional `{filter}/session/{id}` detail parsing below.
  if (first === 'board') {
    return {
      navigator: 'sessions',
      sessionFilter: { kind: 'allSessions' },
      viewMode: 'board',
      details: null,
    }
  }

  // Dense table — standalone route. A view of all sessions in table mode.
  // Encoded as its own prefix (not `allSessions/table`) so it never collides
  // with the positional `{filter}/session/{id}` detail parsing below.
  if (first === 'table') {
    return {
      navigator: 'sessions',
      sessionFilter: { kind: 'allSessions' },
      viewMode: 'table',
      details: null,
    }
  }

  // Settings navigator
  if (first === 'settings') {
    const subpage = segments[1]
    if (subpage === undefined) {
      // Bare `settings` route — navigator-only view (compact) / App fallback (desktop).
      return { navigator: 'settings', details: null }
    }
    // Legacy subpages.
    // toolchain → runtime (PRD runtime-context-marketplace §5.1)
    // preferences → context (P2.1 Context ↔ Preferences merge)
    const LEGACY_SETTINGS_REDIRECT: Record<string, SettingsSubpage> = {
      toolchain: 'runtime',
      preferences: 'context',
    }
    const redirected = LEGACY_SETTINGS_REDIRECT[subpage] ?? subpage
    if (!isValidSettingsSubpage(redirected)) return null
    return {
      navigator: 'settings',
      details: { type: redirected, id: redirected },
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

  // Memory navigator (self-learning lessons / context / history)
  if (first === 'memory') {
    return { navigator: 'memory', details: null }
  }

  if (first === 'connections') {
    return { navigator: 'connections', details: null }
  }

  // Browser navigator — embedded browser instance panel: browser/instance/{instanceId}
  if (first === 'browser') {
    if (segments[1] === 'instance' && segments[2]) {
      return {
        navigator: 'browser',
        details: { type: 'browser', id: segments[2] },
      }
    }
    return null
  }

  // Projects navigator
  if (first === 'projects') {
    if (segments.length === 1) {
      return { navigator: 'projects', details: null }
    }
    if (segments[1] === 'project' && segments[2]) {
      return {
        navigator: 'projects',
        details: { type: 'project', id: segments[2] },
      }
    }

    return null
  }

  // Notes navigator.
  if (first === 'notes') {
    if (segments.length === 1) {
      return { navigator: 'notes' as NavigatorType, details: null }
    }

    if (segments[1] === 'note' && segments[2]) {
      return {
        navigator: 'notes' as NavigatorType,
        details: { type: 'note', id: decodeURIComponent(segments.slice(2).join('/')) },
      }
    }

    return null
  }

  // Automations navigator - supports type filters (scheduled, event, agentic)
  if (first === 'automations') {
    if (segments.length === 1) {
      return { navigator: 'automations', details: null }
    }

    // Check for type filter: automations/scheduled, automations/event, automations/agentic
    const validAutomationTypes = ['scheduled', 'event', 'agentic']
    if (validAutomationTypes.includes(segments[1])) {
      const automationType = segments[1] as 'scheduled' | 'event' | 'agentic'
      const automationFilter: AutomationFilter = { kind: 'type', automationType }

      // Check for automation selection within filtered view: automations/scheduled/automation/{automationId}
      if (segments[2] === 'automation' && segments[3]) {
        return {
          navigator: 'automations',
          automationFilter,
          details: { type: 'automation', id: segments[3] },
        }
      }

      // Just the filter, no selection
      return { navigator: 'automations', automationFilter, details: null }
    }

    // Unfiltered automation selection: automations/automation/{automationId}
    if (segments[1] === 'automation' && segments[2]) {
      return {
        navigator: 'automations',
        details: { type: 'automation', id: segments[2] },
      }
    }

    return null
  }

  // ------------------------------------------------------------------
  // Unified-shell surface navigators (W1 scaffolding, spec S-02 §3.6).
  // Well-formed routes round-trip exactly; malformed shapes degrade to the
  // nearest existing view (sessions/allSessions) instead of null.
  // ------------------------------------------------------------------

  // Knowledge surface — knowledge/{kind}/{id}; kind 'database' doubles as the
  // database SurfaceTab (descriptor-lowering happens in the registry, S-02 §3.2).
  // P5 saved views: knowledge/view/{viewId} — stays on knowledge navigator with
  // details.type 'knowledge-view' so KnowledgeHome can deep-link.
  if (first === 'knowledge') {
    if (segments.length === 1) {
      return { navigator: 'knowledge', details: null }
    }
    if (segments[1] === 'view') {
      const viewId = segments[2] ? decodeURIComponent(segments.slice(2).join('/')) : ''
      if (viewId) {
        return {
          navigator: 'knowledge',
          details: { type: 'knowledge-view', id: viewId },
        }
      }
      return { navigator: 'knowledge', details: null }
    }
    const kind = segments[1]
    const id = segments[2] ? decodeURIComponent(segments.slice(2).join('/')) : ''
    if (id && (['notebook', 'document', 'block', 'database', 'asset'] as const).includes(kind as KnowledgeRefKind)) {
      return {
        navigator: 'knowledge',
        details: { type: 'knowledge', id, kind: kind as KnowledgeRefKind },
      }
    }
    // Unknown ref kind / missing id — degrade to nearest existing view
    return { navigator: 'sessions', sessionFilter: { kind: 'allSessions' }, details: null }
  }

  // Cloud run surface — cloud-run/{runId}
  if (first === 'cloud-run') {
    if (segments.length === 1) {
      return { navigator: 'cloud-run', details: null }
    }
    const runId = decodeURIComponent(segments.slice(1).join('/'))
    if (!runId) {
      return { navigator: 'sessions', sessionFilter: { kind: 'allSessions' }, details: null }
    }
    return { navigator: 'cloud-run', details: { type: 'cloud-run', id: runId } }
  }

  // Extension sandbox view — extension/{extensionId}[/{viewId}]
  if (first === 'extension') {
    if (segments.length === 1) {
      return { navigator: 'extension', details: null }
    }
    const extensionId = decodeURIComponent(segments[1])
    const viewId = segments[2] ? decodeURIComponent(segments.slice(2).join('/')) : undefined
    return {
      navigator: 'extension',
      details: { type: 'extension', id: extensionId, ...(viewId ? { viewId } : {}) },
    }
  }

  // Write-proposal diff surface — diff/{proposalId}
  if (first === 'diff') {
    if (segments.length === 1) {
      return { navigator: 'diff', details: null }
    }
    const proposalId = decodeURIComponent(segments.slice(1).join('/'))
    if (!proposalId) {
      return { navigator: 'sessions', sessionFilter: { kind: 'allSessions' }, details: null }
    }
    return { navigator: 'diff', details: { type: 'diff', id: proposalId } }
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
    if (!parsed.details) return 'settings'
    return `settings/${parsed.details.type}`
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

  if (parsed.navigator === 'notes') {
    if (!parsed.details) return 'notes'
    return `notes/note/${encodeURIComponent(parsed.details.id)}`
  }

  if (parsed.navigator === 'automations') {
    // Build base from filter (automations, automations/scheduled, automations/event, automations/agentic)
    let base = 'automations'
    if (parsed.automationFilter?.kind === 'type') {
      base = `automations/${parsed.automationFilter.automationType}`
    }
    if (!parsed.details) return base
    return `${base}/automation/${parsed.details.id}`
  }

  if (parsed.navigator === 'memory') {
    return 'memory'
  }

  if (parsed.navigator === 'connections') {
    return 'connections'
  }

  if (parsed.navigator === 'browser') {
    if (!parsed.details) return 'browser'
    return `browser/instance/${parsed.details.id}`
  }

  if (parsed.navigator === 'projects') {
    if (!parsed.details) return 'projects'
    return `projects/project/${parsed.details.id}`
  }

  // Unified-shell surfaces (W1)
  if (parsed.navigator === 'knowledge') {
    if (!parsed.details) return 'knowledge'
    if (parsed.details.type === 'knowledge-view') {
      return `knowledge/view/${encodeURIComponent(parsed.details.id)}`
    }
    if (parsed.details.type !== 'knowledge' || !parsed.details.kind) return 'knowledge'
    return `knowledge/${parsed.details.kind}/${encodeURIComponent(parsed.details.id)}`
  }

  if (parsed.navigator === 'cloud-run') {
    if (!parsed.details) return 'cloud-run'
    return `cloud-run/${encodeURIComponent(parsed.details.id)}`
  }

  if (parsed.navigator === 'extension') {
    if (!parsed.details) return 'extension'
    const base = `extension/${encodeURIComponent(parsed.details.id)}`
    return parsed.details.viewId ? `${base}/${encodeURIComponent(parsed.details.viewId)}` : base
  }

  if (parsed.navigator === 'diff') {
    if (!parsed.details) return 'diff'
    return `diff/${encodeURIComponent(parsed.details.id)}`
  }

  // Sessions navigator
  // Board/table are standalone views of all sessions; emit their own prefixes.
  if (parsed.viewMode === 'board') return 'board'
  if (parsed.viewMode === 'table') return 'table'

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

  // Memory
  if (compound.navigator === 'memory') {
    return { type: 'view', name: 'memory', params: {} }
  }

  if (compound.navigator === 'connections') {
    return { type: 'view', name: 'connections', params: {} }
  }

  // Notes
  if (compound.navigator === 'notes') {
    if (!compound.details) {
      return { type: 'view', name: 'notes', params: {} }
    }
    return { type: 'view', name: 'note-info', id: compound.details.id, params: {} }
  }

  // Automations
  if (compound.navigator === 'automations') {
    if (!compound.details) {
      return { type: 'view', name: 'automations', params: {} }
    }
    return { type: 'view', name: 'automation-info', id: compound.details.id, params: {} }
  }

  // Projects
  if (compound.navigator === 'projects') {
    if (!compound.details) {
      return { type: 'view', name: 'projects', params: {} }
    }
    return { type: 'view', name: 'project-info', id: compound.details.id, params: {} }
  }

  // Browser (embedded browser instance panel)
  if (compound.navigator === 'browser') {
    if (!compound.details) {
      return { type: 'view', name: 'browser', params: {} }
    }
    return { type: 'view', name: 'browser', id: compound.details.id, params: {} }
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
 * - Right sidebar param: ?sidebar=files or ?sidebar=history
 *
 * Returns null for action routes (they don't map to a navigation state) and invalid routes.
 */
export function parseRouteToNavigationState(
  route: string,
  sidebarParam?: string
): NavigationState | null {
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
  // Settings
  if (compound.navigator === 'settings') {
    if (!compound.details) {
      return { navigator: 'settings', subpage: null }
    }
    return { navigator: 'settings', subpage: compound.details.type as SettingsSubpage }
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

  // Memory
  if (compound.navigator === 'memory') {
    return { navigator: 'memory', details: null }
  }

  if (compound.navigator === 'connections') {
    return { navigator: 'connections', details: null }
  }

  // Notes
  if (compound.navigator === 'notes') {
    if (!compound.details) {
      return { navigator: 'notes', details: null }
    }
    return {
      navigator: 'notes',
      details: { type: 'note', noteId: compound.details.id },
    }
  }

  // Automations - include filter if present
  if (compound.navigator === 'automations') {
    if (!compound.details) {
      return {
        navigator: 'automations',
        filter: compound.automationFilter,
        details: null,
      }
    }
    return {
      navigator: 'automations',
      filter: compound.automationFilter,
      details: { type: 'automation', automationId: compound.details.id },
    }
  }

  // Projects
  if (compound.navigator === 'projects') {
    if (!compound.details) {
      return { navigator: 'projects', details: null }
    }
    return {
      navigator: 'projects',
      details: { type: 'project', projectSlug: compound.details.id },
    }
  }

  // Browser
  if (compound.navigator === 'browser') {
    if (!compound.details) {
      return { navigator: 'browser', details: null }
    }
    return {
      navigator: 'browser',
      details: { type: 'browser', id: compound.details.id },
    }
  }

  // Unified-shell surfaces (W1)
  if (compound.navigator === 'knowledge') {
    if (!compound.details) {
      return { navigator: 'knowledge', details: null }
    }
    if (compound.details.type === 'knowledge-view') {
      return {
        navigator: 'knowledge',
        details: { type: 'knowledge-view', viewId: compound.details.id },
      }
    }
    if (compound.details.type !== 'knowledge' || !compound.details.kind) {
      return { navigator: 'knowledge', details: null }
    }
    return {
      navigator: 'knowledge',
      details: { type: 'knowledge', kind: compound.details.kind, id: compound.details.id },
    }
  }

  if (compound.navigator === 'cloud-run') {
    if (!compound.details) {
      return { navigator: 'cloud-run', details: null }
    }
    return {
      navigator: 'cloud-run',
      details: { type: 'cloud-run', runId: compound.details.id },
    }
  }

  if (compound.navigator === 'extension') {
    if (!compound.details) {
      return { navigator: 'extension', details: null }
    }
    return {
      navigator: 'extension',
      details: {
        type: 'extension',
        extensionId: compound.details.id,
        ...(compound.details.viewId ? { viewId: compound.details.viewId } : {}),
      },
    }
  }

  if (compound.navigator === 'diff') {
    if (!compound.details) {
      return { navigator: 'diff', details: null }
    }
    return {
      navigator: 'diff',
      details: { type: 'diff', proposalId: compound.details.id },
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
    viewMode: compound.viewMode,
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
      return { navigator: 'settings', subpage: 'context' }
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
    case 'memory':
      return { navigator: 'memory', details: null }
    case 'connections':
      return { navigator: 'connections', details: null }
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
    case 'notes':
      return { navigator: 'notes', details: null }
    case 'note-info':
      if (parsed.id) {
        return {
          navigator: 'notes',
          details: {
            type: 'note',
            noteId: parsed.id,
          },
        }
      }
      return { navigator: 'notes', details: null }
    case 'automations':
      return { navigator: 'automations', details: null }
    case 'automation-info':
      if (parsed.id) {
        return {
          navigator: 'automations',
          details: {
            type: 'automation',
            automationId: parsed.id,
          },
        }
      }
      return { navigator: 'automations', details: null }
    case 'projects':
      return { navigator: 'projects', details: null }
    case 'browser':
      if (parsed.id) {
        return {
          navigator: 'browser',
          details: { type: 'browser', id: parsed.id },
        }
      }
      return { navigator: 'browser', details: null }
    case 'project-info':
      if (parsed.id) {
        return {
          navigator: 'projects',
          details: { type: 'project', projectSlug: parsed.id },
        }
      }
      return { navigator: 'projects', details: null }
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
 * Convert NavigationState to ParsedCompoundRoute
 */
function navigationStateToCompoundRoute(state: NavigationState): ParsedCompoundRoute {
  if (state.navigator === 'settings') {
    if (state.subpage === null) {
      return { navigator: 'settings', details: null }
    }
    return {
      navigator: 'settings',
      details: { type: state.subpage, id: state.subpage },
    }
  }

  if (state.navigator === 'sources') {
    return {
      navigator: 'sources',
      sourceFilter: state.filter ?? undefined,
      details: state.details ? { type: 'source', id: state.details.sourceSlug } : null,
    }
  }

  if (state.navigator === 'skills') {
    return {
      navigator: 'skills',
      details: state.details?.type === 'skill' ? { type: 'skill', id: state.details.skillSlug } : null,
    }
  }

  if (state.navigator === 'notes') {
    return {
      navigator: 'notes' as NavigatorType,
      details: state.details?.type === 'note' ? { type: 'note', id: state.details.noteId } : null,
    }
  }

  if (state.navigator === 'automations') {
    return {
      navigator: 'automations',
      automationFilter: state.filter ?? undefined,
      details: state.details ? { type: 'automation', id: state.details.automationId } : null,
    }
  }

  if (state.navigator === 'projects') {
    return {
      navigator: 'projects',
      details: state.details ? { type: 'project', id: state.details.projectSlug } : null,
    }
  }

  if (state.navigator === 'memory') {
    return {
      navigator: 'memory',
      details: null,
    }
  }

  if (state.navigator === 'connections') {
    return {
      navigator: 'connections',
      details: null,
    }
  }

  if (state.navigator === 'browser') {
    return {
      navigator: 'browser',
      details: state.details ? { type: 'browser', id: state.details.id } : null,
    }
  }

  // Unified-shell surfaces (W1)
  if (state.navigator === 'knowledge') {
    if (state.details?.type === 'knowledge-view') {
      return {
        navigator: 'knowledge',
        details: { type: 'knowledge-view', id: state.details.viewId },
      }
    }
    return {
      navigator: 'knowledge',
      details: state.details?.type === 'knowledge'
        ? { type: 'knowledge', id: state.details.id, kind: state.details.kind }
        : null,
    }
  }

  if (state.navigator === 'cloud-run') {
    return {
      navigator: 'cloud-run',
      details: state.details?.type === 'cloud-run'
        ? { type: 'cloud-run', id: state.details.runId }
        : null,
    }
  }

  if (state.navigator === 'extension') {
    return {
      navigator: 'extension',
      details: state.details?.type === 'extension'
        ? { type: 'extension', id: state.details.extensionId, ...(state.details.viewId ? { viewId: state.details.viewId } : {}) }
        : null,
    }
  }

  if (state.navigator === 'diff') {
    return {
      navigator: 'diff',
      details: state.details?.type === 'diff'
        ? { type: 'diff', id: state.details.proposalId }
        : null,
    }
  }

  // Sessions
  return {
    navigator: 'sessions',
    sessionFilter: state.filter,
    viewMode: state.viewMode,
    details: state.details ? { type: 'session', id: state.details.sessionId } : null,
  }
}

/**
 * Build a route string from NavigationState
 */
export function buildRouteFromNavigationState(state: NavigationState): string {
  return buildCompoundRoute(navigationStateToCompoundRoute(state))
}

/**
 * Degrade a unified-shell surface state to the nearest pre-W1 navigation view.
 *
 * Until the dedicated hosts land (knowledge/run/diff in W2+K-05, extension in
 * W5), consumers that cannot render a surface navigator should map it through
 * this helper instead of branching on the new navigators themselves. Identity
 * for every pre-W1 state. See the degradation table at the top of this file.
 */
export function degradeSurfaceNavigationState(state: NavigationState): NavigationState {
  switch (state.navigator) {
    case 'knowledge':
    case 'cloud-run':
    case 'diff':
      return { navigator: 'sessions', filter: { kind: 'allSessions' }, details: null }
    case 'extension':
      return { navigator: 'settings', subpage: null }
    default:
      return state
  }
}

// =============================================================================
// Right Sidebar Param Parsing
// =============================================================================

/**
 * Parse right sidebar param from URL query string
 *
 * Examples:
 *   'history' -> { type: 'history' }
 *   'files' -> { type: 'files' }
 *   'files/src/main.ts' -> { type: 'files', path: 'src/main.ts' }
 *   'none' -> { type: 'none' }
 */
export function parseRightSidebarParam(sidebarStr?: string): RightSidebarPanel | undefined {
  if (!sidebarStr) return undefined

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
    case 'history':
      return 'history'
    case 'files':
      return panel.path ? `files/${panel.path}` : 'files'
    default:
      return undefined
  }
}
