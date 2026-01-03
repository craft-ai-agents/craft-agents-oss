/**
 * Route Parser
 *
 * Parses route strings back into structured navigation objects.
 * Used by both the navigate() function and deep link handler.
 */

export type RouteType = 'tab' | 'action' | 'sidebar'

export interface ParsedRoute {
  type: RouteType
  name: string
  id?: string
  params: Record<string, string>
}

/**
 * Parse a route string into structured navigation
 *
 * Examples:
 *   'tab/settings' -> { type: 'tab', name: 'settings', params: {} }
 *   'tab/chat/abc123' -> { type: 'tab', name: 'chat', id: 'abc123', params: {} }
 *   'action/new-chat?agentId=x' -> { type: 'action', name: 'new-chat', params: { agentId: 'x' } }
 *   'sidebar/agent/my-agent' -> { type: 'sidebar', name: 'agent', id: 'my-agent', params: {} }
 */
export function parseRoute(route: string): ParsedRoute | null {
  try {
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
