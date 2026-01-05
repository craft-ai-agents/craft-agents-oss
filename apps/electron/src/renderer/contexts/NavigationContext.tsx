/**
 * NavigationContext
 *
 * Provides a global `navigate()` function that decouples components from
 * direct tab/action imports. All navigation goes through typed routes.
 *
 * Usage:
 *   import { useNavigation } from '@/contexts/NavigationContext'
 *   import { routes } from '@/shared/routes'
 *
 *   const { navigate } = useNavigation()
 *   navigate(routes.tab.settings())
 *   navigate(routes.action.newChat({ agentId: 'claude' }))
 */

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react'
import { useTabs } from '@/tabs'
import { parseRoute, type ParsedRoute } from '../../shared/route-parser'
import { routes, type Route } from '../../shared/routes'
import { NAVIGATE_EVENT } from '../lib/navigate'
import type { DeepLinkNavigation, Session } from '../../shared/types'

// Re-export routes for convenience
export { routes }
export type { Route }

interface NavigationContextValue {
  /** Navigate to a route */
  navigate: (route: Route) => void | Promise<void>
  /** Check if navigation is ready */
  isReady: boolean
}

const NavigationContext = createContext<NavigationContextValue | null>(null)

interface NavigationProviderProps {
  children: ReactNode
  /** Current workspace ID */
  workspaceId: string | null
  /** Session creation handler */
  onCreateSession: (workspaceId: string, agentId?: string) => Promise<Session>
  /** Input change handler for pre-filling chat input */
  onInputChange?: (sessionId: string, value: string) => void
  /** Sidebar mode setter */
  onSidebarNavigate?: (
    mode: 'chats' | 'sources',
    filter?: { kind: string; id?: string }
  ) => void
  /** Whether the app is ready to navigate */
  isReady?: boolean
}

