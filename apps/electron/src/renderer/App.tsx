import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useTheme } from '@/hooks/useTheme'
import type { ThemeOverrides } from '@config/theme'
import { useSetAtom, useStore, useAtomValue } from 'jotai'
import type { Session, Workspace, SessionEvent, Message, FileAttachment, StoredAttachment, PermissionRequest, CredentialRequest, CredentialResponse, SetupNeeds, TodoState, NewChatActionParams, ContentBadge } from '../shared/types'
import type { SessionOptions, SessionOptionUpdates } from './hooks/useSessionOptions'
import { defaultSessionOptions, mergeSessionOptions } from './hooks/useSessionOptions'
import { generateMessageId } from '../shared/types'
import { useEventProcessor } from './event-processor'
import type { AgentEvent, Effect } from './event-processor'
import { AppShell } from '@/components/app-shell/AppShell'
import type { AppShellContextType } from '@/context/AppShellContext'
import { OnboardingWizard, ReauthScreen } from '@/components/onboarding'
import { ResetConfirmationDialog } from '@/components/ResetConfirmationDialog'
import { SplashScreen } from '@/components/SplashScreen'
import { TooltipProvider } from '@craft-agent/ui'
import { FocusProvider } from '@/context/FocusContext'
import { ModalProvider } from '@/context/ModalContext'
import { useGlobalShortcuts } from '@/hooks/keyboard'
import { useWindowCloseHandler } from '@/hooks/useWindowCloseHandler'
import { useOnboarding } from '@/hooks/useOnboarding'
import { useNotifications } from '@/hooks/useNotifications'
import { useSession } from '@/hooks/useSession'
import { useUpdateChecker } from '@/hooks/useUpdateChecker'
import { NavigationProvider } from '@/contexts/NavigationContext'
import { navigate, routes } from './lib/navigate'
import { initRendererPerf } from './lib/perf'
import { DEFAULT_MODEL } from '@config/models'
import {
  initializeSessionsAtom,
  addSessionAtom,
  removeSessionAtom,
  updateSessionAtom,
  sessionAtomFamily,
  sessionMetaMapAtom,
  backgroundTasksAtomFamily,
  extractSessionMeta,
  type SessionMeta,
} from '@/atoms/sessions'
import { sourcesAtom } from '@/atoms/sources'
import { skillsAtom } from '@/atoms/skills'
import { extractBadges } from '@/lib/mentions'
import { getDefaultStore } from 'jotai'
import { ShikiThemeProvider, PlatformProvider } from '@craft-agent/ui'

type AppState = 'loading' | 'onboarding' | 'reauth' | 'ready'

/** Type for the Jotai store returned by useStore() */
type JotaiStore = ReturnType<typeof getDefaultStore>

/**
 * Helper to handle background task events from the agent.
 * Updates the backgroundTasksAtomFamily based on event type.
 * Extracted to avoid code duplication between streaming and non-streaming paths.
 */
function handleBackgroundTaskEvent(
  store: JotaiStore,
  sessionId: string,
  event: { type: string },
  agentEvent: unknown
): void {
  // Type guard for accessing properties
  const evt = agentEvent as Record<string, unknown>
  const backgroundTasksAtom = backgroundTasksAtomFamily(sessionId)

  if (event.type === 'task_backgrounded' && 'taskId' in evt && 'toolUseId' in evt) {
    const currentTasks = store.get(backgroundTasksAtom)
    const exists = currentTasks.some(t => t.toolUseId === evt.toolUseId)
    if (!exists) {
      store.set(backgroundTasksAtom, [
        ...currentTasks,
        {
          id: evt.taskId as string,
          type: 'agent' as const,
          toolUseId: evt.toolUseId as string,
          startTime: Date.now(),
          elapsedSeconds: 0,
          intent: evt.intent as string | undefined,
        },
      ])
    }
  } else if (event.type === 'shell_backgrounded' && 'shellId' in evt && 'toolUseId' in evt) {
    const currentTasks = store.get(backgroundTasksAtom)
    const exists = currentTasks.some(t => t.toolUseId === evt.toolUseId)
    if (!exists) {
      store.set(backgroundTasksAtom, [
        ...currentTasks,
        {
          id: evt.shellId as string,
          type: 'shell' as const,
          toolUseId: evt.toolUseId as string,
          startTime: Date.now(),
          elapsedSeconds: 0,
          intent: evt.intent as string | undefined,
        },
      ])
    }
  } else if (event.type === 'task_progress' && 'toolUseId' in evt && 'elapsedSeconds' in evt) {
    const currentTasks = store.get(backgroundTasksAtom)
    store.set(backgroundTasksAtom, currentTasks.map(t =>
      t.toolUseId === evt.toolUseId
        ? { ...t, elapsedSeconds: evt.elapsedSeconds as number }
        : t
    ))
  } else if (event.type === 'shell_killed' && 'shellId' in evt) {
    // Remove shell task when KillShell succeeds
    const currentTasks = store.get(backgroundTasksAtom)
    store.set(backgroundTasksAtom, currentTasks.filter(t => t.id !== evt.shellId))
  } else if (event.type === 'tool_result' && 'toolUseId' in evt) {
    // Remove task when it completes - but NOT if this is the initial backgrounding result
    // Background tasks return immediately with agentId/shell_id/backgroundTaskId,
    // we should only remove when the task actually completes
    const result = typeof evt.result === 'string' ? evt.result : JSON.stringify(evt.result)
    const isBackgroundingResult = result && (
      /agentId:\s*[a-zA-Z0-9_-]+/.test(result) ||
      /shell_id:\s*[a-zA-Z0-9_-]+/.test(result) ||
      /"backgroundTaskId":\s*"[a-zA-Z0-9_-]+"/.test(result)
    )
    if (!isBackgroundingResult) {
      const currentTasks = store.get(backgroundTasksAtom)
      store.set(backgroundTasksAtom, currentTasks.filter(t => t.toolUseId !== evt.toolUseId))
    }
  }
  // Note: We do NOT clear background tasks on complete/error/interrupted
  // Background tasks should persist and keep running after the turn ends
  // They are only removed when:
  // 1. Their tool_result comes back (task finished)
  // 2. KillShell succeeds (shell_killed event)
}

