/**
 * NavigationContext
 *
 * Provides a global `navigate()` function that decouples components from
 * direct session/action imports. All navigation goes through typed routes.
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
  useState,
  type ReactNode,
} from 'react'
import { useSession } from '@/hooks/useSession'
import { parseRoute, type ParsedRoute } from '../../shared/route-parser'
import { routes, type Route } from '../../shared/routes'
import { NAVIGATE_EVENT } from '../lib/navigate'
import type { DeepLinkNavigation, Session } from '../../shared/types'

// Re-export routes for convenience
export { routes }
export type { Route }

/**
 * Represents the current view in the main content panel.
 * - 'chat': Display the selected session's chat
 * - 'settings': Display the settings page
 * - 'preferences': Display the preferences page
 * - 'shortcuts': Display the keyboard shortcuts page
 * - 'source-info': Display source info (with sourceSlug, agentSlug)
 * - 'agent-info': Display agent info (with agentId)
 */
export type ActiveView =
  | { type: 'chat' }
  | { type: 'settings' }
  | { type: 'preferences' }
  | { type: 'shortcuts' }
  | { type: 'source-info'; sourceSlug: string; agentSlug?: string }
  | { type: 'agent-info'; agentId: string; agentName: string }

interface NavigationContextValue {
  /** Navigate to a route */
  navigate: (route: Route) => void | Promise<void>
  /** Check if navigation is ready */
  isReady: boolean
  /** Current active view in main content panel */
  activeView: ActiveView
  /** Whether we can go back in history */
  canGoBack: boolean
  /** Whether we can go forward in history */
  canGoForward: boolean
  /** Go back in history */
  goBack: () => void
  /** Go forward in history */
  goForward: () => void
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
  /** List of agents (for agent name lookup) */
  agents?: Array<{ id: string; name: string }>
}

