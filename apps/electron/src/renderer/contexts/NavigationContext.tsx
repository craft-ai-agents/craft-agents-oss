/**
 * NavigationContext
 *
 * Provides a global `navigate()` function that decouples components from
 * direct session/action imports. All navigation goes through typed routes.
 *
 * PEER PANEL MODEL:
 * All panels are equal. The **focused** panel drives the NavigationState
 * (which determines sidebar highlight, navigator content, etc.).
 * `navigate(route)` updates the focused panel's route.
 *
 * SNAPSHOT HISTORY:
 * Every meaningful state change (navigate, panel add/remove, focus change,
 * sidebar toggle) pushes a NavigationSnapshot. Back/forward restores snapshots.
 *
 * Usage:
 *   import { useNavigation, useNavigationState } from '@/contexts/NavigationContext'
 *   import { routes } from '@/shared/routes'
 *
 *   const { navigate } = useNavigation()
 *   const navState = useNavigationState()
 *
 *   navigate(routes.view.allSessions())
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
import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { useSession } from '@/hooks/useSession'
import {
  parseRoute,
  parseRouteToNavigationState,
  buildRouteFromNavigationState,
  buildUrlWithState,
  buildRightSidebarParam,
  type ParsedRoute,
} from '../../shared/route-parser'
import { routes, type Route, type ViewRoute } from '../../shared/routes'
import { NAVIGATE_EVENT, type NavigateOptions } from '../lib/navigate'
import * as storage from '@/lib/local-storage'
import type {
  DeepLinkNavigation,
  Session,
  NavigationState,
  SessionFilter,
  SourceFilter,
  RightSidebarPanel,
  ContentBadge,
} from '../../shared/types'
import {
  isSessionsNavigation,
  isSourcesNavigation,
  isSettingsNavigation,
  isSkillsNavigation,
  DEFAULT_NAVIGATION_STATE,
} from '../../shared/types'
import { isValidSettingsSubpage, type SettingsSubpage } from '../../shared/settings-registry'
import { sessionMetaMapAtom, updateSessionMetaAtom, type SessionMeta } from '@/atoms/sessions'
import { sourcesAtom } from '@/atoms/sources'
import { skillsAtom } from '@/atoms/skills'
import {
  panelStackAtom,
  pushPanelAtom,
  restorePanelStackAtom,
  closeAllOtherPanelsAtom,
  focusedPanelIdAtom,
  focusedPanelRouteAtom,
  focusedPanelIndexAtom,
  updateFocusedPanelRouteAtom,
  parseSessionIdFromRoute,
} from '@/atoms/panel-stack'

// Re-export routes for convenience
export { routes }
export type { Route }

// Re-export navigation state types for consumers
export type { NavigationState, SessionFilter }
export { isSessionsNavigation, isSourcesNavigation, isSettingsNavigation, isSkillsNavigation }

// =============================================================================
// Snapshot History Types
// =============================================================================

interface NavigationSnapshot {
  /** All panels and their routes + proportions */
  panels: { route: ViewRoute; proportion: number }[]
  /** Which panel index is focused */
  focusedIndex: number
  /** Right sidebar state */
  rightSidebar?: RightSidebarPanel
}

/** Compare snapshots for deduplication (ignores proportions — resize shouldn't create history) */
function snapshotsEqual(a: NavigationSnapshot, b: NavigationSnapshot): boolean {
  if (a.focusedIndex !== b.focusedIndex) return false
  if (a.panels.length !== b.panels.length) return false
  for (let i = 0; i < a.panels.length; i++) {
    if (a.panels[i].route !== b.panels[i].route) return false
  }
  if (a.rightSidebar?.type !== b.rightSidebar?.type) return false
  return true
}

// =============================================================================
// Context
// =============================================================================

interface NavigationContextValue {
  /** Navigate to a route */
  navigate: (route: Route, options?: NavigateOptions) => void | Promise<void>
  /** Check if navigation is ready */
  isReady: boolean
  /** Unified navigation state — derived from focused panel + right sidebar */
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
  /** Navigate to a session, preserving the current filter type */
  navigateToSession: (sessionId: string) => void
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
  /** Get draft input text for a session (reads from ref, no re-render) */
  getDraft?: (sessionId: string) => string
  /** Auto-delete an empty session (no confirmation needed) */
  onAutoDeleteEmptySession?: (sessionId: string) => void
  /** Whether the app is ready to navigate */
  isReady?: boolean
}