export default function App() {
  // Initialize renderer perf tracking early (debug mode = running from source)
  // Uses useEffect with empty deps to run once on mount before any session switches
  useEffect(() => {
    window.electronAPI.isDebugMode().then((isDebug) => {
      initRendererPerf(isDebug)
    })
  }, [])

  // App state: loading -> check auth -> onboarding or ready
  const [appState, setAppState] = useState<AppState>('loading')
  const [setupNeeds, setSetupNeeds] = useState<SetupNeeds | null>(null)

  // Per-session Jotai atom setters for isolated updates
  // NOTE: No sessionsAtom - we don't store a Session[] array anywhere to prevent memory leaks
  // Instead we use:
  // - sessionMetaMapAtom for lightweight listing
  // - sessionAtomFamily(id) for individual session data
  const initializeSessions = useSetAtom(initializeSessionsAtom)
  const addSession = useSetAtom(addSessionAtom)
  const removeSession = useSetAtom(removeSessionAtom)
  const updateSessionDirect = useSetAtom(updateSessionAtom)
  const store = useStore()

  // Helper to update a session by ID with partial fields
  // Uses per-session atom directly instead of updating an array
  const updateSessionById = useCallback((
    sessionId: string,
    updates: Partial<Session> | ((session: Session) => Partial<Session>)
  ) => {
    updateSessionDirect(sessionId, (prev) => {
      if (!prev) return prev
      const partialUpdates = typeof updates === 'function' ? updates(prev) : updates
      return { ...prev, ...partialUpdates }
    })
  }, [updateSessionDirect])

  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  // Window's workspace ID - fixed for this window (multi-window architecture)
  const [windowWorkspaceId, setWindowWorkspaceId] = useState<string | null>(null)
  const [currentModel, setCurrentModel] = useState(DEFAULT_MODEL)
  // Custom model override from API connection settings (OpenRouter, Ollama, etc.)
  // When set, the Anthropic model selector is hidden and this model is shown instead.
  const [customModel, setCustomModel] = useState<string | null>(null)
  const [menuNewChatTrigger, setMenuNewChatTrigger] = useState(0)
  // Permission requests per session (queue to handle multiple concurrent requests)
  const [pendingPermissions, setPendingPermissions] = useState<Map<string, PermissionRequest[]>>(new Map())
  // Credential requests per session (queue to handle multiple concurrent requests)
  const [pendingCredentials, setPendingCredentials] = useState<Map<string, CredentialRequest[]>>(new Map())
  // Draft input text per session (preserved across mode switches and conversation changes)
  // Using ref instead of state to avoid re-renders during typing - drafts are only
  // needed for initial value restoration and disk persistence, not reactive updates
  const sessionDraftsRef = useRef<Map<string, string>>(new Map())
  // Unified session options - replaces ultrathinkSessions and sessionModes
  // All session-scoped options in one place (ultrathink, permissionMode)
  const [sessionOptions, setSessionOptions] = useState<Map<string, SessionOptions>>(new Map())

  // Theme state (app-level only)
  const [appTheme, setAppTheme] = useState<ThemeOverrides | null>(null)
  // Reset confirmation dialog
  const [showResetDialog, setShowResetDialog] = useState(false)

  // Auto-update state
  const updateChecker = useUpdateChecker()

  // Splash screen state - tracks when app is fully ready (all data loaded)
  const [sessionsLoaded, setSessionsLoaded] = useState(false)
  const [splashExiting, setSplashExiting] = useState(false)
  const [splashHidden, setSplashHidden] = useState(false)

  // Notifications enabled state (from app settings)
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)

  // Sources and skills for badge extraction
  const sources = useAtomValue(sourcesAtom)
  const skills = useAtomValue(skillsAtom)

  // Compute if app is fully ready (all data loaded)
  const isFullyReady = appState === 'ready' && sessionsLoaded

  // Trigger splash exit animation when fully ready
  useEffect(() => {
    if (isFullyReady && !splashExiting) {
      setSplashExiting(true)
    }
  }, [isFullyReady, splashExiting])

  // Handler for when splash exit animation completes
  const handleSplashExitComplete = useCallback(() => {
    setSplashHidden(true)
  }, [])

  // Apply theme via hook (injects CSS variables)
  // shikiTheme is passed to ShikiThemeProvider to ensure correct syntax highlighting
  // theme for dark-only themes in light system mode
  const { shikiTheme } = useTheme({ appTheme })

  // Ref for sessionOptions to access current value in event handlers without re-registering
  const sessionOptionsRef = useRef(sessionOptions)
  // Keep ref in sync with state
  useEffect(() => {
    sessionOptionsRef.current = sessionOptions
  }, [sessionOptions])

  // Event processor hook - handles all agent events through pure functions
  const { processAgentEvent } = useEventProcessor()

  const DRAFT_SAVE_DEBOUNCE_MS = 500

  // Re-fetch custom model from API setup config (called after API connection changes).
  // Defined early so it can be passed to useOnboarding's onConfigSaved.
  const refreshCustomModel = useCallback(async () => {
    const billing = await window.electronAPI.getApiSetup()
    setCustomModel(billing.customModel || null)
  }, [])

  // Handle onboarding completion
  const handleOnboardingComplete = useCallback(async () => {
    // Reload workspaces after onboarding
    const ws = await window.electronAPI.getWorkspaces()
    if (ws.length > 0) {
      // Switch to workspace in-place (no window close/reopen)
      await window.electronAPI.switchWorkspace(ws[0].id)
      setWindowWorkspaceId(ws[0].id)
      setWorkspaces(ws)
      setAppState('ready')
      return
    }
    // Fallback: no workspaces (shouldn't happen after onboarding)
    setWorkspaces(ws)
    setAppState('ready')
  }, [])

  // Onboarding hook — onConfigSaved fires immediately when billing is saved,
  // ensuring customModel context updates before the wizard closes.
  const onboarding = useOnboarding({
    onComplete: handleOnboardingComplete,
    onConfigSaved: refreshCustomModel,
    initialSetupNeeds: setupNeeds || undefined,
  })

  // Reauth login handler - placeholder (reauth is not currently used)
  const handleReauthLogin = useCallback(async () => {
    // Re-check setup needs
    const needs = await window.electronAPI.getSetupNeeds()
    if (needs.isFullyConfigured) {
      setAppState('ready')
    } else {
      setSetupNeeds(needs)
      setAppState('onboarding')
    }
  }, [])

  // Reauth reset handler - open reset confirmation dialog
  const handleReauthReset = useCallback(() => {
    setShowResetDialog(true)
  }, [])

  // Get initial sessionId and focused mode from URL params (for "Open in New Window" feature)
  const { initialSessionId, isFocusedMode } = useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    return {
      initialSessionId: params.get('sessionId'),
      isFocusedMode: params.get('focused') === 'true',
    }
  }, [])

  // Check auth state and get window's workspace ID on mount
  useEffect(() => {
    const initialize = async () => {
      try {
        // Get this window's workspace ID (passed via URL query param from main process)
        const wsId = await window.electronAPI.getWindowWorkspace()
        setWindowWorkspaceId(wsId)

        const needs = await window.electronAPI.getSetupNeeds()
        setSetupNeeds(needs)

        if (needs.isFullyConfigured) {
          setAppState('ready')
        } else {
          // New user or needs setup - show onboarding
          setAppState('onboarding')
        }
      } catch (error) {
        console.error('Failed to check auth state:', error)
        // If check fails, show onboarding to be safe
        setAppState('onboarding')
      }
    }

    initialize()
  }, [])

  // Session selection state
  const [, setSession] = useSession()

  // Notification system - shows native OS notifications and badge count
  const handleNavigateToSession = useCallback((sessionId: string) => {
    // Navigate to the session via central routing (uses allChats filter)
    navigate(routes.view.allChats(sessionId))
  }, [])

  const { isWindowFocused, showSessionNotification } = useNotifications({
    workspaceId: windowWorkspaceId,
    // NOTE: sessions removed - hook now uses sessionMetaMapAtom internally
    // to prevent closures from retaining full message arrays
    onNavigateToSession: handleNavigateToSession,
    enabled: notificationsEnabled,
  })

  // Load workspaces, sessions, model, notifications setting, and drafts when app is ready
  useEffect(() => {
    if (appState !== 'ready') return

    window.electronAPI.getWorkspaces().then(setWorkspaces)
    window.electronAPI.getNotificationsEnabled().then(setNotificationsEnabled)
    window.electronAPI.getSessions().then((loadedSessions) => {
      // Initialize per-session atoms and metadata map
      // NOTE: No sessionsAtom used - sessions are only in per-session atoms
      initializeSessions(loadedSessions)
      // Initialize unified sessionOptions from session data
      const optionsMap = new Map<string, SessionOptions>()
      for (const s of loadedSessions) {
        // Only store non-default options to keep the map lean
        const hasNonDefaultMode = s.permissionMode && s.permissionMode !== 'ask'
        const hasNonDefaultThinking = s.thinkingLevel && s.thinkingLevel !== 'think'
        if (hasNonDefaultMode || hasNonDefaultThinking) {
          optionsMap.set(s.id, {
            ultrathinkEnabled: false, // ultrathink is single-shot, never persisted
            permissionMode: s.permissionMode ?? 'ask',
            thinkingLevel: s.thinkingLevel ?? 'think',
          })
        }
      }
      setSessionOptions(optionsMap)
      // Mark sessions as loaded for splash screen
      setSessionsLoaded(true)

      // If window was opened with a specific session (via "Open in New Window"), select it
      if (initialSessionId && windowWorkspaceId) {
        const session = loadedSessions.find(s => s.id === initialSessionId)
        if (session) {
          navigate(routes.view.allChats(session.id))
        }
      }
    })
    // Load stored model preference
    window.electronAPI.getModel().then((storedModel) => {
      if (storedModel) {
        setCurrentModel(storedModel)
      }
    })
    // Load custom model override from API connection settings
    window.electronAPI.getApiSetup().then((billing) => {
      setCustomModel(billing.customModel || null)
    })
    // Load persisted input drafts into ref (no re-render needed)
    window.electronAPI.getAllDrafts().then((drafts) => {
      if (Object.keys(drafts).length > 0) {
        sessionDraftsRef.current = new Map(Object.entries(drafts))
      }
    })
    // Load app-level theme
    window.electronAPI.getAppTheme().then(setAppTheme)
  }, [appState, initialSessionId, windowWorkspaceId, setSession, initializeSessions])

  // Subscribe to theme change events (live updates when theme.json changes)
  useEffect(() => {
    const cleanupApp = window.electronAPI.onAppThemeChange((theme) => {
      setAppTheme(theme)
    })
    return () => {
      cleanupApp()
    }
  }, [])

  // Listen for session events - uses centralized event processor for consistent state transitions
  //
  // SOURCE OF TRUTH LOGIC:
  // - During streaming (atom.isProcessing = true): Atom is source of truth
  //   All events read from and write to atom. This preserves streaming data.
  // - When not streaming: React state is source of truth
  //   Events read/write React state, which syncs to atoms via useEffect.
  // - Handoff events (complete, error, etc.): End streaming, sync atom → React state
  //
  // This is simpler and more robust than checking event types - we just ask
  // "is this session currently streaming?" and route accordingly.
  useEffect(() => {
    // Handoff events signal end of streaming - need to sync back to React state
    // Also includes todo_state_changed so status updates immediately reflect in sidebar
    // async_operation included so shimmer effect on session titles updates in real-time
    const handoffEventTypes = new Set(['complete', 'error', 'interrupted', 'typed_error', 'todo_state_changed', 'session_flagged', 'session_unflagged', 'name_changed', 'labels_changed', 'title_generated', 'async_operation'])

    // Helper to handle side effects (same logic for both paths)
    const handleEffects = (effects: Effect[], sessionId: string, eventType: string) => {
      for (const effect of effects) {
        switch (effect.type) {
          case 'permission_request': {
            setPendingPermissions(prevPerms => {
              const next = new Map(prevPerms)
              const existingQueue = next.get(sessionId) || []
              next.set(sessionId, [...existingQueue, effect.request])
              return next
            })
            break
          }
          case 'permission_mode_changed': {
            console.log('[App] permission_mode_changed:', effect.sessionId, effect.permissionMode)
            setSessionOptions(prevOpts => {
              const next = new Map(prevOpts)
              const current = next.get(effect.sessionId) ?? defaultSessionOptions
              next.set(effect.sessionId, { ...current, permissionMode: effect.permissionMode })
              return next
            })
            break
          }
          case 'credential_request': {
            console.log('[App] credential_request:', sessionId, effect.request.mode)
            setPendingCredentials(prevCreds => {
              const next = new Map(prevCreds)
              const existingQueue = next.get(sessionId) || []
              next.set(sessionId, [...existingQueue, effect.request])
              return next
            })
            break
          }
          case 'auto_retry': {
            // A source was auto-activated, automatically re-send the original message
            console.log('[App] auto_retry: Source', effect.sourceSlug, 'activated, re-sending message')
            // Add suffix to indicate the source was activated
            const messageWithSuffix = `${effect.originalMessage}\n\n[${effect.sourceSlug} activated]`
            // Use setTimeout to ensure the previous turn has fully completed
            setTimeout(() => {
              window.electronAPI.sendMessage(effect.sessionId, messageWithSuffix)
            }, 100)
            break
          }
        }
      }

      // Clear pending permissions and credentials on complete
      if (eventType === 'complete') {
        setPendingPermissions(prevPerms => {
          if (prevPerms.has(sessionId)) {
            const next = new Map(prevPerms)
            next.delete(sessionId)
            return next
          }
          return prevPerms
        })
        setPendingCredentials(prevCreds => {
          if (prevCreds.has(sessionId)) {
            const next = new Map(prevCreds)
            next.delete(sessionId)
            return next
          }
          return prevCreds
        })
      }
    }

    const cleanup = window.electronAPI.onSessionEvent((event: SessionEvent) => {
      const sessionId = event.sessionId
      const workspaceId = windowWorkspaceId ?? ''
      const agentEvent = event as unknown as AgentEvent

      // Dispatch window event when compaction completes
      // This allows FreeFormInput to sequence the plan execution message after compaction
      // Note: markCompactionComplete is called on the backend (sessions.ts) to ensure
      // it happens even if CMD+R occurs during compaction
      if (event.type === 'info' && event.statusType === 'compaction_complete') {
        window.dispatchEvent(new CustomEvent('craft:compaction-complete', {
          detail: { sessionId }
        }))
      }

      // Check if session is currently streaming (atom is source of truth)
      const atomSession = store.get(sessionAtomFamily(sessionId))
      const isStreaming = atomSession?.isProcessing === true
      const isHandoff = handoffEventTypes.has(event.type)

      // During streaming OR for handoff events: use atom as source of truth
      // This ensures all events during streaming see the complete state
      if (isStreaming || isHandoff) {
        const currentSession = atomSession ?? null

        // Process the event
        const { session: updatedSession, effects } = processAgentEvent(
          agentEvent,
          currentSession,
          workspaceId
        )

        // Update atom directly (UI sees update immediately)
        updateSessionDirect(sessionId, () => updatedSession)

        // Handle side effects
        handleEffects(effects, sessionId, event.type)

        // Handle background task events
        handleBackgroundTaskEvent(store, sessionId, event, agentEvent)

        // For handoff events, update metadata map for list display
        // NOTE: No sessionsAtom to sync - atom and metadata are the source of truth
        if (isHandoff) {
          // Update metadata map
          const metaMap = store.get(sessionMetaMapAtom)
          const newMetaMap = new Map(metaMap)
          newMetaMap.set(sessionId, extractSessionMeta(updatedSession))
          store.set(sessionMetaMapAtom, newMetaMap)

          // Show notification on complete (when window is not focused)
          if (event.type === 'complete') {
            // Get the last assistant message as preview
            const lastMessage = updatedSession.messages.findLast(
              m => m.role === 'assistant' && !m.isIntermediate
            )
            const preview = lastMessage?.content?.substring(0, 100) || undefined
            showSessionNotification(updatedSession, preview)
          }
        }

        return
      }

      // Not streaming: use per-session atoms directly (no sessionsAtom)
      const currentSession = store.get(sessionAtomFamily(sessionId))

      const { session: updatedSession, effects } = processAgentEvent(
        agentEvent,
        currentSession,
        workspaceId
      )

      // Handle side effects
      handleEffects(effects, sessionId, event.type)

      // Handle background task events
      handleBackgroundTaskEvent(store, sessionId, event, agentEvent)

      // Update per-session atom
      updateSessionDirect(sessionId, () => updatedSession)

      // Update metadata map
      const metaMap = store.get(sessionMetaMapAtom)
      const newMetaMap = new Map(metaMap)
      newMetaMap.set(sessionId, extractSessionMeta(updatedSession))
      store.set(sessionMetaMapAtom, newMetaMap)
    })

    return cleanup
  }, [processAgentEvent, windowWorkspaceId, store, updateSessionDirect, showSessionNotification])

  // Listen for menu bar events
  useEffect(() => {
    const unsubNewChat = window.electronAPI.onMenuNewChat(() => {
      setMenuNewChatTrigger(n => n + 1)
    })
    const unsubSettings = window.electronAPI.onMenuOpenSettings(() => {
      handleOpenSettings()
    })
    const unsubShortcuts = window.electronAPI.onMenuKeyboardShortcuts(() => {
      navigate(routes.view.settings('shortcuts'))
    })
    return () => {
      unsubNewChat()
      unsubSettings()
      unsubShortcuts()
    }
  }, [])

  const handleCreateSession = useCallback(async (workspaceId: string, options?: import('../shared/types').CreateSessionOptions): Promise<Session> => {
    const session = await window.electronAPI.createSession(workspaceId, options)
    // Add to per-session atom and metadata map (no sessionsAtom)
    addSession(session)

    // Apply session defaults to the unified sessionOptions
    const hasNonDefaultMode = session.permissionMode && session.permissionMode !== 'ask'
    const hasNonDefaultThinking = session.thinkingLevel && session.thinkingLevel !== 'think'
    if (hasNonDefaultMode || hasNonDefaultThinking) {
      setSessionOptions(prev => {
        const next = new Map(prev)
        next.set(session.id, {
          ultrathinkEnabled: false,
          permissionMode: session.permissionMode ?? 'ask',
          thinkingLevel: session.thinkingLevel ?? 'think',
        })
        return next
      })
    }

    return session
  }, [addSession])

  // Deep link navigation is initialized later after handleInputChange is defined

  const handleDeleteSession = useCallback(async (sessionId: string, skipConfirmation = false): Promise<boolean> => {
    // Show confirmation dialog before deleting (unless skipped or session is empty)
    if (!skipConfirmation) {
      // Check if session has any messages using session metadata from Jotai store
      // We use store.get() instead of closing over sessions to prevent memory leaks
      // (closures would retain the full sessions array with all messages)
      const metaMap = store.get(sessionMetaMapAtom)
      const meta = metaMap.get(sessionId)
      // Session is empty if it has no lastFinalMessageId (no assistant responses) and no name (set on first user message)
      const isEmpty = !meta || (!meta.lastFinalMessageId && !meta.name)

      if (!isEmpty) {
        const confirmed = await window.electronAPI.showDeleteSessionConfirmation(meta?.name || 'Untitled')
        if (!confirmed) return false
      }
    }

    await window.electronAPI.deleteSession(sessionId)
    // Remove from per-session atom and metadata map (no sessionsAtom)
    removeSession(sessionId)
    return true
  }, [store, removeSession])

  const handleFlagSession = useCallback((sessionId: string) => {
    updateSessionById(sessionId, { isFlagged: true })
    window.electronAPI.sessionCommand(sessionId, { type: 'flag' })
  }, [updateSessionById])

  const handleUnflagSession = useCallback((sessionId: string) => {
    updateSessionById(sessionId, { isFlagged: false })
    window.electronAPI.sessionCommand(sessionId, { type: 'unflag' })
  }, [updateSessionById])

  /**
   * Set which session user is actively viewing (for unread state machine).
   * Called when user navigates to a session. Main process uses this to determine
   * whether to mark new assistant messages as unread.
   */
  const handleSetActiveViewingSession = useCallback((sessionId: string) => {
    // Optimistic UI update: clear hasUnread immediately
    updateSessionById(sessionId, { hasUnread: false })
    // Tell main process user is viewing this session
    window.electronAPI.sessionCommand(sessionId, { type: 'setActiveViewing', workspaceId: windowWorkspaceId ?? '' })
  }, [updateSessionById, windowWorkspaceId])

  const handleMarkSessionRead = useCallback((sessionId: string) => {
    // Update hasUnread flag (primary source of truth for NEW badge)
    // Also update lastReadMessageId for backwards compatibility
    updateSessionById(sessionId, (s) => {
      const lastFinalId = s.messages.findLast(
        m => m.role === 'assistant' && !m.isIntermediate
      )?.id
      return {
        hasUnread: false,
        ...(lastFinalId ? { lastReadMessageId: lastFinalId } : {}),
      }
    })
    window.electronAPI.sessionCommand(sessionId, { type: 'markRead' })
  }, [updateSessionById])

  const handleMarkSessionUnread = useCallback((sessionId: string) => {
    // Set hasUnread flag (primary source of truth for NEW badge)
    updateSessionById(sessionId, { hasUnread: true, lastReadMessageId: undefined })
    window.electronAPI.sessionCommand(sessionId, { type: 'markUnread' })
  }, [updateSessionById])

  const handleTodoStateChange = useCallback((sessionId: string, state: TodoState) => {
    updateSessionById(sessionId, { todoState: state })
    window.electronAPI.sessionCommand(sessionId, { type: 'setTodoState', state })
  }, [updateSessionById])

  const handleRenameSession = useCallback((sessionId: string, name: string) => {
    updateSessionById(sessionId, { name })
    window.electronAPI.sessionCommand(sessionId, { type: 'rename', name })
  }, [updateSessionById])

  const handleSendMessage = useCallback(async (sessionId: string, message: string, attachments?: FileAttachment[], skillSlugs?: string[]) => {
    try {
      // Step 1: Store attachments and get persistent metadata
      let storedAttachments: StoredAttachment[] | undefined
      let processedAttachments: FileAttachment[] | undefined

      if (attachments?.length) {
        // Store each attachment to disk (generates thumbnails, converts Office→markdown)
        // Use allSettled so one failure doesn't kill all attachments
        const storeResults = await Promise.allSettled(
          attachments.map(a => window.electronAPI.storeAttachment(sessionId, a))
        )

        // Filter successful stores, warn about failures
        storedAttachments = []
        const successfulAttachments: FileAttachment[] = []
        storeResults.forEach((result, i) => {
          if (result.status === 'fulfilled') {
            storedAttachments!.push(result.value)
            successfulAttachments.push(attachments[i])
          } else {
            console.warn(`Failed to store attachment "${attachments[i].name}":`, result.reason)
          }
        })

        // Notify user about failed attachments
        const failedCount = storeResults.filter(r => r.status === 'rejected').length
        if (failedCount > 0) {
          console.warn(`${failedCount} attachment(s) failed to store`)
          // Add warning message to session so user knows some attachments weren't included
          const failedNames = attachments
            .filter((_, i) => storeResults[i].status === 'rejected')
            .map(a => a.name)
            .join(', ')
          updateSessionById(sessionId, (s) => ({
            messages: [...s.messages, {
              id: generateMessageId(),
              role: 'warning' as const,
              content: `⚠️ ${failedCount} attachment(s) could not be stored and will not be sent: ${failedNames}`,
              timestamp: Date.now()
            }]
          }))
        }

        // Step 2: Create processed attachments for Claude
        // - Office files: Convert to text with markdown content
        // - Others: Use original FileAttachment
        // - All: Include storedPath so agent knows where files are stored
        // - Resized images: Use resizedBase64 instead of original large base64
        processedAttachments = await Promise.all(
          successfulAttachments.map(async (att, i) => {
            const stored = storedAttachments?.[i]
            if (!stored) {
              console.error(`Missing stored attachment at index ${i}`)
              return att // Fall back to original
            }
            // Include storedPath and markdownPath for all attachment types
            // Agent will use Read tool to access text/office files via these paths
            // If image was resized, use the resized base64 for Claude API
            return {
              ...att,
              storedPath: stored.storedPath,
              markdownPath: stored.markdownPath,
              // Use resized base64 if available (for images that exceeded size limits)
              base64: stored.resizedBase64 ?? att.base64,
            }
          })
        )
      }

      // Step 3: Check if ultrathink is enabled for this session
      const isUltrathink = sessionOptions.get(sessionId)?.ultrathinkEnabled ?? false

      // Step 4: Extract badges from mentions (sources/skills) with embedded icons
      // Badges are self-contained for display in UserMessageBubble and viewer
      const badges: ContentBadge[] = windowWorkspaceId
        ? extractBadges(message, skills, sources, windowWorkspaceId)
        : []

      // Step 4.1: Detect SDK slash commands (e.g., /compact) and create command badges
      // This makes /compact render as an inline badge rather than raw text
      const commandMatch = message.match(/^\/([a-z]+)(\s|$)/i)
      if (commandMatch && commandMatch[1].toLowerCase() === 'compact') {
        const commandText = commandMatch[0].trimEnd() // "/compact" without trailing space
        badges.unshift({
          type: 'command',
          label: 'Compact',
          rawText: commandText,
          start: 0,
          end: commandText.length,
        })
      }

      // Step 4.2: Detect plan execution messages and create file badges
      // Pattern: "Read the plan at <path> and execute it."
      // This is sent after compaction when accepting a plan, displays as clickable file badge
      // Only the file path is replaced with a badge - surrounding text remains visible
      const planExecuteMatch = message.match(/^(Read the plan at )(.+?)( and execute it\.?)$/i)
      if (planExecuteMatch) {
        const prefix = planExecuteMatch[1]      // "Read the plan at "
        const filePath = planExecuteMatch[2]    // the actual path
        const fileName = filePath.split('/').pop() || 'plan.md'
        badges.push({
          type: 'file',
          label: fileName,
          rawText: filePath,
          filePath: filePath,
          start: prefix.length,
          end: prefix.length + filePath.length,
        })
      }

      // Step 5: Create user message with StoredAttachments (for UI display)
      // Mark as isPending for optimistic UI - will be confirmed by user_message event
      const userMessage: Message = {
        id: generateMessageId(),
        role: 'user',
        content: message,
        timestamp: Date.now(),
        attachments: storedAttachments,
        badges: badges.length > 0 ? badges : undefined,
        ultrathink: isUltrathink || undefined,  // Only set if true
        isPending: true,  // Optimistic - will be confirmed by backend
      }

      // Optimistic UI update - add user message and set processing state
      updateSessionById(sessionId, (s) => ({
        messages: [...s.messages, userMessage],
        isProcessing: true,
        lastMessageAt: Date.now()
      }))

      // Step 6: Send to Claude with processed attachments + stored attachments for persistence
      await window.electronAPI.sendMessage(sessionId, message, processedAttachments, storedAttachments, {
        ultrathinkEnabled: isUltrathink,
        skillSlugs,
        badges: badges.length > 0 ? badges : undefined,
      })

      // Auto-disable ultrathink after sending (single-shot activation)
      if (isUltrathink) {
        handleSessionOptionsChange(sessionId, { ultrathinkEnabled: false })
      }
    } catch (error) {
      console.error('Failed to send message:', error)
      updateSessionById(sessionId, (s) => ({
        isProcessing: false,
        messages: [
          ...s.messages,
          {
            id: generateMessageId(),
            role: 'error' as const,
            content: `Failed to send message: ${error instanceof Error ? error.message : 'Unknown error'}`,
            timestamp: Date.now()
          }
        ]
      }))
    }
  }, [sessionOptions, updateSessionById, skills, sources, windowWorkspaceId])

  const handleModelChange = useCallback((model: string) => {
    setCurrentModel(model)
    // Persist to config so it's remembered across launches
    window.electronAPI.setModel(model)
  }, [])

  /**
   * Unified handler for all session option changes.
   * Handles persistence and backend sync for each option type.
   */
  const handleSessionOptionsChange = useCallback((sessionId: string, updates: SessionOptionUpdates) => {
    setSessionOptions(prev => {
      const next = new Map(prev)
      const current = next.get(sessionId) ?? defaultSessionOptions
      next.set(sessionId, mergeSessionOptions(current, updates))
      return next
    })

    // Handle persistence/backend for specific options
    if (updates.permissionMode !== undefined) {
      // Sync permission mode change with backend
      window.electronAPI.sessionCommand(sessionId, { type: 'setPermissionMode', mode: updates.permissionMode })
    }
    if (updates.thinkingLevel !== undefined) {
      // Sync thinking level change with backend (session-level, persisted)
      window.electronAPI.sessionCommand(sessionId, { type: 'setThinkingLevel', level: updates.thinkingLevel })
    }
    // ultrathinkEnabled is UI-only (single-shot), no backend persistence needed
  }, [sessionOptions])

  // Handle input draft changes per session with debounced persistence
  const draftSaveTimeoutRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Cleanup draft save timers on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      draftSaveTimeoutRef.current.forEach(clearTimeout)
      draftSaveTimeoutRef.current.clear()
    }
  }, [])

  // Getter for draft values - reads from ref without triggering re-renders
  const getDraft = useCallback((sessionId: string): string => {
    return sessionDraftsRef.current.get(sessionId) ?? ''
  }, [])

  const handleInputChange = useCallback((sessionId: string, value: string) => {
    // Update ref immediately (no re-render triggered)
    if (value) {
      sessionDraftsRef.current.set(sessionId, value)
    } else {
      sessionDraftsRef.current.delete(sessionId) // Clean up empty drafts
    }

    // Debounced persistence to disk (500ms delay)
    const existingTimeout = draftSaveTimeoutRef.current.get(sessionId)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
    }

    const timeout = setTimeout(() => {
      window.electronAPI.setDraft(sessionId, value)
      draftSaveTimeoutRef.current.delete(sessionId)
    }, DRAFT_SAVE_DEBOUNCE_MS)
    draftSaveTimeoutRef.current.set(sessionId, timeout)
  }, [])

  // Open new chat - creates session and selects it
  // Used by components via AppShellContext and for programmatic navigation
  const openNewChat = useCallback(async (params: NewChatActionParams = {}) => {
    if (!windowWorkspaceId) {
      console.warn('[App] Cannot open new chat: no workspace ID')
      return
    }

    const session = await handleCreateSession(windowWorkspaceId)

    if (params.name) {
      await window.electronAPI.sessionCommand(session.id, { type: 'rename', name: params.name })
    }

    // Navigate to the chat view - this sets both selectedSession and activeView
    navigate(routes.view.allChats(session.id))

    // Pre-fill input if provided (after a small delay to ensure component is mounted)
    if (params.input) {
      setTimeout(() => handleInputChange(session.id, params.input!), 100)
    }
  }, [windowWorkspaceId, handleCreateSession, handleInputChange])

  const handleRespondToPermission = useCallback(async (sessionId: string, requestId: string, allowed: boolean, alwaysAllow: boolean) => {
    console.log('[App] handleRespondToPermission called:', { sessionId, requestId, allowed, alwaysAllow })

    const success = await window.electronAPI.respondToPermission(sessionId, requestId, allowed, alwaysAllow)
    console.log('[App] handleRespondToPermission IPC result:', { success })

    if (success) {
      // Remove only the first permission from the queue (the one we just responded to)
      setPendingPermissions(prev => {
        const next = new Map(prev)
        const queue = next.get(sessionId) || []
        const remainingQueue = queue.slice(1) // Remove first item
        console.log('[App] handleRespondToPermission: clearing permission from queue, remaining:', remainingQueue.length)
        if (remainingQueue.length === 0) {
          next.delete(sessionId)
        } else {
          next.set(sessionId, remainingQueue)
        }
        return next
      })
      // Note: No need to force session refresh - per-session atoms update automatically
    } else {
      // Response failed (agent/session gone) - clear the permission anyway
      // to avoid UI being stuck with stale permission
      setPendingPermissions(prev => {
        const next = new Map(prev)
        const queue = next.get(sessionId) || []
        const remainingQueue = queue.slice(1)
        if (remainingQueue.length === 0) {
          next.delete(sessionId)
        } else {
          next.set(sessionId, remainingQueue)
        }
        return next
      })
    }
  }, [])

  const handleRespondToCredential = useCallback(async (sessionId: string, requestId: string, response: CredentialResponse) => {
    console.log('[App] handleRespondToCredential called:', { sessionId, requestId, cancelled: response.cancelled })

    const success = await window.electronAPI.respondToCredential(sessionId, requestId, response)
    console.log('[App] handleRespondToCredential IPC result:', { success })

    if (success) {
      // Remove only the first credential from the queue (the one we just responded to)
      setPendingCredentials(prev => {
        const next = new Map(prev)
        const queue = next.get(sessionId) || []
        const remainingQueue = queue.slice(1) // Remove first item
        console.log('[App] handleRespondToCredential: clearing credential from queue, remaining:', remainingQueue.length)
        if (remainingQueue.length === 0) {
          next.delete(sessionId)
        } else {
          next.set(sessionId, remainingQueue)
        }
        return next
      })
      // Note: No need to force session refresh - per-session atoms update automatically
    } else {
      // Response failed (agent/session gone) - clear the credential anyway
      // to avoid UI being stuck with stale credential request
      setPendingCredentials(prev => {
        const next = new Map(prev)
        const queue = next.get(sessionId) || []
        const remainingQueue = queue.slice(1)
        if (remainingQueue.length === 0) {
          next.delete(sessionId)
        } else {
          next.set(sessionId, remainingQueue)
        }
        return next
      })
    }
  }, [])

  const handleOpenFile = useCallback(async (path: string) => {
    try {
      await window.electronAPI.openFile(path)
    } catch (error) {
      console.error('Failed to open file:', error)
    }
  }, [])

  const handleOpenUrl = useCallback(async (url: string) => {
    try {
      await window.electronAPI.openUrl(url)
    } catch (error) {
      console.error('Failed to open URL:', error)
    }
  }, [])

  const handleOpenSettings = useCallback(() => {
    navigate(routes.view.settings())
  }, [])

  const handleOpenKeyboardShortcuts = useCallback(() => {
    navigate(routes.view.settings('shortcuts'))
  }, [])

  const handleOpenStoredUserPreferences = useCallback(() => {
    navigate(routes.view.settings('preferences'))
  }, [])

  // Show reset confirmation dialog
  const handleReset = useCallback(() => {
    setShowResetDialog(true)
  }, [])

  // Execute reset after user confirms in dialog
  const executeReset = useCallback(async () => {
    try {
      await window.electronAPI.logout()
      // Reset all state
      // Clear session atoms - initialize with empty array clears all per-session atoms
      initializeSessions([])
      setWorkspaces([])
      setWindowWorkspaceId(null)
      // Reset setupNeeds to force fresh onboarding start
      setSetupNeeds({
        needsBillingConfig: true,
        needsCredentials: true,
        isFullyConfigured: false,
      })
      // Reset onboarding hook state
      onboarding.reset()
      setAppState('onboarding')
    } catch (error) {
      console.error('Reset failed:', error)
    } finally {
      setShowResetDialog(false)
    }
  }, [onboarding, initializeSessions])

  // Handle workspace selection
  // - Default: switch workspace in same window (in-window switching)
  // - With openInNewWindow=true: open in new window (or focus existing)
  const handleSelectWorkspace = useCallback(async (workspaceId: string, openInNewWindow = false) => {
    // If selecting current workspace, do nothing
    if (workspaceId === windowWorkspaceId) return

    if (openInNewWindow) {
      // Open (or focus) the window for the selected workspace
      window.electronAPI.openWorkspace(workspaceId)
    } else {
      // Switch workspace in current window
      // 1. Update the main process's window-workspace mapping
      await window.electronAPI.switchWorkspace(workspaceId)

      // 2. Update React state to trigger re-renders
      setWindowWorkspaceId(workspaceId)

      // 3. Clear selected session - the old session belongs to the previous workspace
      // and should not remain selected when switching to a new workspace.
      // This prevents showing stale session data from the wrong workspace.
      setSession({ selected: null })

      // 4. Navigate to allChats view without a specific session selected
      // This ensures the UI is in a clean state for the new workspace
      navigate(routes.view.allChats())

      // 5. Clear pending permissions/credentials (not relevant to new workspace)
      setPendingPermissions(new Map())
      setPendingCredentials(new Map())

      // Note: Sessions and theme will reload automatically due to windowWorkspaceId dependency
      // in useEffect hooks
    }
  }, [windowWorkspaceId, setSession])

  // Handle workspace refresh (e.g., after icon upload)
  const handleRefreshWorkspaces = useCallback(() => {
    window.electronAPI.getWorkspaces().then(setWorkspaces)
  }, [])

  // Handle cancel during onboarding
  const handleOnboardingCancel = useCallback(() => {
    onboarding.handleCancel()
  }, [onboarding])

  // Build context value for AppShell component
  // This is memoized to prevent unnecessary re-renders
  // IMPORTANT: Must be before early returns to maintain consistent hook order
  const appShellContextValue = useMemo<AppShellContextType>(() => ({
    // Data
    // NOTE: sessions is NOT included - use sessionMetaMapAtom for listing
    // and useSession(id) hook for individual sessions. This prevents memory leaks.
    workspaces,
    activeWorkspaceId: windowWorkspaceId,
    currentModel,
    customModel,
    pendingPermissions,
    pendingCredentials,
    getDraft,
    sessionOptions,
    // Session callbacks
    onCreateSession: handleCreateSession,
    onSendMessage: handleSendMessage,
    onRenameSession: handleRenameSession,
    onFlagSession: handleFlagSession,
    onUnflagSession: handleUnflagSession,
    onMarkSessionRead: handleMarkSessionRead,
    onMarkSessionUnread: handleMarkSessionUnread,
    onSetActiveViewingSession: handleSetActiveViewingSession,
    onTodoStateChange: handleTodoStateChange,
    onDeleteSession: handleDeleteSession,
    onRespondToPermission: handleRespondToPermission,
    onRespondToCredential: handleRespondToCredential,
    // File/URL handlers
    onOpenFile: handleOpenFile,
    onOpenUrl: handleOpenUrl,
    // Model
    onModelChange: handleModelChange,
    refreshCustomModel,
    // Workspace
    onSelectWorkspace: handleSelectWorkspace,
    onRefreshWorkspaces: handleRefreshWorkspaces,
    // App actions
    onOpenSettings: handleOpenSettings,
    onOpenKeyboardShortcuts: handleOpenKeyboardShortcuts,
    onOpenStoredUserPreferences: handleOpenStoredUserPreferences,
    onReset: handleReset,
    // Session options
    onSessionOptionsChange: handleSessionOptionsChange,
    onInputChange: handleInputChange,
    // New chat (via deep link navigation)
    openNewChat,
  }), [
    // NOTE: sessions removed to prevent memory leaks - components use atoms instead
    workspaces,
    windowWorkspaceId,
    currentModel,
    customModel,
    pendingPermissions,
    pendingCredentials,
    getDraft,
    sessionOptions,
    handleCreateSession,
    handleSendMessage,
    handleRenameSession,
    handleFlagSession,
    handleUnflagSession,
    handleMarkSessionRead,
    handleMarkSessionUnread,
    handleSetActiveViewingSession,
    handleTodoStateChange,
    handleDeleteSession,
    handleRespondToPermission,
    handleRespondToCredential,
    handleOpenFile,
    handleOpenUrl,
    handleModelChange,
    refreshCustomModel,
    handleSelectWorkspace,
    handleRefreshWorkspaces,
    handleOpenSettings,
    handleOpenKeyboardShortcuts,
    handleOpenStoredUserPreferences,
    handleReset,
    handleSessionOptionsChange,
    handleInputChange,
    openNewChat,
  ])

  // Platform actions for @craft-agent/ui components (overlays, etc.)
  // Memoized to prevent re-renders when these callbacks don't change
  // NOTE: Must be defined before early returns to maintain consistent hook order
  const platformActions = useMemo(() => ({
    onOpenFile: handleOpenFile,
    onOpenUrl: handleOpenUrl,
    // Hide/show macOS traffic lights when fullscreen overlays are open
    onSetTrafficLightsVisible: (visible: boolean) => {
      window.electronAPI.setTrafficLightsVisible(visible)
    },
  }), [handleOpenFile, handleOpenUrl])

  // Loading state - show splash screen
  if (appState === 'loading') {
    return <SplashScreen isExiting={false} />
  }

  // Reauth state - session expired, need to re-login
  // ModalProvider + WindowCloseHandler ensures X button works on Windows
  if (appState === 'reauth') {
    return (
      <ModalProvider>
        <WindowCloseHandler />
        <ReauthScreen
          onLogin={handleReauthLogin}
          onReset={handleReauthReset}
        />
        <ResetConfirmationDialog
          open={showResetDialog}
          onConfirm={executeReset}
          onCancel={() => setShowResetDialog(false)}
        />
      </ModalProvider>
    )
  }

  // Onboarding state
  // ModalProvider + WindowCloseHandler ensures X button works on Windows
  // (without this, the close IPC message has no listener and window stays open)
  if (appState === 'onboarding') {
    return (
      <ModalProvider>
        <WindowCloseHandler />
        <OnboardingWizard
          state={onboarding.state}
          onContinue={onboarding.handleContinue}
          onBack={onboarding.handleBack}
          onSelectApiSetupMethod={onboarding.handleSelectApiSetupMethod}
          onSubmitCredential={onboarding.handleSubmitCredential}
          onStartOAuth={onboarding.handleStartOAuth}
          onFinish={onboarding.handleFinish}
          isWaitingForCode={onboarding.isWaitingForCode}
          onSubmitAuthCode={onboarding.handleSubmitAuthCode}
          onCancelOAuth={onboarding.handleCancelOAuth}
          onBrowseGitBash={onboarding.handleBrowseGitBash}
          onUseGitBashPath={onboarding.handleUseGitBashPath}
          onRecheckGitBash={onboarding.handleRecheckGitBash}
          onClearError={onboarding.handleClearError}
        />
      </ModalProvider>
    )
  }

  // Show splash until exit animation completes
  const showSplash = !splashHidden

  // Ready state - main app with splash overlay during data loading
  return (
    <PlatformProvider actions={platformActions}>
    <ShikiThemeProvider shikiTheme={shikiTheme}>
      <FocusProvider>
        <ModalProvider>
        <TooltipProvider>
        <NavigationProvider
          workspaceId={windowWorkspaceId}
          onCreateSession={handleCreateSession}
          onInputChange={handleInputChange}
          isReady={appState === 'ready'}
        >
          {/* Handle window close requests (X button, Cmd+W) - close modal first if open */}
          <WindowCloseHandler />

          {/* Splash screen overlay - fades out when fully ready */}
          {showSplash && (
            <SplashScreen
              isExiting={splashExiting}
              onExitComplete={handleSplashExitComplete}
            />
          )}

          {/* Main UI - always rendered, splash fades away to reveal it */}
          <div className="h-full flex flex-col text-foreground">
            <div className="flex-1 min-h-0">
              <AppShell
                contextValue={appShellContextValue}
                defaultLayout={[20, 32, 48]}
                menuNewChatTrigger={menuNewChatTrigger}
                isFocusedMode={isFocusedMode}
              />
            </div>
            <ResetConfirmationDialog
              open={showResetDialog}
              onConfirm={executeReset}
              onCancel={() => setShowResetDialog(false)}
            />
          </div>
        </NavigationProvider>
        </TooltipProvider>
        </ModalProvider>
      </FocusProvider>
    </ShikiThemeProvider>
    </PlatformProvider>
  )
}

/**
 * Component that handles window close requests.
 * Must be inside ModalProvider to access the modal registry.
 */
function WindowCloseHandler() {
  useWindowCloseHandler()
  return null
}
