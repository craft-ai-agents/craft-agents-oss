/**
 * NavigationContext
 *
 * Provides a global `navigate()` function that decouples components from
 * direct session/action imports. All navigation goes through typed routes.
 *
 * UNIFIED NAVIGATION STATE:
 * This context now maintains a single NavigationState that determines all 3 panels:
 * - LeftSidebar: highlighted item (derived from navigator + filter/subpage)
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
 *   navigate(routes.view.allChats())
 *   navigate(routes.action.newChat())
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
import { toast } from 'sonner'
import { useAtomValue, useSetAtom } from 'jotai'
import { useSession } from '@/hooks/useSession'
import {
  parseRoute,
  parseRouteToNavigationState,
  buildRouteFromNavigationState,
  buildUrlWithState,
  type ParsedRoute,
} from '../../shared/route-parser'
import { routes, type Route } from '../../shared/routes'
import { NAVIGATE_EVENT } from '../lib/navigate'
import type {
  DeepLinkNavigation,
  Session,
  NavigationState,
  ChatFilter,
  SourceFilter,
  RightSidebarPanel,
  ContentBadge,
} from '../../shared/types'
import {
  isChatsNavigation,
  isSourcesNavigation,
  isSettingsNavigation,
  isSkillsNavigation,
  DEFAULT_NAVIGATION_STATE,
} from '../../shared/types'
import { sessionMetaMapAtom, updateSessionMetaAtom, type SessionMeta } from '@/atoms/sessions'
import { sourcesAtom } from '@/atoms/sources'
import { skillsAtom } from '@/atoms/skills'

// Re-export routes for convenience
export { routes }
export type { Route }

// Re-export navigation state types for consumers
export type { NavigationState, ChatFilter }
export { isChatsNavigation, isSourcesNavigation, isSettingsNavigation, isSkillsNavigation }

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
  /** Update right sidebar panel */
  updateRightSidebar: (panel: RightSidebarPanel | undefined) => void
  /** Toggle right sidebar (with optional panel) */
  toggleRightSidebar: (panel?: RightSidebarPanel) => void
  /** Navigate to a source (or source list if no slug), preserving the current filter type */
  navigateToSource: (sourceSlug?: string) => void
}

const NavigationContext = createContext<NavigationContextValue | null>(null)

interface NavigationProviderProps {
  children: ReactNode
  /** Current workspace ID */
  workspaceId: string | null
  /** Session creation handler */
  onCreateSession: (workspaceId: string, options?: import('../../shared/types').CreateSessionOptions) => Promise<Session>
  /** Input change handler for pre-filling chat input */
  onInputChange?: (sessionId: string, value: string) => void
  /** Whether the app is ready to navigate */
  isReady?: boolean
}