export function NavigationProvider({
  children,
  workspaceId,
  onCreateSession,
  onInputChange,
  onSidebarNavigate,
  isReady = true,
}: NavigationProviderProps) {
  const {
    openChatTab,
    openSettingsTab,
    openShortcutsTab,
    openPreferencesTab,
    openAgentInfoTab,
    openSourceInfoTab,
    openFileTab,
    openBrowserTab,
  } = useTabs()

  // Queue navigation if not ready yet
  const pendingNavigationRef = useRef<ParsedRoute | null>(null)

  // Handle tab navigation
  const handleTabNavigation = useCallback(
    (parsed: ParsedRoute) => {
      if (!workspaceId) return

      switch (parsed.name) {
        case 'settings':
          openSettingsTab()
          break

        case 'shortcuts':
          openShortcutsTab()
          break

        case 'preferences':
          openPreferencesTab()
          break

        case 'chat':
          if (parsed.id) {
            openChatTab(parsed.id, workspaceId, 'Chat')
          }
          break

        case 'agent-info':
          if (parsed.id) {
            openAgentInfoTab(parsed.id, workspaceId, 'Agent')
          }
          break

        case 'source-info':
          if (parsed.id) {
            const agentSlug = parsed.params.agentSlug
            // Source name will be loaded by the tab panel - pass placeholder
            openSourceInfoTab(parsed.id, workspaceId, 'Source', agentSlug)
          }
          break

        case 'file':
          if (parsed.params.path) {
            openFileTab(parsed.params.path)
          }
          break

        case 'browser':
          if (parsed.params.url) {
            openBrowserTab(parsed.params.url)
          }
          break

        default:
          console.warn('[Navigation] Unknown tab:', parsed.name)
      }
    },
    [
      workspaceId,
      openChatTab,
      openSettingsTab,
      openShortcutsTab,
      openPreferencesTab,
      openAgentInfoTab,
      openSourceInfoTab,
      openFileTab,
      openBrowserTab,
    ]
  )

  // Handle action navigation
  const handleActionNavigation = useCallback(
    async (parsed: ParsedRoute) => {
      if (!workspaceId) return

      switch (parsed.name) {
        case 'new-chat': {
          const session = await onCreateSession(
            workspaceId,
            parsed.params.agentId
          )

          // Rename session if name provided
          if (parsed.params.name) {
            await window.electronAPI.sessionCommand(session.id, { type: 'rename', name: parsed.params.name })
          }

          openChatTab(
            session.id,
            workspaceId,
            parsed.params.name || session.name || 'New Chat',
            parsed.params.agentId,
            { forceNew: true }
          )

          // Pre-fill input if provided
          if (parsed.params.input && onInputChange) {
            setTimeout(() => {
              onInputChange(session.id, parsed.params.input!)
            }, 100)
          }
          break
        }

        case 'rename-session':
          if (parsed.id && parsed.params.name) {
            await window.electronAPI.sessionCommand(parsed.id, { type: 'rename', name: parsed.params.name })
          }
          break

        case 'delete-session':
          if (parsed.id) {
            await window.electronAPI.deleteSession(parsed.id)
          }
          break

        case 'flag-session':
          if (parsed.id) {
            await window.electronAPI.sessionCommand(parsed.id, { type: 'flag' })
          }
          break

        case 'unflag-session':
          if (parsed.id) {
            await window.electronAPI.sessionCommand(parsed.id, { type: 'unflag' })
          }
          break

        // Note: archive/unarchive could be added when API is available
        // case 'archive-session':
        // case 'unarchive-session':

        case 'oauth':
          if (parsed.id) {
            await window.electronAPI.startSourceOAuth(workspaceId, parsed.id)
          }
          break

        // Note: test-source could be added when API is available
        // case 'test-source':

        case 'delete-source':
          if (parsed.id) {
            await window.electronAPI.deleteSource(workspaceId, parsed.id)
          }
          break

        case 'activate-agent':
          if (parsed.id) {
            await window.electronAPI.activateAgent(workspaceId, parsed.id)
          }
          break

        case 'deactivate-agent':
          if (parsed.id) {
            await window.electronAPI.deactivateAgent(workspaceId, parsed.id)
          }
          break

        case 'set-mode':
          if (parsed.id && parsed.params.mode) {
            await window.electronAPI.sessionCommand(
              parsed.id,
              { type: 'setPermissionMode', mode: parsed.params.mode as 'safe' | 'ask' | 'allow-all' }
            )
          }
          break

        case 'copy':
          if (parsed.params.text) {
            await navigator.clipboard.writeText(parsed.params.text)
          }
          break

        default:
          console.warn('[Navigation] Unknown action:', parsed.name)
      }
    },
    [workspaceId, onCreateSession, onInputChange, openChatTab]
  )

  // Handle sidebar navigation
  const handleSidebarNavigation = useCallback(
    (parsed: ParsedRoute) => {
      if (!onSidebarNavigate) {
        console.warn('[Navigation] Sidebar navigation not configured')
        return
      }

      switch (parsed.name) {
        case 'inbox':
          onSidebarNavigate('chats', { kind: 'inbox' })
          break

        case 'archive':
          onSidebarNavigate('chats', { kind: 'archive' })
          break

        case 'flagged':
          onSidebarNavigate('chats', { kind: 'flagged' })
          break

        case 'sources':
          onSidebarNavigate('sources')
          break

        case 'agent':
          if (parsed.id) {
            onSidebarNavigate('chats', { kind: 'agent', id: parsed.id })
          }
          break

        case 'state':
          if (parsed.id) {
            onSidebarNavigate('chats', { kind: 'state', id: parsed.id })
          }
          break

        default:
          console.warn('[Navigation] Unknown sidebar:', parsed.name)
      }
    },
    [onSidebarNavigate]
  )

  // Main navigate function
  const navigate = useCallback(
    async (route: Route) => {
      const parsed = parseRoute(route)
      if (!parsed) {
        console.warn('[Navigation] Invalid route:', route)
        return
      }

      if (!isReady) {
        pendingNavigationRef.current = parsed
        return
      }

      console.log('[Navigation] Navigating:', parsed)

      switch (parsed.type) {
        case 'tab':
          handleTabNavigation(parsed)
          break

        case 'action':
          await handleActionNavigation(parsed)
          break

        case 'sidebar':
          handleSidebarNavigation(parsed)
          break
      }
    },
    [isReady, handleTabNavigation, handleActionNavigation, handleSidebarNavigation]
  )

  // Process pending navigation when ready
  useEffect(() => {
    if (isReady && pendingNavigationRef.current) {
      const pending = pendingNavigationRef.current
      pendingNavigationRef.current = null

      switch (pending.type) {
        case 'tab':
          handleTabNavigation(pending)
          break
        case 'action':
          handleActionNavigation(pending)
          break
        case 'sidebar':
          handleSidebarNavigation(pending)
          break
      }
    }
  }, [isReady, handleTabNavigation, handleActionNavigation, handleSidebarNavigation])

  // Listen for deep link navigation events from main process
  useEffect(() => {
    if (!workspaceId) return

    const cleanup = window.electronAPI.onDeepLinkNavigate((nav: DeepLinkNavigation) => {
      // Convert DeepLinkNavigation to route string and navigate
      let route: string | null = null

      if (nav.tabType) {
        route = `tab/${nav.tabType}`
        if (nav.tabParams?.id) {
          route += `/${nav.tabParams.id}`
        }
        if (nav.tabParams?.secondaryId) {
          route += `/${nav.tabParams.secondaryId}`
        }
        // Add remaining params as query string
        const otherParams = { ...nav.tabParams }
        delete otherParams.id
        delete otherParams.secondaryId
        if (Object.keys(otherParams).length > 0) {
          const params = new URLSearchParams(otherParams)
          route += `?${params.toString()}`
        }
      } else if (nav.action) {
        route = `action/${nav.action}`
        if (nav.actionParams?.id) {
          route += `/${nav.actionParams.id}`
        }
        const otherParams = { ...nav.actionParams }
        delete otherParams.id
        if (Object.keys(otherParams).length > 0) {
          const params = new URLSearchParams(otherParams)
          route += `?${params.toString()}`
        }
      } else if (nav.sidebar) {
        route = `sidebar/${nav.sidebar}`
        if (nav.sidebarParams?.id) {
          route += `/${nav.sidebarParams.id}`
        }
      }

      if (route) {
        navigate(route as Route)
      }
    })

    return cleanup
  }, [workspaceId, navigate])

  // Listen for internal navigation events (from navigate() calls)
  useEffect(() => {
    const handleNavigateEvent = (event: Event) => {
      const customEvent = event as CustomEvent<{ route: Route }>
      if (customEvent.detail?.route) {
        navigate(customEvent.detail.route)
      }
    }

    window.addEventListener(NAVIGATE_EVENT, handleNavigateEvent)
    return () => {
      window.removeEventListener(NAVIGATE_EVENT, handleNavigateEvent)
    }
  }, [navigate])

  return (
    <NavigationContext.Provider value={{ navigate, isReady }}>
      {children}
    </NavigationContext.Provider>
  )
}

/**
 * Hook to access navigation functions
 */
export function useNavigation() {
  const context = useContext(NavigationContext)
  if (!context) {
    throw new Error('useNavigation must be used within NavigationProvider')
  }
  return context
}
