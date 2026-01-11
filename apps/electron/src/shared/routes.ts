/**
 * Route Registry
 *
 * Type-safe route definitions for navigation throughout the app.
 * All navigation should use these route builders instead of hardcoded strings.
 *
 * Route Formats:
 * - action/{name}[/{id}] - Trigger side effects
 * - {filter}[/chat/{sessionId}] - Compound view routes for full navigation state
 *
 * Usage:
 *   import { routes } from '@/shared/routes'
 *   navigate(routes.action.newChat())
 *   navigate(routes.view.allChats())
 *   navigate(routes.view.settings('shortcuts'))
 */

// Helper to build query strings from params
function toQueryString(params?: Record<string, string | undefined>): string {
  if (!params) return ''
  const filtered = Object.entries(params).filter(([, v]) => v !== undefined)
  if (filtered.length === 0) return ''
  const searchParams = new URLSearchParams(
    filtered as [string, string][]
  )
  return `?${searchParams.toString()}`
}

/**
 * Route definitions with type-safe builders
 */
export const routes = {
  // ============================================
  // Action Routes - Trigger actions
  // ============================================
  action: {
    /** Create a new chat session */
    newChat: (params?: { input?: string; name?: string; onboarding?: 'add-source' | 'connect-sources' | 'welcome' }) =>
      `action/new-chat${toQueryString(params)}` as const,

    /** Rename a session */
    renameSession: (sessionId: string, name: string) =>
      `action/rename-session/${sessionId}?name=${encodeURIComponent(name)}` as const,

    /** Delete a session (with confirmation) */
    deleteSession: (sessionId: string) =>
      `action/delete-session/${sessionId}` as const,

    /** Toggle flag on a session */
    flagSession: (sessionId: string) =>
      `action/flag-session/${sessionId}` as const,

    /** Unflag a session */
    unflagSession: (sessionId: string) =>
      `action/unflag-session/${sessionId}` as const,

    /** Start OAuth flow for a source */
    oauth: (sourceSlug: string) => `action/oauth/${sourceSlug}` as const,

    /** Open add source UI */
    addSource: () => 'action/add-source' as const,

    // Note: test-source route can be added when API support is available
    // testSource: (sourceSlug: string) => `action/test-source/${sourceSlug}` as const,

    /** Delete a source */
    deleteSource: (sourceSlug: string) =>
      `action/delete-source/${sourceSlug}` as const,

    /** Set permission mode for a session */
    setPermissionMode: (
      sessionId: string,
      mode: 'safe' | 'ask' | 'allow-all'
    ) => `action/set-mode/${sessionId}?mode=${mode}` as const,

    /** Copy text to clipboard */
    copyToClipboard: (text: string) =>
      `action/copy?text=${encodeURIComponent(text)}` as const,
  },

  // ============================================
  // View Routes - Compound sidebar/navigator/details routes
  // ============================================
  view: {
    /** All chats view (chats navigator, allChats filter) */
    allChats: (sessionId?: string) =>
      sessionId ? `allChats/chat/${sessionId}` as const : 'allChats' as const,

    /** Flagged view (chats navigator, flagged filter) */
    flagged: (sessionId?: string) =>
      sessionId ? `flagged/chat/${sessionId}` as const : 'flagged' as const,

    /** Todo state filter view (chats navigator, state filter) */
    state: (stateId: string, sessionId?: string) =>
      sessionId
        ? `state/${stateId}/chat/${sessionId}` as const
        : `state/${stateId}` as const,

    /** Sources view (sources navigator) */
    sources: (params?: { category?: 'local-files' | 'online-sources' | 'local-mcp'; sourceSlug?: string }) => {
      const { category, sourceSlug } = params ?? {}
      if (sourceSlug) {
        // Include category in URL if present: sources/{category}/source/{slug}
        if (category) return `sources/${category}/source/${sourceSlug}` as const
        return `sources/source/${sourceSlug}` as const
      }
      if (category) return `sources/${category}` as const
      return 'sources' as const
    },

    /** Settings view (settings navigator) */
    settings: (subpage?: 'general' | 'shortcuts' | 'preferences') =>
      subpage && subpage !== 'general'
        ? `settings/${subpage}` as const
        : 'settings' as const,
  },
} as const

/**
 * Type representing any valid route string
 */
export type ActionRoute = ReturnType<(typeof routes.action)[keyof typeof routes.action]>
export type ViewRoute = ReturnType<(typeof routes.view)[keyof typeof routes.view]>
export type Route = ActionRoute | ViewRoute
