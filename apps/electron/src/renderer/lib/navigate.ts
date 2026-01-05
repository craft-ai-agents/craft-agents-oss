/**
 * Navigation Utilities
 *
 * Provides a unified `navigate()` function for internal navigation.
 * Works by dispatching a custom event that the NavigationContext listens for.
 *
 * Usage:
 *   import { navigate, routes } from '@/lib/navigate'
 *
 *   navigate(routes.tab.settings())
 *   navigate(routes.action.newChat({ agentId: 'claude' }))
 *   navigate(routes.sidebar.inbox())
 */

import { routes, type Route } from '../../shared/routes'

// Re-export routes for convenience
export { routes }
export type { Route }

// Event name for internal navigation
export const NAVIGATE_EVENT = 'craft-agent-navigate'

/**
 * Navigate to a route
 *
 * This dispatches a custom event that the NavigationContext listens for.
 * Can be called from anywhere in the app.
 */
export function navigate(route: Route): void {
  const event = new CustomEvent(NAVIGATE_EVENT, {
    detail: { route },
    bubbles: true,
  })
  window.dispatchEvent(event)
}

/**
 * Build a deep link URL from a route
 *
 * Without workspace: craftagents://tab/settings
 * With workspace: craftagents://workspace/{id}/tab/settings
 */
export function buildDeepLink(route: Route, workspaceId?: string): string {
  if (workspaceId) {
    return `craftagents://workspace/${workspaceId}/${route}`
  }
  return `craftagents://${route}`
}

/**
 * Parse a route from a deep link URL
 * Returns the route portion without the protocol/workspace prefix
 */
export function parseDeepLinkRoute(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'craftagents:') return null

    const host = parsed.hostname
    const pathParts = parsed.pathname.split('/').filter(Boolean)

    // craftagents://workspace/{id}/... → extract route after workspace ID
    if (host === 'workspace' && pathParts.length >= 2) {
      // Skip workspace ID, join the rest
      return pathParts.slice(1).join('/') + (parsed.search || '')
    }

    // craftagents://tab/... → route starts at host
    if (['tab', 'action', 'sidebar'].includes(host)) {
      const path = pathParts.join('/')
      return `${host}/${path}${parsed.search || ''}`
    }

    return null
  } catch {
    return null
  }
}