export function NavigationProvider({
  children,
  workspaceId,
  onCreateSession,
  onInputChange,
  isReady = true,
}: NavigationProviderProps) {
  const [, setSession] = useSession()

  // Read session metadata directly from atom (reactive to session changes)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const sessionMetas = useMemo(() => Array.from(sessionMetaMap.values()), [sessionMetaMap])
  const updateSessionMeta = useSetAtom(updateSessionMetaAtom)

  // Read sources from atom (populated by AppShell)
  const sources = useAtomValue(sourcesAtom)

  // Read skills from atom (populated by AppShell)
  const skills = useAtomValue(skillsAtom)

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
  // Always excludes hidden sessions - they should never appear in navigation
  const filterSessionsByFilter = useCallback(
    (filter: ChatFilter): SessionMeta[] => {
      // First filter out hidden sessions - they should never appear in any view
      const visibleSessions = sessionMetas.filter(s => !s.hidden)

      return visibleSessions.filter((session) => {
        switch (filter.kind) {
          case 'allChats':
            return true
          case 'flagged':
            return session.isFlagged === true
          case 'state':
            return session.todoState === filter.stateId
          case 'workingDir':
            return session.workingDirectory === filter.workingDir
          default:
            return false
        }
      })
    },
    [sessionMetas]
  )

  // Helper: Get first session ID for a filter
  const getFirstSessionId = useCallback(
    (filter: ChatFilter): string | null => {
      const filtered = filterSessionsByFilter(filter)
      return filtered[0]?.id ?? null
    },
    [filterSessionsByFilter]
  )

  // Helper: Get first source slug (optionally filtered by type)
  const getFirstSourceSlug = useCallback(
    (filter?: SourceFilter | null): string | null => {
      // If no filter, return first source
      if (!filter) {
        return sources[0]?.config.slug ?? null
      }
      // Filter by source type and return first match
      const filtered = sources.filter(s => s.config.type === filter.sourceType)
      return filtered[0]?.config.slug ?? null
    },
    [sources]
  )

  // Helper: Get first skill slug
  const getFirstSkillSlug = useCallback(
    (): string | null => {
      return skills[0]?.slug ?? null
    },
    [skills]
  )

  // Handle action navigation (side effects that don't change navigation state)
  const handleActionNavigation = useCallback(
    async (parsed: ParsedRoute) => {
      if (!workspaceId) return

      switch (parsed.name) {
        case 'new-chat': {
          // Create session with optional permission mode and working directory from params
          const createOptions: import('../../shared/types').CreateSessionOptions = {}
          if (parsed.params.mode && ['safe', 'ask', 'allow-all'].includes(parsed.params.mode)) {
            createOptions.permissionMode = parsed.params.mode as 'safe' | 'ask' | 'allow-all'
          }
          // Handle workdir param: 'user_default', 'none', or absolute path
          if (parsed.params.workdir) {
            createOptions.workingDirectory = parsed.params.workdir as 'user_default' | 'none' | string
          }
          // Model override for mini agents (e.g., 'haiku', 'sonnet')
          if (parsed.params.model) {
            createOptions.model = parsed.params.model
          }
          // System prompt preset for mini agents (e.g., 'mini')
          if (parsed.params.systemPrompt) {
            createOptions.systemPromptPreset = parsed.params.systemPrompt as 'default' | 'mini' | string
          }
          // Log mini agent deep link params
          if (parsed.params.model || parsed.params.systemPrompt) {
            console.log('[NavigationContext] 🤖 Mini agent params from deep link:', {
              model: parsed.params.model,
              systemPromptPreset: parsed.params.systemPrompt,
            })
          }
          const session = await onCreateSession(workspaceId, createOptions)

          // Rename session if name provided
          if (parsed.params.name) {
            await window.electronAPI.sessionCommand(session.id, { type: 'rename', name: parsed.params.name })
          }

          // Optimistically update session meta so it matches the filter immediately
          // (avoids flicker while waiting for the event round-trip from main process)
          if (parsed.params.status) {
            updateSessionMeta(session.id, { todoState: parsed.params.status })
          }
          if (parsed.params.label) {
            updateSessionMeta(session.id, { labels: [parsed.params.label] })
          }

          // Apply status (todo state) to new session if specified
          if (parsed.params.status) {
            await window.electronAPI.sessionCommand(session.id, { type: 'setTodoState', state: parsed.params.status })
          }

          // Apply label to new session if specified
          if (parsed.params.label) {
            await window.electronAPI.sessionCommand(session.id, { type: 'setLabels', labels: [parsed.params.label] })
          }

          // Determine navigation filter — preserve status/label/workdir context if the new session was created with one
          const filter: import('../../shared/types').ChatFilter =
            parsed.params.status ? { kind: 'state', stateId: parsed.params.status } :
            parsed.params.label ? { kind: 'label', labelId: parsed.params.label } :
            parsed.params.workdir ? { kind: 'workingDir', workingDir: parsed.params.workdir } :
            { kind: 'allChats' }

          setSession({ selected: session.id })
          setNavigationState({
            navigator: 'chats',
            filter,
            details: { type: 'chat', sessionId: session.id },
          })

          // Parse badges from params (JSON-encoded, used for EditPopover context hiding)
          let badges: ContentBadge[] | undefined
          if (parsed.params.badges) {
            try {
              badges = JSON.parse(parsed.params.badges) as ContentBadge[]
            } catch (e) {
              console.warn('[Navigation] Failed to parse badges param:', e)
            }
          }

          // Handle input: either auto-send (if send=true) or pre-fill
          if (parsed.params.input) {
            const shouldSend = parsed.params.send === 'true'
            // Resolve input with placeholder replacement (e.g., {{clipboard}})
            const resolveInput = async (input: string): Promise<string> => {
              if (input === '{{clipboard}}') {
                try {
                  return await navigator.clipboard.readText()
                } catch (e) {
                  console.warn('[Navigation] Failed to read clipboard:', e)
                  return ''
                }
              }
              return input
            }
            if (shouldSend) {
              // Auto-send the message immediately after session is ready
              // Pass badges in options so they're stored with the message
              setTimeout(async () => {
                const inputText = await resolveInput(parsed.params.input!)
                if (inputText) {
                  window.electronAPI.sendMessage(
                    session.id,
                    inputText,
                    undefined, // attachments
                    undefined, // storedAttachments
                    badges ? { badges } : undefined
                  )
                }
              }, 100)
            } else if (onInputChange) {
              // Pre-fill input box without sending
              setTimeout(async () => {
                const inputText = await resolveInput(parsed.params.input!)
                onInputChange(session.id, inputText)
              }, 100)
            }
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


  /**
   * Apply navigation state with auto-selection logic
   *
   * When navigating to a filter without explicit details,
   * auto-select the first available item. This ensures the main content
   * panel always shows meaningful content when possible.
   *
   * Returns the final NavigationState (with auto-selection applied if any)
   * so the caller can update the URL with the correct route.
   */
  const applyNavigationState = useCallback(
    (newState: NavigationState): NavigationState => {
      // For chats: auto-select first session if no details provided
      if (isChatsNavigation(newState) && !newState.details) {
        const firstSessionId = getFirstSessionId(newState.filter)
        if (firstSessionId) {
          const stateWithSelection: NavigationState = {
            ...newState,
            details: { type: 'chat', sessionId: firstSessionId },
          }
          setSession({ selected: firstSessionId })
          setNavigationState(stateWithSelection)
          return stateWithSelection
        } else {
          setSession({ selected: null })
          setNavigationState(newState)
          return newState
        }
      }

      // For sources: auto-select first source if no details provided (respects filter)
      if (isSourcesNavigation(newState) && !newState.details) {
        const firstSourceSlug = getFirstSourceSlug(newState.filter)
        if (firstSourceSlug) {
          const stateWithSelection: NavigationState = {
            ...newState,
            details: { type: 'source', sourceSlug: firstSourceSlug },
          }
          setNavigationState(stateWithSelection)
          return stateWithSelection
        } else {
          setNavigationState(newState)
          return newState
        }
      }

      // For skills: auto-select first skill if no details provided
      if (isSkillsNavigation(newState) && !newState.details) {
        const firstSkillSlug = getFirstSkillSlug()
        if (firstSkillSlug) {
          const stateWithSelection: NavigationState = {
            ...newState,
            details: { type: 'skill', skillSlug: firstSkillSlug },
          }
          setNavigationState(stateWithSelection)
          return stateWithSelection
        } else {
          setNavigationState(newState)
          return newState
        }
      }

      // For chats with explicit session: update session selection
      if (isChatsNavigation(newState) && newState.details) {
        setSession({ selected: newState.details.sessionId })
      }

      // Apply state directly
      setNavigationState(newState)
      return newState
    },
    [getFirstSessionId, getFirstSourceSlug, getFirstSkillSlug, setSession]
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

      // Handle actions (side effects)
      if (parsed.type === 'action') {
        await handleActionNavigation(parsed)
        return // Actions handle their own state updates
      }

      // Parse route to unified NavigationState (with sidebar param from current URL)
      const urlParams = new URLSearchParams(window.location.search)
      const sidebarParam = urlParams.get('sidebar') || undefined
      const newNavState = parseRouteToNavigationState(route, sidebarParam)
      let finalRoute = route

      if (newNavState) {
        // Apply navigation state (may auto-select first item)
        const finalState = applyNavigationState(newNavState)

        // Build route from final state (includes auto-selection)
        // This ensures the URL reflects the actual displayed content
        finalRoute = buildRouteFromNavigationState(finalState) as Route
      }

      // Persist route and sidebar in URL for reload restoration
      const url = new URL(window.location.href)
      if (navigationState.rightSidebar) {
        const fullUrl = buildUrlWithState(navigationState)
        url.search = fullUrl
      } else {
        url.searchParams.set('route', finalRoute)
        url.searchParams.delete('sidebar')
      }
      history.replaceState({ route: finalRoute }, '', url.toString())

      // Update our custom history stack (unless we're navigating via back/forward)
      if (isNavigatingHistoryRef.current) {
        isNavigatingHistoryRef.current = false
        console.log('[Navigation] Skipping history push (navigating via back/forward)')
      } else {
        // Only push if route is different from current route (avoid duplicates)
        const currentRoute = historyStackRef.current[historyIndexRef.current]
        if (finalRoute !== currentRoute) {
          // When navigating to a new route, truncate forward history and push
          const newIndex = historyIndexRef.current + 1
          historyStackRef.current = historyStackRef.current.slice(0, newIndex)
          historyStackRef.current.push(finalRoute)
          historyIndexRef.current = newIndex
          console.log('[Navigation] Pushed to history:', finalRoute, 'index:', newIndex, 'stack length:', historyStackRef.current.length)
        } else {
          console.log('[Navigation] Skipping duplicate route:', finalRoute)
        }
      }

      // Update back/forward availability
      const newCanGoBack = historyIndexRef.current > 0
      const newCanGoForward = historyIndexRef.current < historyStackRef.current.length - 1
      console.log('[Navigation] Updating canGoBack:', newCanGoBack, 'canGoForward:', newCanGoForward)
      setCanGoBack(newCanGoBack)
      setCanGoForward(newCanGoForward)
    },
    [isReady, handleActionNavigation, applyNavigationState]
  )

  // Keep navigateRef in sync with latest navigate function
  useEffect(() => {
    navigateRef.current = navigate
  }, [navigate])

  // Helper: Check if a route points to a valid session/source/skill
  // For sessions, also check that the session is not hidden (hidden sessions are not directly navigable)
  const isRouteValid = useCallback((route: Route): boolean => {
    const navState = parseRouteToNavigationState(route)
    if (!navState) return true // Non-navigation routes are always valid

    if (isChatsNavigation(navState) && navState.details) {
      const meta = sessionMetaMap.get(navState.details.sessionId)
      // Session must exist and not be hidden
      return meta != null && !meta.hidden
    }

    if (isSourcesNavigation(navState) && navState.details) {
      return sources.some(s => s.config.slug === navState.details!.sourceSlug)
    }

    if (isSkillsNavigation(navState) && navState.details) {
      if (navState.details.type === 'skill') {
        const { skillSlug } = navState.details
        return skills.some(s => s.slug === skillSlug)
      }
      return true
    }

    return true // Routes without details are always valid
  }, [sessionMetaMap, sources, skills])

  // Go back in history (using our custom stack)
  // When encountering invalid entries (deleted sessions/sources), remove them from the stack
  const goBack = useCallback(() => {
    const currentIndex = historyIndexRef.current
    console.log('[Navigation] goBack called, current index:', currentIndex, 'stack length:', historyStackRef.current.length)

    if (currentIndex <= 0) {
      console.log('[Navigation] Already at beginning of history')
      return
    }

    // Find first valid entry going backwards, collecting indices of invalid entries
    const invalidIndices: number[] = []
    let targetIndex = -1

    for (let i = currentIndex - 1; i >= 0; i--) {
      const route = historyStackRef.current[i]
      if (isRouteValid(route)) {
        targetIndex = i
        break
      }
      invalidIndices.push(i)
      console.log('[Navigation] Marking invalid history entry for removal:', route)
    }

    // Remove invalid entries from stack (in reverse order to preserve indices)
    if (invalidIndices.length > 0) {
      for (const idx of invalidIndices.sort((a, b) => b - a)) {
        historyStackRef.current.splice(idx, 1)
      }
      console.log('[Navigation] Removed', invalidIndices.length, 'invalid entries from history')
    }

    // Recalculate target index after removal
    if (targetIndex >= 0) {
      // Adjust for removed entries that were before the target
      const removedBefore = invalidIndices.filter(i => i < targetIndex).length
      targetIndex -= removedBefore
    }

    // Also adjust current index for removed entries
    const removedBeforeCurrent = invalidIndices.filter(i => i < currentIndex).length
    historyIndexRef.current = currentIndex - removedBeforeCurrent

    if (targetIndex >= 0) {
      historyIndexRef.current = targetIndex
      isNavigatingHistoryRef.current = true
      const route = historyStackRef.current[targetIndex]
      console.log('[Navigation] Going back to:', route, 'new index:', targetIndex)
      navigateRef.current?.(route)
    } else {
      console.log('[Navigation] No valid history entry to go back to')
      // Update canGoBack/canGoForward since we may have removed entries
      setCanGoBack(historyIndexRef.current > 0)
      setCanGoForward(historyIndexRef.current < historyStackRef.current.length - 1)
    }
  }, [isRouteValid])

  // Go forward in history (using our custom stack)
  // When encountering invalid entries (deleted sessions/sources), remove them from the stack
  const goForward = useCallback(() => {
    const currentIndex = historyIndexRef.current
    const stackLength = historyStackRef.current.length
    console.log('[Navigation] goForward called, current index:', currentIndex, 'stack length:', stackLength)

    if (currentIndex >= stackLength - 1) {
      console.log('[Navigation] Already at end of history')
      return
    }

    // Find first valid entry going forwards, collecting indices of invalid entries
    const invalidIndices: number[] = []
    let targetIndex = -1

    for (let i = currentIndex + 1; i < stackLength; i++) {
      const route = historyStackRef.current[i]
      if (isRouteValid(route)) {
        targetIndex = i
        break
      }
      invalidIndices.push(i)
      console.log('[Navigation] Marking invalid history entry for removal:', route)
    }

    // Remove invalid entries from stack (in reverse order to preserve indices)
    if (invalidIndices.length > 0) {
      for (const idx of invalidIndices.sort((a, b) => b - a)) {
        historyStackRef.current.splice(idx, 1)
      }
      console.log('[Navigation] Removed', invalidIndices.length, 'invalid entries from history')
    }

    // Recalculate target index after removal (invalid entries were between current and target)
    if (targetIndex >= 0) {
      targetIndex -= invalidIndices.length
    }

    if (targetIndex >= 0 && targetIndex < historyStackRef.current.length) {
      historyIndexRef.current = targetIndex
      isNavigatingHistoryRef.current = true
      const route = historyStackRef.current[targetIndex]
      console.log('[Navigation] Going forward to:', route, 'new index:', targetIndex)
      navigateRef.current?.(route)
    } else {
      console.log('[Navigation] No valid history entry to go forward to')
      // Update canGoBack/canGoForward since we may have removed entries
      setCanGoBack(historyIndexRef.current > 0)
      setCanGoForward(historyIndexRef.current < historyStackRef.current.length - 1)
    }
  }, [isRouteValid])

  // Track whether initial route restoration has been attempted
  const initialRouteRestoredRef = useRef(false)

  // Track previous workspace to detect switches
  const previousWorkspaceIdRef = useRef<string | null>(null)

  // Reset navigation state when workspace changes
  // This prevents back/forward navigating to sessions from the wrong workspace
  // and ensures sidebar doesn't show stale context
  useEffect(() => {
    if (!workspaceId) return

    // Skip on initial mount (no previous workspace)
    if (previousWorkspaceIdRef.current !== null && previousWorkspaceIdRef.current !== workspaceId) {
      console.log('[Navigation] Workspace changed, resetting navigation state')

      // Clear history stack - old routes belong to previous workspace
      historyStackRef.current = []
      historyIndexRef.current = -1
      setCanGoBack(false)
      setCanGoForward(false)

      // Close right sidebar - its context is workspace-specific
      setNavigationState(prev => ({
        ...prev,
        rightSidebar: undefined,
      }))

      // Reset initial route restoration flag so new workspace can restore its route
      initialRouteRestoredRef.current = false
    }

    previousWorkspaceIdRef.current = workspaceId
  }, [workspaceId])

  // Initialize history stack on first load
  useEffect(() => {
    if (!isReady || !workspaceId) return

    // Only initialize once
    if (historyStackRef.current.length === 0) {
      const params = new URLSearchParams(window.location.search)
      const initialRoute = (params.get('route') || 'allChats') as Route
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

      // Handle actions
      if (pending.type === 'action') {
        handleActionNavigation(pending)
        return
      }

      // For view routes, reconstruct route string and parse to NavigationState
      const navState = parseRouteToNavigationState(`${pending.name}${pending.id ? `/${pending.id}` : ''}`)
      if (navState) {
        applyNavigationState(navState)
      }
    }
  }, [isReady, handleActionNavigation, applyNavigationState])

  // Restore route from URL on startup (for CMD+R reload)
  useEffect(() => {
    if (!isReady || !workspaceId || initialRouteRestoredRef.current) return
    initialRouteRestoredRef.current = true

    const params = new URLSearchParams(window.location.search)
    const initialRoute = params.get('route')
    const sidebarParam = params.get('sidebar') || undefined

    if (initialRoute) {
      console.log('[Navigation] Restoring route from URL:', initialRoute, 'sidebar:', sidebarParam)

      // Parse with sidebar param
      const navState = parseRouteToNavigationState(initialRoute, sidebarParam)
      if (navState) {
        applyNavigationState(navState)
      } else {
        navigate(initialRoute as Route)
      }
    }
  }, [isReady, workspaceId, navigate, applyNavigationState])

  // Listen for deep link navigation events from main process
  useEffect(() => {
    if (!workspaceId) return

    const cleanup = window.electronAPI.onDeepLinkNavigate((nav: DeepLinkNavigation) => {
      // Convert DeepLinkNavigation to route string and navigate
      let route: string | null = null

      // Compound route format (e.g., 'allChats/chat/abc123', 'settings/shortcuts')
      if (nav.view) {
        route = nav.view
      } else if (nav.action) {
        // Action routes (e.g., 'action/new-chat', 'action/delete-session/abc123')
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
      }

      if (route) {
        // Validate the route before navigating
        const navState = parseRouteToNavigationState(route)
        if (!navState && !route.startsWith('action/')) {
          // Invalid route that isn't an action - show error toast
          toast.error('Invalid link', {
            description: 'The content may have been moved or deleted.',
          })
          return
        }
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

  // Right sidebar navigation helpers
  const updateRightSidebar = useCallback((panel: RightSidebarPanel | undefined) => {
    if (!navigationState) return

    const newState = {
      ...navigationState,
      rightSidebar: panel,
    }

    setNavigationState(newState)

    // Update URL with sidebar param
    const url = buildUrlWithState(newState)
    const fullUrl = new URL(window.location.href)
    fullUrl.search = url
    history.replaceState({ route: buildRouteFromNavigationState(newState) }, '', fullUrl.toString())
  }, [navigationState])

  const toggleRightSidebar = useCallback((panel?: RightSidebarPanel) => {
    if (!navigationState) return

    // If panel specified, open to that panel
    // If no panel, toggle between closed and default panel (sessionMetadata)
    const newPanel = panel || (navigationState.rightSidebar && navigationState.rightSidebar.type !== 'none'
      ? { type: 'none' as const }
      : { type: 'sessionMetadata' as const })

    updateRightSidebar(newPanel)
  }, [navigationState, updateRightSidebar])

  // Navigate to a source (or source list) while preserving the current filter type (api/mcp/local)
  const navigateToSource = useCallback((sourceSlug?: string) => {
    if (isSourcesNavigation(navigationState) && navigationState.filter?.kind === 'type') {
      switch (navigationState.filter.sourceType) {
        case 'api':
          navigate(routes.view.sourcesApi(sourceSlug))
          return
        case 'mcp':
          navigate(routes.view.sourcesMcp(sourceSlug))
          return
        case 'local':
          navigate(routes.view.sourcesLocal(sourceSlug))
          return
      }
    }
    // No filter or 'all' filter - navigate without preserving type
    navigate(routes.view.sources(sourceSlug ? { sourceSlug } : undefined))
  }, [navigationState, navigate])

  return (
    <NavigationContext.Provider
      value={{
        navigate,
        isReady,
        navigationState,
        canGoBack,
        canGoForward,
        goBack,
        goForward,
        updateRightSidebar,
        toggleRightSidebar,
        navigateToSource,
      }}
    >
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