export function NavigationProvider({
  children,
  workspaceId,
  onCreateSession,
  onInputChange,
  onSidebarNavigate,
  isReady = true,
  agents = [],
}: NavigationProviderProps) {
  const [, setSession] = useSession()

  // Active view state - defaults to chat view
  const [activeView, setActiveView] = useState<ActiveView>({ type: 'chat' })

  // Track history state for back/forward buttons
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)

  // Custom history stack (browser history doesn't work reliably in Electron)
  const historyStackRef = useRef<Route[]>([])
  const historyIndexRef = useRef(-1)

  // Flag to prevent pushing to history when navigating via back/forward
  const isNavigatingHistoryRef = useRef(false)

  // Ref to hold the latest navigate function (avoids stale closure in goBack/goForward)
  const navigateRef = useRef<((route: Route) => void | Promise<void>) | null>(null)

  // Queue navigation if not ready yet
  const pendingNavigationRef = useRef<ParsedRoute | null>(null)

  // Handle tab navigation - sets activeView for main content panel
  const handleTabNavigation = useCallback(
    (parsed: ParsedRoute) => {
      if (!workspaceId) return

      switch (parsed.name) {
        case 'settings':
          setActiveView({ type: 'settings' })
          break

        case 'shortcuts':
          setActiveView({ type: 'shortcuts' })
          break

        case 'preferences':
          setActiveView({ type: 'preferences' })
          break

        case 'chat':
          if (parsed.id) {
            // Select the session and switch to chat view
            setSession({ selected: parsed.id })
            setActiveView({ type: 'chat' })
          }
          break

        case 'agent-info':
          if (parsed.id) {
            // Find agent name from agents list
            const agent = agents.find(a => a.id === parsed.id)
            setActiveView({
              type: 'agent-info',
              agentId: parsed.id,
              agentName: agent?.name || parsed.id,
            })
          }
          break

        case 'source-info':
          if (parsed.id) {
            setActiveView({
              type: 'source-info',
              sourceSlug: parsed.id,
              agentSlug: parsed.params.agentSlug,
            })
          }
          break

        case 'file':
          // Open file in system viewer
          if (parsed.params.path) {
            window.electronAPI.openFile(parsed.params.path)
          }
          break

        case 'browser':
          // Open URL in system browser
          if (parsed.params.url) {
            window.electronAPI.openUrl(parsed.params.url)
          }
          break

        default:
          console.warn('[Navigation] Unknown tab:', parsed.name)
      }
    },
    [workspaceId, setSession, agents]
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

          // Select the new session and switch to chat view
          setSession({ selected: session.id })
          setActiveView({ type: 'chat' })

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

        case 'oauth':
          if (parsed.id) {
            await window.electronAPI.startSourceOAuth(workspaceId, parsed.id)
          }
          break

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
    [workspaceId, onCreateSession, onInputChange, setSession]
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

      // Persist route in URL for reload restoration (skip actions - they're one-time operations)
      if (parsed.type !== 'action') {
        const url = new URL(window.location.href)
        url.searchParams.set('route', route)
        history.replaceState({ route }, '', url.toString())

        // Update our custom history stack (unless we're navigating via back/forward)
        if (isNavigatingHistoryRef.current) {
          isNavigatingHistoryRef.current = false
          console.log('[Navigation] Skipping history push (navigating via back/forward)')
        } else {
          // Only push if route is different from current route (avoid duplicates)
          const currentRoute = historyStackRef.current[historyIndexRef.current]
          if (route !== currentRoute) {
            // When navigating to a new route, truncate forward history and push
            const newIndex = historyIndexRef.current + 1
            historyStackRef.current = historyStackRef.current.slice(0, newIndex)
            historyStackRef.current.push(route)
            historyIndexRef.current = newIndex
            console.log('[Navigation] Pushed to history:', route, 'index:', newIndex, 'stack length:', historyStackRef.current.length)
          } else {
            console.log('[Navigation] Skipping duplicate route:', route)
          }
        }

        // Update back/forward availability
        const newCanGoBack = historyIndexRef.current > 0
        const newCanGoForward = historyIndexRef.current < historyStackRef.current.length - 1
        console.log('[Navigation] Updating canGoBack:', newCanGoBack, 'canGoForward:', newCanGoForward)
        setCanGoBack(newCanGoBack)
        setCanGoForward(newCanGoForward)
      }
    },
    [isReady, handleTabNavigation, handleActionNavigation, handleSidebarNavigation]
  )

  // Keep navigateRef in sync with latest navigate function
  useEffect(() => {
    navigateRef.current = navigate
  }, [navigate])

  // Go back in history (using our custom stack)
  const goBack = useCallback(() => {
    const newIndex = historyIndexRef.current - 1
    console.log('[Navigation] goBack called, current index:', historyIndexRef.current, 'new index:', newIndex)

    if (newIndex >= 0 && historyStackRef.current[newIndex]) {
      historyIndexRef.current = newIndex
      isNavigatingHistoryRef.current = true
      const route = historyStackRef.current[newIndex]
      console.log('[Navigation] Going back to:', route)
      navigateRef.current?.(route)
    }
  }, [])

  // Go forward in history (using our custom stack)
  const goForward = useCallback(() => {
    const newIndex = historyIndexRef.current + 1
    console.log('[Navigation] goForward called, current index:', historyIndexRef.current, 'new index:', newIndex)

    if (newIndex < historyStackRef.current.length && historyStackRef.current[newIndex]) {
      historyIndexRef.current = newIndex
      isNavigatingHistoryRef.current = true
      const route = historyStackRef.current[newIndex]
      console.log('[Navigation] Going forward to:', route)
      navigateRef.current?.(route)
    }
  }, [])

  // Track whether initial route restoration has been attempted
  const initialRouteRestoredRef = useRef(false)

  // Initialize history stack on first load
  useEffect(() => {
    if (!isReady || !workspaceId) return

    // Only initialize once
    if (historyStackRef.current.length === 0) {
      const params = new URLSearchParams(window.location.search)
      const initialRoute = (params.get('route') || 'tab/chat') as Route
      historyStackRef.current = [initialRoute]
      historyIndexRef.current = 0
      console.log('[Navigation] Initialized history stack with:', initialRoute)
    }
  }, [isReady, workspaceId])

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

  // Restore route from URL on startup (for CMD+R reload)
  useEffect(() => {
    if (!isReady || !workspaceId || initialRouteRestoredRef.current) return
    initialRouteRestoredRef.current = true

    const params = new URLSearchParams(window.location.search)
    const initialRoute = params.get('route')
    if (initialRoute) {
      console.log('[Navigation] Restoring route from URL:', initialRoute)
      navigate(initialRoute as Route)
    }
  }, [isReady, workspaceId, navigate])

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
    <NavigationContext.Provider value={{ navigate, isReady, activeView, canGoBack, canGoForward, goBack, goForward }}>
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

/**
 * Hook to access just the active view state
 */
export function useActiveView(): ActiveView {
  const { activeView } = useNavigation()
  return activeView
}
