/**
 * NavigationContext
 *
 * Provides a global `navigate()` function that decouples components from
 * direct session/action imports. All navigation goes through typed routes.
 *
 * UNIFIED NAVIGATION STATE:
 * This context now maintains a single NavigationState that determines all 3 panels:
 * - LeftSidebar: highlighted item (derived from navigator + filter/category/subpage)
 * - NavigatorPanel: which list to show (derived from navigator)
 * - MainContentPanel: what details to display (derived from details or subpage)
 *
 * Usage:
 *   import { useNavigation, useNavigationState } from '@/contexts/NavigationContext'
 *   import { routes } from '@/shared/routes'
 *
 *   const { navigate } = useNavigation()
 *   const navState = useNavigationState()
 *
 *   navigate(routes.view.inbox())
 *   navigate(routes.action.newChat({ agentId: 'claude' }))
 */

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
  type ReactNode,
} from 'react'
import { useAtomValue } from 'jotai'
import { useSession } from '@/hooks/useSession'
import {
  parseRoute,
  parseRouteToNavigationState,
  buildRouteFromNavigationState,
  type ParsedRoute,
} from '../../shared/route-parser'
import { routes, type Route } from '../../shared/routes'
import { NAVIGATE_EVENT } from '../lib/navigate'
import type {
  DeepLinkNavigation,
  Session,
  NavigationState,
  ChatFilter,
  SourceCategory,
  LoadedSource,
} from '../../shared/types'
import {
  isChatsNavigation,
  isSourcesNavigation,
  isSettingsNavigation,
  DEFAULT_NAVIGATION_STATE,
} from '../../shared/types'
import { sessionMetaMapAtom, type SessionMeta } from '@/atoms/sessions'
import { sourcesAtom } from '@/atoms/sources'

/**
 * Get the category of a source
 */
function getSourceCategory(source: LoadedSource): SourceCategory {
  if (source.config.type === 'local') return 'local-files'
  if (source.config.type === 'mcp' && source.config.mcp?.transport === 'stdio') return 'local-mcp'
  return 'online-sources'
}

// Re-export routes for convenience
export { routes }
export type { Route }

// Re-export navigation state types for consumers
export type { NavigationState, ChatFilter, SourceCategory }
export { isChatsNavigation, isSourcesNavigation, isSettingsNavigation }