export function NavigationProvider({
  children,
  workspaceId,
  onCreateSession,
  onInputChange,
  getDraft,
  onAutoDeleteEmptySession,
  isReady = true,
}: NavigationProviderProps) {
  const [, setSession] = useSession()

  // Read session metadata directly from atom (reactive to session changes)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const sessionMetas = useMemo(() => Array.from(sessionMetaMap.values()), [sessionMetaMap])
  const updateSessionMeta = useSetAtom(updateSessionMetaAtom)

  const pushPanel = useSetAtom(pushPanelAtom)

  // Store reference for reading fresh atom values in callbacks (avoids stale closures)
  const store = useStore()

  // Read sources from atom (populated by AppShell)
  const sources = useAtomValue(sourcesAtom)

  // Read skills from atom (populated by AppShell)
  const skills = useAtomValue(skillsAtom)

  // =========================================================================
  // DERIVED NAVIGATION STATE (from focused panel + right sidebar)
  // =========================================================================

  const focusedRoute = useAtomValue(focusedPanelRouteAtom)

  // Right sidebar is independent of panels (not per-panel state)
  const [rightSidebar, setRightSidebar] = useState<RightSidebarPanel | undefined>()
  const rightSidebarRef = useRef<RightSidebarPanel | undefined>(rightSidebar)
  useEffect(() => { rightSidebarRef.current = rightSidebar }, [rightSidebar])

  // NavigationState derived from the focused panel's route
  const navigationState: NavigationState = useMemo(() => {
    const base = focusedRoute
      ? parseRouteToNavigationState(focusedRoute) ?? DEFAULT_NAVIGATION_STATE
      : DEFAULT_NAVIGATION_STATE
    return rightSidebar ? { ...base, rightSidebar } : base
  }, [focusedRoute, rightSidebar])

  // =========================================================================
  // SNAPSHOT HISTORY
  // =========================================================================

  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)

  const historyStackRef = useRef<NavigationSnapshot[]>([])
  const historyIndexRef = useRef(-1)

  // Flag to suppress snapshot pushes during back/forward restore
  const isRestoringHistoryRef = useRef(false)

  // Queue navigation if not ready yet
  const pendingNavigationRef = useRef<ParsedRoute | null>(null)

  // Suppress auto-select for one cycle (used by skipAutoSelect to prevent the effect from re-selecting)
  const suppressAutoSelectRef = useRef(false)

  // Track whether initial route restoration has been attempted
  const initialRouteRestoredRef = useRef(false)

  // Update canGoBack/canGoForward from current history state
  const updateCanGoBackForward = useCallback(() => {
    setCanGoBack(historyIndexRef.current > 0)
    setCanGoForward(historyIndexRef.current < historyStackRef.current.length - 1)
  }, [])

  /**
   * Push a snapshot of the current state onto the history stack.
   * Reads atom values synchronously from the Jotai store (always fresh).
   * Reads right sidebar from ref (always fresh).
   * Deduplicates: won't push if identical to current snapshot.
   */
  const pushSnapshot = useCallback(() => {
    if (isRestoringHistoryRef.current) return

    const panels = store.get(panelStackAtom)
    const focusedIdx = store.get(focusedPanelIndexAtom)

    // Don't push if panel stack is empty (initial state before restore)
    if (panels.length === 0) return

    const snapshot: NavigationSnapshot = {
      panels: panels.map(p => ({ route: p.route, proportion: p.proportion })),
      focusedIndex: focusedIdx,
      rightSidebar: rightSidebarRef.current,
    }

    // Deduplicate
    const current = historyStackRef.current[historyIndexRef.current]
    if (current && snapshotsEqual(current, snapshot)) return

    // Truncate forward history and push
    const newIndex = historyIndexRef.current + 1
    historyStackRef.current = historyStackRef.current.slice(0, newIndex)
    historyStackRef.current.push(snapshot)
    historyIndexRef.current = newIndex

    updateCanGoBackForward()
  }, [store, updateCanGoBackForward])

  // Keep pushSnapshot ref fresh for use in atom subscriptions
  const pushSnapshotRef = useRef(pushSnapshot)
  useEffect(() => { pushSnapshotRef.current = pushSnapshot }, [pushSnapshot])

  /**
   * Restore a snapshot (for back/forward navigation).
   * Atomically restores panel stack, focus, and sidebar.
   */
  const restoreSnapshot = useCallback((snapshot: NavigationSnapshot) => {
    isRestoringHistoryRef.current = true

    // 1. Restore full panel stack (routes + proportions)
    store.set(restorePanelStackAtom, snapshot.panels)

    // 2. Restore focus (restorePanelStackAtom defaults to index 0, override if needed)
    const stack = store.get(panelStackAtom)
    const idx = Math.min(snapshot.focusedIndex, stack.length - 1)
    store.set(focusedPanelIdAtom, stack[idx]?.id ?? null)

    // 3. Restore right sidebar
    setRightSidebar(snapshot.rightSidebar)

    // 4. Sync URL immediately
    syncUrlRef.current?.()

    // Clear restoring flag after React processes the batched state updates.
    // Atom subscriptions already fired synchronously (suppressed by the flag).
    // The RAF ensures React effects from setRightSidebar are also suppressed.
    requestAnimationFrame(() => {
      isRestoringHistoryRef.current = false
    })
  }, [store])

  // =========================================================================
  // Subscribe to atom changes for snapshot pushes
  // =========================================================================

  // Panel stack changes (push, close, route change, resize)
  // Resize produces same snapshot (proportions excluded from equality) → deduped
  useEffect(() => {
    const unsub = store.sub(panelStackAtom, () => {
      pushSnapshotRef.current?.()
    })
    return unsub
  }, [store])

  // Focus changes (clicking a panel, keyboard focus cycling)
  useEffect(() => {
    const unsub = store.sub(focusedPanelIdAtom, () => {
      pushSnapshotRef.current?.()
    })
    return unsub
  }, [store])

  // Right sidebar changes (via effect since it's React state, not atom)
  const prevSidebarTypeRef = useRef(rightSidebar?.type)
  useEffect(() => {
    if (rightSidebar?.type === prevSidebarTypeRef.current) return
    prevSidebarTypeRef.current = rightSidebar?.type
    if (isRestoringHistoryRef.current) return
    if (!initialRouteRestoredRef.current) return
    pushSnapshot()
  }, [rightSidebar, pushSnapshot])

  // =========================================================================
  // URL SYNC
  // =========================================================================

  /**
   * Sync the current state to the browser URL (for reload restoration).
   * ?route= is the focused panel's route (backward compat / deep links).
   * ?panels= encodes ALL panels (route:proportion, comma-separated).
   * ?fi= is the focused panel index (omitted if 0).
   * ?sidebar= is the right sidebar state.
   */
  const syncUrl = useCallback(() => {
    const panels = store.get(panelStackAtom)
    const focusedIdx = store.get(focusedPanelIndexAtom)
    if (panels.length === 0) return

    const focusedPanel = panels[focusedIdx] ?? panels[0]
    const url = new URL(window.location.href)

    // ?route= is the focused panel's route
    url.searchParams.set('route', focusedPanel.route)

    // ?panels= encodes ALL panels in stack order
    if (panels.length > 1) {
      const encoded = panels.map(p => `${p.route}:${p.proportion.toFixed(4)}`).join(',')
      url.searchParams.set('panels', encoded)
    } else {
      url.searchParams.delete('panels')
    }

    // ?fi= is focused panel index — always written for multi-panel to disambiguate from old format
    if (panels.length > 1) {
      url.searchParams.set('fi', String(focusedIdx))
    } else {
      url.searchParams.delete('fi')
    }

    // ?sidebar=
    const sidebarParam = buildRightSidebarParam(rightSidebarRef.current)
    if (sidebarParam) {
      url.searchParams.set('sidebar', sidebarParam)
    } else {
      url.searchParams.delete('sidebar')
    }

    history.replaceState({ route: focusedPanel.route }, '', url.toString())
  }, [store])

  const syncUrlRef = useRef(syncUrl)
  useEffect(() => { syncUrlRef.current = syncUrl }, [syncUrl])

  // Sync URL when panel stack, focus, or sidebar changes
  const panelStack = useAtomValue(panelStackAtom)
  const focusedPanelId = useAtomValue(focusedPanelIdAtom)
  useEffect(() => {
    if (!initialRouteRestoredRef.current) return
    syncUrl()
  }, [panelStack, focusedPanelId, rightSidebar, syncUrl])

  // =========================================================================
  // EMPTY SESSION CLEANUP (reactive — covers navigate, close tab, etc.)
  // =========================================================================

  // Track which session IDs are visible across all panels. When a session ID
  // disappears (navigate away, close tab, Cmd+W), check if it was empty and
  // auto-delete it. This is the single codepath for all navigate-away cleanup.
  const prevVisibleSessionIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const currentIds = new Set<string>()
    for (const entry of panelStack) {
      const sessionId = parseSessionIdFromRoute(entry.route)
      if (sessionId) currentIds.add(sessionId)
    }

    // Only check after we've seen at least one set of IDs
    // (skip first render to avoid false positives during initialization)
    if (onAutoDeleteEmptySession && prevVisibleSessionIdsRef.current.size > 0) {
      for (const prevId of prevVisibleSessionIdsRef.current) {
        if (!currentIds.has(prevId)) {
          const meta = store.get(sessionMetaMapAtom).get(prevId)
          const isEmpty = meta && !meta.lastFinalMessageId && !meta.name && !meta.isProcessing
          const hasDraft = getDraft?.(prevId)?.trim()
          if (isEmpty && !hasDraft) {
            onAutoDeleteEmptySession(prevId)
          }
        }
      }
    }

    prevVisibleSessionIdsRef.current = currentIds
  }, [panelStack, onAutoDeleteEmptySession, store, getDraft])

  // =========================================================================
  // SESSION SELECTION SYNC
  // =========================================================================

  // Keep the global session selection in sync with the focused panel
  useEffect(() => {
    if (isSessionsNavigation(navigationState) && navigationState.details) {
      setSession({ selected: navigationState.details.sessionId })
      if (workspaceId) {
        storage.set(storage.KEYS.lastSelectedSessionId, navigationState.details.sessionId, workspaceId)
      }
    }
  }, [navigationState, setSession, workspaceId])

  // =========================================================================
  // HELPERS
  // =========================================================================

  // Helper: Filter sessions by SessionFilter
  // Always excludes hidden sessions - they should never appear in navigation
  const filterSessionsByFilter = useCallback(
    (filter: SessionFilter): SessionMeta[] => {
      // First filter out hidden sessions - they should never appear in any view
      const visibleSessions = sessionMetas.filter(
        s => !s.hidden && (!workspaceId || s.workspaceId === workspaceId)
      )

      return visibleSessions.filter((session) => {
        switch (filter.kind) {
          case 'allSessions':
            return session.isArchived !== true
          case 'flagged':
            return session.isFlagged === true && session.isArchived !== true
          case 'archived':
            return session.isArchived === true
          case 'state':
            return session.sessionStatus === filter.stateId && session.isArchived !== true
          case 'label': {
            if (session.isArchived === true) return false
            if (!session.labels?.length) return false
            if (filter.labelId === '__all__') return true
            return session.labels.some(l => l === filter.labelId || l.startsWith(`${filter.labelId}::`))
          }
          case 'view':
            if (session.isArchived === true) return false
            return true
          default:
            return false
        }
      })
    },
    [sessionMetas, workspaceId]
  )

  const getFirstSessionId = useCallback(
    (filter: SessionFilter): string | null => {
      const filtered = filterSessionsByFilter(filter)
      return filtered[0]?.id ?? null
    },
    [filterSessionsByFilter]
  )

  const getLastSelectedSessionId = useCallback(
    (filter: SessionFilter): string | null => {
      if (!workspaceId) return null
      const storedId = storage.get<string | null>(
        storage.KEYS.lastSelectedSessionId,
        null,
        workspaceId
      )
      if (!storedId) return null
      const filtered = filterSessionsByFilter(filter)
      return filtered.some(session => session.id === storedId) ? storedId : null
    },
    [workspaceId, filterSessionsByFilter]
  )

  const getFirstSourceSlug = useCallback(
    (filter?: SourceFilter | null): string | null => {
      if (!filter) {
        return sources[0]?.config.slug ?? null
      }
      const filtered = sources.filter(s => s.config.type === filter.sourceType)
      return filtered[0]?.config.slug ?? null
    },
    [sources]
  )

  const getFirstSkillSlug = useCallback(
    (): string | null => {
      return skills[0]?.slug ?? null
    },
    [skills]
  )

  // =========================================================================
  // AUTO-SELECTION (pure computation, no side effects)
  // =========================================================================

  /**
   * Resolve auto-selection for a NavigationState.
   * When navigating to a filter without explicit details, auto-select the
   * first available item. Returns the final state (no side effects).
   */
  const resolveAutoSelection = useCallback(
    (newState: NavigationState, options?: { skipAutoSelect?: boolean }): NavigationState => {
      let nextState = newState

      // Validate session exists in current workspace
      if (isSessionsNavigation(nextState) && nextState.details) {
        const freshMetaMap = store.get(sessionMetaMapAtom)
        const meta = freshMetaMap.get(nextState.details.sessionId)
        if (!meta || (workspaceId && meta.workspaceId !== workspaceId)) {
          nextState = { ...nextState, details: null }
        }
      }

      // Sessions: auto-select last/first session
      if (isSessionsNavigation(nextState) && !nextState.details && !options?.skipAutoSelect) {
        const lastSelectedSessionId = getLastSelectedSessionId(nextState.filter)
        const fallbackSessionId = lastSelectedSessionId ?? getFirstSessionId(nextState.filter)
        if (fallbackSessionId) {
          return { ...nextState, details: { type: 'session', sessionId: fallbackSessionId } }
        }
        return nextState
      }

      // Sources: auto-select first source
      if (isSourcesNavigation(nextState) && !nextState.details && !options?.skipAutoSelect) {
        const firstSourceSlug = getFirstSourceSlug(nextState.filter)
        if (firstSourceSlug) {
          return { ...nextState, details: { type: 'source', sourceSlug: firstSourceSlug } }
        }
        return nextState
      }

      // Skills: auto-select first skill
      if (isSkillsNavigation(nextState) && !nextState.details && !options?.skipAutoSelect) {
        const firstSkillSlug = getFirstSkillSlug()
        if (firstSkillSlug) {
          return { ...nextState, details: { type: 'skill', skillSlug: firstSkillSlug } }
        }
        return nextState
      }

      return nextState
    },
    [store, workspaceId, getLastSelectedSessionId, getFirstSessionId, getFirstSourceSlug, getFirstSkillSlug]
  )

  // =========================================================================
  // ACTION NAVIGATION
  // =========================================================================

  const handleActionNavigation = useCallback(
    async (parsed: ParsedRoute, options?: { newPanel?: boolean }) => {
      if (!workspaceId) return

      switch (parsed.name) {
        case 'new-session': {
          const createOptions: import('../../shared/types').CreateSessionOptions = {}
          if (parsed.params.mode && ['safe', 'ask', 'allow-all'].includes(parsed.params.mode)) {
            createOptions.permissionMode = parsed.params.mode as 'safe' | 'ask' | 'allow-all'
          }
          if (parsed.params.workdir) {
            createOptions.workingDirectory = parsed.params.workdir as 'user_default' | 'none' | string
          }
          if (parsed.params.model) {
            createOptions.model = parsed.params.model
          }
          if (parsed.params.systemPrompt) {
            createOptions.systemPromptPreset = parsed.params.systemPrompt as 'default' | 'mini' | string
          }
          const session = await onCreateSession(workspaceId, createOptions)

          if (parsed.params.name) {
            await window.electronAPI.sessionCommand(session.id, { type: 'rename', name: parsed.params.name })
          }

          if (parsed.params.status) {
            updateSessionMeta(session.id, { sessionStatus: parsed.params.status })
          }
          if (parsed.params.label) {
            updateSessionMeta(session.id, { labels: [parsed.params.label] })
          }

          if (parsed.params.status) {
            await window.electronAPI.sessionCommand(session.id, { type: 'setSessionStatus', state: parsed.params.status })
          }
          if (parsed.params.label) {
            await window.electronAPI.sessionCommand(session.id, { type: 'setLabels', labels: [parsed.params.label] })
          }

          // Determine navigation filter
          const filter: import('../../shared/types').SessionFilter =
            parsed.params.status ? { kind: 'state', stateId: parsed.params.status } :
            parsed.params.label ? { kind: 'label', labelId: parsed.params.label } :
            { kind: 'allSessions' }

          if (options?.newPanel) {
            // Open the new session in a new panel (pushPanel auto-focuses it)
            pushPanel({ route: routes.view.allSessions(session.id) as ViewRoute })
          } else {
            // Navigate the focused panel to the new session
            const newState: NavigationState = {
              navigator: 'sessions',
              filter,
              details: { type: 'session', sessionId: session.id },
            }
            const route = buildRouteFromNavigationState(newState) as ViewRoute
            store.set(updateFocusedPanelRouteAtom, route)
            // Session selection sync handled by effect
          }

          // Parse badges from params
          let badges: ContentBadge[] | undefined
          if (parsed.params.badges) {
            try {
              badges = JSON.parse(parsed.params.badges) as ContentBadge[]
            } catch (e) {
              console.warn('[Navigation] Failed to parse badges param:', e)
            }
          }

          // Handle input: either auto-send or pre-fill
          if (parsed.params.input) {
            const shouldSend = parsed.params.send === 'true'
            if (shouldSend) {
              setTimeout(() => {
                window.electronAPI.sendMessage(
                  session.id,
                  parsed.params.input!,
                  undefined,
                  undefined,
                  badges ? { badges } : undefined
                )
              }, 100)
            } else if (onInputChange) {
              setTimeout(() => {
                onInputChange(session.id, parsed.params.input!)
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
    [workspaceId, onCreateSession, onInputChange, pushPanel, store, updateSessionMeta]
  )

  // =========================================================================
  // NAVIGATE
  // =========================================================================

  const navigate = useCallback(
    async (route: Route, options?: NavigateOptions) => {
      // Reset auto-select suppression on any normal navigation
      if (!options?.skipAutoSelect) {
        suppressAutoSelectRef.current = false
      }

      const parsed = parseRoute(route)
      if (!parsed) {
        console.warn('[Navigation] Invalid route:', route)
        return
      }

      if (!isReady) {
        pendingNavigationRef.current = parsed
        return
      }

      // Handle actions (side effects)
      if (parsed.type === 'action') {
        await handleActionNavigation(parsed, options)
        return
      }

      // For view routes with newPanel: push a panel (pushPanelAtom auto-focuses)
      if (options?.newPanel) {
        pushPanel({ route: route as ViewRoute })
        return
      }

      // Parse route to NavigationState
      let newNavState = parseRouteToNavigationState(route)

      // Settings subpage persistence
      if (newNavState && isSettingsNavigation(newNavState)) {
        const isBareSettingsRoute = route === 'settings'
        if (isBareSettingsRoute) {
          const savedSubpage = storage.get<string>(storage.KEYS.lastSettingsSubpage, 'app')
          if (isValidSettingsSubpage(savedSubpage) && savedSubpage !== 'app') {
            newNavState = { ...newNavState, subpage: savedSubpage as SettingsSubpage }
          }
        } else {
          storage.set(storage.KEYS.lastSettingsSubpage, newNavState.subpage)
        }
      }

      // Suppress auto-select effect
      if (options?.skipAutoSelect) {
        suppressAutoSelectRef.current = true
      }

      if (newNavState) {
        // Resolve auto-selection (pure — no side effects)
        const resolvedState = resolveAutoSelection(newNavState, options)
        const finalRoute = buildRouteFromNavigationState(resolvedState) as ViewRoute

        // Persist last selected session for auto-select on next visit
        if (isSessionsNavigation(resolvedState) && resolvedState.details && workspaceId) {
          storage.set(storage.KEYS.lastSelectedSessionId, resolvedState.details.sessionId, workspaceId)
        }

        // Clear the restoring flag — user-initiated navigation overrides any pending restore
        isRestoringHistoryRef.current = false

        // Update the focused panel's route (atom update is synchronous)
        store.set(updateFocusedPanelRouteAtom, finalRoute)

        // Atom subscription already called pushSnapshot() synchronously.
        // URL sync effect will fire on the next render.
      }
    },
    [isReady, handleActionNavigation, resolveAutoSelection, store, pushPanel, workspaceId]
  )

  // =========================================================================
  // ROUTE VALIDATION (for history navigation)
  // =========================================================================

  const isRouteValid = useCallback((route: string): boolean => {
    const navState = parseRouteToNavigationState(route)
    if (!navState) return true

    if (isSessionsNavigation(navState) && navState.details) {
      const meta = sessionMetaMap.get(navState.details.sessionId)
      return meta != null && !meta.hidden
    }

    if (isSourcesNavigation(navState) && navState.details) {
      return sources.some(s => s.config.slug === navState.details!.sourceSlug)
    }

    if (isSkillsNavigation(navState) && navState.details) {
      if (navState.details.type === 'skill') {
        return skills.some(s => s.slug === navState.details!.skillSlug)
      }
      return true
    }

    return true
  }, [sessionMetaMap, sources, skills])

  /** Check if all panel routes in a snapshot are still valid */
  const isSnapshotValid = useCallback((snapshot: NavigationSnapshot): boolean => {
    return snapshot.panels.every(p => isRouteValid(p.route))
  }, [isRouteValid])

  // =========================================================================
  // BACK / FORWARD
  // =========================================================================

  const goBack = useCallback(() => {
    const currentIndex = historyIndexRef.current
    if (currentIndex <= 0) return

    // Find first valid snapshot going backwards, removing invalid ones
    const invalidIndices: number[] = []
    let targetIndex = -1

    for (let i = currentIndex - 1; i >= 0; i--) {
      if (isSnapshotValid(historyStackRef.current[i])) {
        targetIndex = i
        break
      }
      invalidIndices.push(i)
    }

    // Remove invalid entries (reverse order to preserve indices)
    if (invalidIndices.length > 0) {
      for (const idx of invalidIndices.sort((a, b) => b - a)) {
        historyStackRef.current.splice(idx, 1)
      }
    }

    // Adjust indices after removal
    if (targetIndex >= 0) {
      const removedBefore = invalidIndices.filter(i => i < targetIndex).length
      targetIndex -= removedBefore
    }
    const removedBeforeCurrent = invalidIndices.filter(i => i < currentIndex).length
    historyIndexRef.current = currentIndex - removedBeforeCurrent

    if (targetIndex >= 0) {
      historyIndexRef.current = targetIndex
      restoreSnapshot(historyStackRef.current[targetIndex])
    }

    updateCanGoBackForward()
  }, [isSnapshotValid, restoreSnapshot, updateCanGoBackForward])

  const goForward = useCallback(() => {
    const currentIndex = historyIndexRef.current
    const stackLength = historyStackRef.current.length
    if (currentIndex >= stackLength - 1) return

    // Find first valid snapshot going forwards, removing invalid ones
    const invalidIndices: number[] = []
    let targetIndex = -1

    for (let i = currentIndex + 1; i < stackLength; i++) {
      if (isSnapshotValid(historyStackRef.current[i])) {
        targetIndex = i
        break
      }
      invalidIndices.push(i)
    }

    // Remove invalid entries (reverse order to preserve indices)
    if (invalidIndices.length > 0) {
      for (const idx of invalidIndices.sort((a, b) => b - a)) {
        historyStackRef.current.splice(idx, 1)
      }
    }

    // Adjust target index after removal
    if (targetIndex >= 0) {
      targetIndex -= invalidIndices.length
    }

    if (targetIndex >= 0 && targetIndex < historyStackRef.current.length) {
      historyIndexRef.current = targetIndex
      restoreSnapshot(historyStackRef.current[targetIndex])
    }

    updateCanGoBackForward()
  }, [isSnapshotValid, restoreSnapshot, updateCanGoBackForward])

  // =========================================================================
  // WORKSPACE SWITCH
  // =========================================================================

  const previousWorkspaceIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!workspaceId) return

    if (previousWorkspaceIdRef.current !== null && previousWorkspaceIdRef.current !== workspaceId) {
      // Clear history — old snapshots belong to previous workspace
      historyStackRef.current = []
      historyIndexRef.current = -1
      setCanGoBack(false)
      setCanGoForward(false)

      // Close right sidebar
      setRightSidebar(undefined)

      // Close all panels except the first
      store.set(closeAllOtherPanelsAtom)

      // Reset initial route restoration for new workspace
      initialRouteRestoredRef.current = false
    }

    previousWorkspaceIdRef.current = workspaceId
  }, [workspaceId, store])

  // =========================================================================
  // INITIAL ROUTE RESTORATION (CMD+R reload)
  // =========================================================================

  useEffect(() => {
    if (!isReady || !workspaceId || initialRouteRestoredRef.current) return
    initialRouteRestoredRef.current = true

    const params = new URLSearchParams(window.location.search)
    const initialRoute = params.get('route')
    const sidebarParam = params.get('sidebar') || undefined
    const panelsParam = params.get('panels')
    const focusedIndexParam = params.get('fi')

    // Restore right sidebar
    if (sidebarParam) {
      const parsed = parseRouteToNavigationState('allSessions', sidebarParam)
      if (parsed?.rightSidebar) {
        setRightSidebar(parsed.rightSidebar)
      }
    }

    // Restore panels
    if (panelsParam) {
      const hasFocusedIndex = focusedIndexParam != null
      const entries = panelsParam.split(',').filter(Boolean).map(entry => {
        const colonIdx = entry.lastIndexOf(':')
        if (colonIdx > 0) {
          const proportion = parseFloat(entry.slice(colonIdx + 1))
          if (!isNaN(proportion) && proportion > 0 && proportion < 1) {
            return { route: entry.slice(0, colonIdx) as ViewRoute, proportion }
          }
        }
        return { route: entry as ViewRoute, proportion: 0 }
      })

      if (hasFocusedIndex) {
        // New format: ?panels= contains ALL panels, ?fi= is the focused index
        const hasProportions = entries.some(e => e.proportion > 0)
        if (!hasProportions) {
          const equal = 1 / entries.length
          entries.forEach(e => { e.proportion = equal })
        } else {
          // Normalize proportions to sum to 1.0 (guards against malformed URLs)
          const total = entries.reduce((s, e) => s + e.proportion, 0)
          if (total > 0 && Math.abs(total - 1) > 0.001) {
            entries.forEach(e => { e.proportion = e.proportion / total })
          }
        }
        store.set(restorePanelStackAtom, entries)

        // Restore focus
        const fi = parseInt(focusedIndexParam!, 10) || 0
        const stack = store.get(panelStackAtom)
        const idx = Math.min(fi, stack.length - 1)
        store.set(focusedPanelIdAtom, stack[idx]?.id ?? null)
      } else {
        // Old format: ?route= is panel[0], ?panels= are additional panels
        const firstPanelRoute = initialRoute ?? 'allSessions'
        const hasProportions = entries.some(e => e.proportion > 0)
        const additionalPanelsProp = entries.reduce((s, e) => s + e.proportion, 0)

        let allEntries: { route: ViewRoute; proportion: number }[]
        if (hasProportions && additionalPanelsProp < 1) {
          allEntries = [
            { route: firstPanelRoute as ViewRoute, proportion: 1 - additionalPanelsProp },
            ...entries,
          ]
        } else {
          const equal = 1 / (1 + entries.length)
          allEntries = [
            { route: firstPanelRoute as ViewRoute, proportion: equal },
            ...entries.map(e => ({ ...e, proportion: equal })),
          ]
        }
        store.set(restorePanelStackAtom, allEntries)
      }
    } else if (initialRoute) {
      // Single panel from ?route=
      const navState = parseRouteToNavigationState(initialRoute)
      if (navState) {
        const resolved = resolveAutoSelection(navState)
        const finalRoute = buildRouteFromNavigationState(resolved) as ViewRoute
        store.set(restorePanelStackAtom, [{ route: finalRoute, proportion: 1 }])
      } else {
        navigate(initialRoute as Route)
      }
    }

    // Initialize history stack with current state
    requestAnimationFrame(() => {
      pushSnapshotRef.current?.()
    })
  }, [isReady, workspaceId, navigate, resolveAutoSelection, store, pushSnapshot])

  // =========================================================================
  // PENDING NAVIGATION
  // =========================================================================

  useEffect(() => {
    if (isReady && pendingNavigationRef.current) {
      const pending = pendingNavigationRef.current
      pendingNavigationRef.current = null

      if (pending.type === 'action') {
        handleActionNavigation(pending)
        return
      }

      const routeStr = `${pending.name}${pending.id ? `/${pending.id}` : ''}`
      const navState = parseRouteToNavigationState(routeStr)
      if (navState) {
        const resolved = resolveAutoSelection(navState)
        const finalRoute = buildRouteFromNavigationState(resolved) as ViewRoute
        store.set(updateFocusedPanelRouteAtom, finalRoute)
      }
    }
  }, [isReady, handleActionNavigation, resolveAutoSelection, store])

  // =========================================================================
  // DEEP LINK LISTENER
  // =========================================================================

  useEffect(() => {
    if (!workspaceId) return

    const cleanup = window.electronAPI.onDeepLinkNavigate((nav: DeepLinkNavigation) => {
      let route: string | null = null

      if (nav.view) {
        route = nav.view
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
      }

      if (route) {
        const navState = parseRouteToNavigationState(route)
        if (!navState && !route.startsWith('action/')) {
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

  // =========================================================================
  // INTERNAL NAVIGATION EVENT LISTENER
  // =========================================================================

  useEffect(() => {
    const handleNavigateEvent = (event: Event) => {
      const customEvent = event as CustomEvent<{ route: Route; newPanel?: boolean }>
      if (customEvent.detail?.route) {
        const { route: r, newPanel } = customEvent.detail
        navigate(r, newPanel ? { newPanel } : undefined)
      }
    }

    window.addEventListener(NAVIGATE_EVENT, handleNavigateEvent)
    return () => {
      window.removeEventListener(NAVIGATE_EVENT, handleNavigateEvent)
    }
  }, [navigate])

  // =========================================================================
  // SIDEBAR HELPERS
  // =========================================================================

  const updateRightSidebar = useCallback((panel: RightSidebarPanel | undefined) => {
    setRightSidebar(panel)
    // Snapshot push handled by the rightSidebar change effect
  }, [])

  const toggleRightSidebar = useCallback((panel?: RightSidebarPanel) => {
    const currentSidebar = rightSidebarRef.current
    const newPanel = panel || (currentSidebar && currentSidebar.type !== 'none'
      ? { type: 'none' as const }
      : { type: 'sessionMetadata' as const })
    updateRightSidebar(newPanel)
  }, [updateRightSidebar])

  // =========================================================================
  // PRESERVE-FILTER NAVIGATION HELPERS
  // =========================================================================

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
    navigate(routes.view.sources(sourceSlug ? { sourceSlug } : undefined))
  }, [navigationState, navigate])

  const navigateToSession = useCallback((sessionId: string) => {
    if (!isSessionsNavigation(navigationState)) {
      navigate(routes.view.allSessions(sessionId))
      return
    }

    const filter = navigationState.filter
    switch (filter.kind) {
      case 'allSessions':
        navigate(routes.view.allSessions(sessionId))
        break
      case 'flagged':
        navigate(routes.view.flagged(sessionId))
        break
      case 'archived':
        navigate(routes.view.archived(sessionId))
        break
      case 'state':
        navigate(routes.view.state(filter.stateId, sessionId))
        break
      case 'label':
        navigate(routes.view.label(filter.labelId, sessionId))
        break
      case 'view':
        navigate(routes.view.view(filter.viewId, sessionId))
        break
      default:
        navigate(routes.view.allSessions(sessionId))
    }
  }, [navigationState, navigate])

  // =========================================================================
  // AUTO-SELECT ON SESSION LOAD
  // =========================================================================

  useEffect(() => {
    if (suppressAutoSelectRef.current) return
    if (!isReady || !workspaceId) return
    // Don't auto-select when panel stack is empty (user closed all panels)
    if (store.get(panelStackAtom).length === 0) return
    if (!isSessionsNavigation(navigationState) || navigationState.details) return

    const lastSelectedSessionId = getLastSelectedSessionId(navigationState.filter)
    const fallbackSessionId = lastSelectedSessionId ?? getFirstSessionId(navigationState.filter)
    if (!fallbackSessionId) return

    navigateToSession(fallbackSessionId)
  }, [
    isReady,
    workspaceId,
    navigationState,
    getLastSelectedSessionId,
    getFirstSessionId,
    navigateToSession,
  ])

  // =========================================================================
  // CONTEXT VALUE
  // =========================================================================

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
        navigateToSession,
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
