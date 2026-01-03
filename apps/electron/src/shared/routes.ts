/**
 * Route Registry
 *
 * Type-safe route definitions for navigation throughout the app.
 * All navigation should use these route builders instead of hardcoded strings.
 *
 * Usage:
 *   import { routes } from '@/shared/routes'
 *   navigate(routes.tab.settings())
 *   navigate(routes.action.newChat({ agentId: 'claude' }))
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
  // Tab Routes - Open tabs in the tab bar
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
  // Sidebar Routes - Navigate sidebar
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
} as const

/**
 * Type representing any valid route string
 */
export type TabRoute = ReturnType<(typeof routes.tab)[keyof typeof routes.tab]>
export type ActionRoute = ReturnType<(typeof routes.action)[keyof typeof routes.action]>
export type SidebarRoute = ReturnType<(typeof routes.sidebar)[keyof typeof routes.sidebar]>
export type Route = TabRoute | ActionRoute | SidebarRoute