interface NavigationContextValue {
  /** Navigate to a route */
  navigate: (route: Route) => void | Promise<void>
  /** Check if navigation is ready */
  isReady: boolean
  /** Unified navigation state - single source of truth for all 3 panels */
  navigationState: NavigationState
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
  isReady = true,
  agents = [],
}: NavigationProviderProps) {
  const [, setSession] = useSession()

  // Read session metadata directly from atom (reactive to session changes)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const sessionMetas = useMemo(() => Array.from(sessionMetaMap.values()), [sessionMetaMap])

  // Read sources from atom (populated by AppShell)
  const sources = useAtomValue(sourcesAtom)

  // UNIFIED NAVIGATION STATE - single source of truth for all 3 panels
  const [navigationState, setNavigationState] = useState<NavigationState>(DEFAULT_NAVIGATION_STATE)

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

  // Helper: Check if a session is "done" (completed or cancelled)
  const isSessionDone = useCallback((session: SessionMeta): boolean => {
    return session.todoState === 'done' || session.todoState === 'cancelled'
  }, [])

  // Helper: Filter sessions by ChatFilter
  const filterSessionsByFilter = useCallback(
    (filter: ChatFilter): SessionMeta[] => {
      return sessionMetas.filter((session) => {
        switch (filter.kind) {
          case 'inbox':
            return !isSessionDone(session)
          case 'archive':
            return isSessionDone(session)
          case 'flagged':
            return session.isFlagged === true
          case 'agent':
            return session.agentId === filter.agentId && !isSessionDone(session)
          case 'state':
            return session.todoState === filter.stateId
          default:
            return false
        }
      })
    },
    [sessionMetas, isSessionDone]
  )

  // Helper: Get first session ID for a filter
  const getFirstSessionId = useCallback(
    (filter: ChatFilter): string | null => {
      const filtered = filterSessionsByFilter(filter)
      return filtered[0]?.id ?? null
    },
    [filterSessionsByFilter]
  )

  // Helper: Get first source slug (optionally filtered by category)
  const getFirstSourceSlug = useCallback(
    (category?: SourceCategory): string | null => {
      const filtered = category
        ? sources.filter(s => getSourceCategory(s) === category)
        : sources
      return filtered[0]?.config.slug ?? null
    },
    [sources]
  )

  // Handle action navigation (side effects that don't change navigation state)
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

          // Update navigation state to show new chat in inbox
          setSession({ selected: session.id })
          setNavigationState({
            navigator: 'chats',
            filter: { kind: 'inbox' },
            details: { type: 'chat', sessionId: session.id },
          })

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

  // Handle special tab routes (file/browser open - not navigation state changes)
  const handleSpecialTabRoutes = useCallback((parsed: ParsedRoute): boolean => {
    switch (parsed.name) {
      case 'file':
        if (parsed.params.path) {
          window.electronAPI.openFile(parsed.params.path)
          return true
        }
        break
      case 'browser':
        if (parsed.params.url) {
          window.electronAPI.openUrl(parsed.params.url)
          return true
        }
        break
    }
    return false
  }, [])

  /**
   * Apply navigation state with auto-selection logic
   *
   * When navigating to a filter/category without explicit details,
   * auto-select the first available item. This ensures the main content
   * panel always shows meaningful content when possible.
   */
  const applyNavigationState = useCallback(
    (newState: NavigationState) => {
      // For chats: auto-select first session if no details provided
      if (isChatsNavigation(newState) && !newState.details) {
        const firstSessionId = getFirstSessionId(newState.filter)
        if (firstSessionId) {
          setSession({ selected: firstSessionId })
          setNavigationState({
            ...newState,
            details: { type: 'chat', sessionId: firstSessionId },
          })
        } else {
          setSession({ selected: null })
          setNavigationState(newState)
        }
        return
      }

      // For sources: auto-select first source if no details provided
      if (isSourcesNavigation(newState) && !newState.details) {
        const firstSourceSlug = getFirstSourceSlug(newState.category)
        if (firstSourceSlug) {
          setNavigationState({
            ...newState,
            details: { type: 'source', sourceSlug: firstSourceSlug },
          })
        } else {
          setNavigationState(newState)
        }
        return
      }

      // For chats with explicit session: update session selection
      if (isChatsNavigation(newState) && newState.details) {
        setSession({ selected: newState.details.sessionId })
      }

      // Apply state directly
      setNavigationState(newState)
    },
    [getFirstSessionId, getFirstSourceSlug, setSession]
  )

  // Main navigate function - unified approach using NavigationState
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

      // Handle special tab routes (file/browser open) that don't change navigation state
      if (parsed.type === 'tab' && handleSpecialTabRoutes(parsed)) {
        return
      }

      // Handle actions (side effects)
      if (parsed.type === 'action') {
        await handleActionNavigation(parsed)
        return // Actions handle their own state updates
      }

      // Parse route to unified NavigationState
      const newNavState = parseRouteToNavigationState(route)
      if (newNavState) {
        applyNavigationState(newNavState)
      }

      // Persist route in URL for reload restoration
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
    },
    [isReady, handleActionNavigation, handleSpecialTabRoutes, applyNavigationState]
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

      // Handle special tab routes
      if (pending.type === 'tab' && handleSpecialTabRoutes(pending)) {
        return
      }

      // Handle actions
      if (pending.type === 'action') {
        handleActionNavigation(pending)
        return
      }

      // For other routes, reconstruct route string and parse to NavigationState
      // This is a fallback - ideally we'd store the original route string
      const navState = parseRouteToNavigationState(`${pending.type}/${pending.name}${pending.id ? `/${pending.id}` : ''}`)
      if (navState) {
        applyNavigationState(navState)
      }
    }
  }, [isReady, handleActionNavigation, handleSpecialTabRoutes, applyNavigationState])

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

      // New compound route format (e.g., 'inbox/chat/abc123', 'settings/shortcuts')
      if (nav.view) {
        route = nav.view
      } else if (nav.tabType) {
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
    <NavigationContext.Provider value={{ navigate, isReady, navigationState, canGoBack, canGoForward, goBack, goForward }}>
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
 * Hook to access just the navigation state
 */
export function useNavigationState(): NavigationState {
  const { navigationState } = useNavigation()
  return navigationState
}
