/**
 * Route Registry
 *
 * Type-safe route definitions for navigation throughout the app.
 * All navigation should use these route builders instead of hardcoded strings.
 *
 * Route Format Evolution:
 * - Legacy: tab/{type}[/{id}], sidebar/{filter}[/{id}], action/{name}[/{id}]
 * - New: {sidebar}/{navigator}[/{details}] - compound routes for full state
 *
 * Usage:
 *   import { routes } from '@/shared/routes'
 *   navigate(routes.tab.settings())
 *   navigate(routes.action.newChat({ agentId: 'claude' }))
 *   navigate(routes.view.inbox())
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
  // Content Routes - Open views in the main panel
  // ============================================
  tab: {
    /** Open settings tab */
    settings: () => 'tab/settings' as const,

    /** Open keyboard shortcuts tab */
    shortcuts: () => 'tab/shortcuts' as const,

    /** Open user preferences tab */
    preferences: () => 'tab/preferences' as const,

    /** Open a chat session tab */
    chat: (sessionId: string) => `tab/chat/${sessionId}` as const,

    /** Open agent info tab */
    agentInfo: (agentId: string) => `tab/agent-info/${agentId}` as const,

    /** Open source info tab */
    sourceInfo: (sourceSlug: string, agentSlug?: string) =>
      agentSlug
        ? (`tab/source-info/${agentSlug}/${sourceSlug}` as const)
        : (`tab/source-info/${sourceSlug}` as const),

    /** Open file viewer tab */
    file: (path: string) => `tab/file?path=${encodeURIComponent(path)}` as const,

    /** Open browser tab */
    browser: (url: string) => `tab/browser?url=${encodeURIComponent(url)}` as const,
  },

  // ============================================
  // Action Routes - Trigger actions
  // ============================================
  action: {
    /** Create a new chat session */
    newChat: (params?: { agentId?: string; input?: string; name?: string }) =>
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

    // Note: archive/unarchive routes can be added when API support is available
    // archiveSession: (sessionId: string) => `action/archive-session/${sessionId}` as const,
    // unarchiveSession: (sessionId: string) => `action/unarchive-session/${sessionId}` as const,

    /** Start OAuth flow for a source */
    oauth: (sourceSlug: string) => `action/oauth/${sourceSlug}` as const,

    /** Open add source UI */
    addSource: () => 'action/add-source' as const,

    // Note: test-source route can be added when API support is available
    // testSource: (sourceSlug: string) => `action/test-source/${sourceSlug}` as const,

    /** Delete a source */
    deleteSource: (sourceSlug: string) =>
      `action/delete-source/${sourceSlug}` as const,

    /** Activate an agent */
    activateAgent: (agentId: string) =>
      `action/activate-agent/${agentId}` as const,

    /** Deactivate an agent */
    deactivateAgent: (agentId: string) =>
      `action/deactivate-agent/${agentId}` as const,

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
  // Sidebar Routes - Navigate sidebar (legacy)
  // ============================================
  sidebar: {
    /** Show inbox (default chat filter) */
    inbox: () => 'sidebar/inbox' as const,

    /** Show archive */
    archive: () => 'sidebar/archive' as const,

    /** Show flagged sessions */
    flagged: () => 'sidebar/flagged' as const,

    /** Show sources panel */
    sources: () => 'sidebar/sources' as const,

    /** Filter by agent */
    agent: (agentId: string) => `sidebar/agent/${agentId}` as const,

    /** Filter by todo state */
    todoState: (stateId: string) => `sidebar/state/${stateId}` as const,
  },

  // ============================================
  // View Routes - Compound sidebar/navigator/details routes (new format)
  // ============================================
  view: {
    /** Inbox view (chats navigator, inbox filter) */
    inbox: (sessionId?: string) =>
      sessionId ? `inbox/chat/${sessionId}` as const : 'inbox' as const,

    /** Archive view (chats navigator, archive filter) */
    archive: (sessionId?: string) =>
      sessionId ? `archive/chat/${sessionId}` as const : 'archive' as const,

    /** Flagged view (chats navigator, flagged filter) */
    flagged: (sessionId?: string) =>
      sessionId ? `flagged/chat/${sessionId}` as const : 'flagged' as const,

    /** Agent filter view (chats navigator, agent filter) */
    agent: (agentId: string, sessionId?: string) =>
      sessionId
        ? `agent/${agentId}/chat/${sessionId}` as const
        : `agent/${agentId}` as const,

    /** Todo state filter view (chats navigator, state filter) */
    state: (stateId: string, sessionId?: string) =>
      sessionId
        ? `state/${stateId}/chat/${sessionId}` as const
        : `state/${stateId}` as const,

    /** Sources view (sources navigator) */
    sources: (params?: { category?: 'local-files' | 'online-sources' | 'local-mcp'; sourceSlug?: string; agentSlug?: string }) => {
      const { category, sourceSlug, agentSlug } = params ?? {}
      if (sourceSlug) {
        if (agentSlug) return `sources/source/${agentSlug}/${sourceSlug}` as const
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
export type TabRoute = ReturnType<(typeof routes.tab)[keyof typeof routes.tab]>
export type ActionRoute = ReturnType<(typeof routes.action)[keyof typeof routes.action]>
export type SidebarRoute = ReturnType<(typeof routes.sidebar)[keyof typeof routes.sidebar]>
export type ViewRoute = ReturnType<(typeof routes.view)[keyof typeof routes.view]>
export type Route = TabRoute | ActionRoute | SidebarRoute | ViewRoute
