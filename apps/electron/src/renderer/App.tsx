import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/hooks/useTheme'
import type { ThemeOverrides } from '@config/theme'
import { useSetAtom, useStore, useAtomValue } from 'jotai'
import type { Session, SessionEvent, Message, FileAttachment, StoredAttachment, SetupNeeds, NewChatActionParams, ContentBadge, PermissionModeState } from '../shared/types'
import type { SessionOptions, SessionOptionUpdates } from './hooks/useSessionOptions'
import { defaultSessionOptions, mergeSessionOptions } from './hooks/useSessionOptions'
import { generateMessageId } from '../shared/types'
import { useEventProcessor } from './event-processor'
import type { AgentEvent, Effect } from './event-processor'
import { ChatSessionArea } from '@/shell'
import type { AppShellContextType } from '@/context/AppShellContext'
import { OnboardingWizard, ReauthScreen } from '@/components/onboarding'
import { WorkspacePicker } from '@/components/workspace'
import { ResetConfirmationDialog } from '@/components/ResetConfirmationDialog'
import { TooltipProvider } from '@archstudio/ui'
import { FocusProvider } from '@/context/FocusContext'
import { ModalProvider } from '@/context/ModalContext'
import { DismissibleLayerProvider } from '@/context/DismissibleLayerContext'
import { useWindowCloseHandler } from '@/hooks/useWindowCloseHandler'
import { useOnboarding } from '@/hooks/useOnboarding'
import { useNotifications } from '@/hooks/useNotifications'
import { useSession } from '@/hooks/useSession'
import { useUpdateChecker } from '@/hooks/useUpdateChecker'
import { NavigationProvider } from '@/contexts/NavigationContext'
import { navigate, routes } from './lib/navigate'
import { stripMarkdown } from './utils/text'
import { coerceInputText } from './lib/input-text'
import { useSessionDrafts } from './hooks/useSessionDrafts'
import { useWorkspaceController } from './hooks/useWorkspaceController'
import { useSessionController } from './hooks/useSessionController'
import { useAppSessionActions } from './hooks/useAppSessionActions'
import { useApprovalRequests } from './hooks/useApprovalRequests'
import { useLlmConnections } from './hooks/useLlmConnections'
import { getSessionsToRefreshAfterStaleReconnect } from './lib/reconnect-recovery'
import { extractWorkspaceSlugFromPath } from '@archstudio/shared/utils/workspace-slug'
import { DEFAULT_THINKING_LEVEL } from '@archstudio/shared/agent/thinking-levels'
import { initRendererPerf } from './lib/perf'
import {
  initializeSessionsAtom,
  addSessionAtom,
  removeSessionAtom,
  updateSessionAtom,
  replaceLoadedSessionAtom,
  sessionAtomFamily,
  sessionMetaMapAtom,
  sessionIdsAtom,
  forceSessionMessagesReloadAtom,
  backgroundTasksAtomFamily,
  extractSessionMeta,
  type BackgroundTask,
} from '@/atoms/sessions'
import { sourcesAtom } from '@/atoms/sources'
import { skillsAtom } from '@/atoms/skills'
import {
  showBackgroundFinishedChipAtom,
  pushBackgroundFinishedAtom,
} from '@/atoms/background-finished'
import { visibleSessionIdsAtom } from '@/atoms/panel-stack'
import { getSessionTitle } from '@/utils/session'
import { extractBadges } from '@/lib/mentions'
import { getDefaultStore } from 'jotai'
import {
  ShikiThemeProvider,
  PlatformProvider,
  ImagePreviewOverlay,
  PDFPreviewOverlay,
  CodePreviewOverlay,
  DocumentFormattedMarkdownOverlay,
  JSONPreviewOverlay,
} from '@archstudio/ui'
import { useLinkInterceptor, type FilePreviewState } from '@/hooks/useLinkInterceptor'
import { useTransportConnectionState } from '@/hooks/useTransportConnectionState'
import { TransportConnectionBanner, shouldShowTransportConnectionBanner } from '@/components/app-shell/TransportConnectionBanner'
import {
  markBackgroundTaskSignal,
  markLiveBackgroundTasksOrphaned,
} from '@/components/app-shell/background-task-chip-state'
import { getFileManagerName } from '@/lib/platform'
import { ActionRegistryProvider } from '@/actions'
import { toast } from 'sonner'

type AppState = 'loading' | 'onboarding' | 'reauth' | 'workspace-picker' | 'ready'

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
      const isWorkflow = evt.kind === 'workflow'
      const startTime = Date.now()
      store.set(backgroundTasksAtom, [
        ...currentTasks,
        {
          id: evt.taskId as string,
          type: isWorkflow ? ('workflow' as const) : ('agent' as const),
          toolUseId: evt.toolUseId as string,
          startTime,
          elapsedSeconds: 0,
          lastSignalAt: startTime,
          intent: evt.intent as string | undefined,
          status: 'running' as const,
          ...(isWorkflow ? { workflowId: evt.workflowId as string | undefined, agentsCompleted: 0 } : {}),
        },
      ])
    }
  } else if (event.type === 'workflow_agent_completed' && 'workflowId' in evt) {
    // One sub-agent of a running Workflow finished — bump the owning chip's count
    // and treat it as evidence that a stale workflow is still alive.
    const currentTasks = store.get(backgroundTasksAtom)
    const now = Date.now()
    store.set(backgroundTasksAtom, currentTasks.map(t =>
      t.type === 'workflow' && t.workflowId === evt.workflowId
        ? { ...markBackgroundTaskSignal(t, now), agentsCompleted: (t.agentsCompleted ?? 0) + 1 }
        : t
    ))
  } else if (event.type === 'shell_backgrounded' && 'shellId' in evt && 'toolUseId' in evt) {
    const currentTasks = store.get(backgroundTasksAtom)
    const exists = currentTasks.some(t => t.toolUseId === evt.toolUseId)
    if (!exists) {
      const startTime = Date.now()
      store.set(backgroundTasksAtom, [
        ...currentTasks,
        {
          id: evt.shellId as string,
          type: 'shell' as const,
          toolUseId: evt.toolUseId as string,
          startTime,
          elapsedSeconds: 0,
          lastSignalAt: startTime,
          intent: evt.intent as string | undefined,
          status: 'running' as const,
        },
      ])
    }
  } else if (event.type === 'task_progress' && 'toolUseId' in evt && 'elapsedSeconds' in evt) {
    const currentTasks = store.get(backgroundTasksAtom)
    const now = Date.now()
    store.set(backgroundTasksAtom, currentTasks.map(t =>
      t.toolUseId === evt.toolUseId
        ? { ...markBackgroundTaskSignal(t, now), elapsedSeconds: evt.elapsedSeconds as number }
        : t
    ))
  } else if (event.type === 'task_completed' && 'taskId' in evt) {
    // Transition the chip to a terminal status (keep it visible with a terminal
    // icon + click-through to output). The ActiveTasksBar auto-expiry ticker
    // prunes it after a short linger — we no longer remove it instantly, so the
    // user sees that the task finished rather than the chip just vanishing.
    const status = (evt.status as BackgroundTask['status']) ?? 'completed'
    const currentTasks = store.get(backgroundTasksAtom)
    store.set(backgroundTasksAtom, currentTasks.map(t =>
      t.id === evt.taskId
        ? {
            ...t,
            status,
            completedAt: Date.now(),
            outputFile: (evt.outputFile as string | undefined) ?? t.outputFile,
            summary: (evt.summary as string | undefined) ?? t.summary,
          }
        : t
    ))
  } else if (event.type === 'shell_killed' && 'shellId' in evt) {
    // Mark shell stopped (lingers briefly, then auto-expires) instead of vanishing.
    const currentTasks = store.get(backgroundTasksAtom)
    store.set(backgroundTasksAtom, currentTasks.map(t =>
      t.id === evt.shellId
        ? { ...t, status: 'stopped' as const, completedAt: Date.now() }
        : t
    ))
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
  } else if (event.type === 'complete' || event.type === 'interrupted' || event.type === 'error') {
    // Orphan backstop: without keep-alive, turn teardown is authoritative evidence
    // that both running and uncertain/stale background tasks died with the SDK
    // subprocess. With keep-alive they may genuinely survive, so preserve them for
    // a later progress or task_completed signal.
    if (evt.backgroundTasksAlive === true) {
      return
    }
    const currentTasks = store.get(backgroundTasksAtom)
    const nextTasks = markLiveBackgroundTasksOrphaned(currentTasks, Date.now())
    if (nextTasks !== currentTasks) {
      store.set(backgroundTasksAtom, nextTasks)
    }
  }
}

function SessionLoadErrorScreen({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  const { t } = useTranslation()

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-lg rounded-xl border border-border/50 bg-background shadow-minimal p-6 text-center">
        <h2 className="text-lg font-semibold text-foreground">{t("errors.failedToLoadSessions")}</h2>
        <p className="mt-2 text-sm text-foreground/60">
          {t("errors.failedToLoadSessionsDesc")}
        </p>
        <p className="mt-3 rounded-lg bg-foreground/5 px-3 py-2 text-left text-xs text-foreground/70 break-words">
          {message}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex h-8 items-center justify-center rounded-[8px] bg-foreground text-background px-3 text-sm font-medium hover:opacity-90 transition-opacity"
        >
          {t("errors.retryLoadingSessions")}
        </button>
      </div>
    </div>
  )
}

export default function App() {
  const { t } = useTranslation()

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
  const replaceLoadedSession = useSetAtom(replaceLoadedSessionAtom)
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

  const {
    activeWorkspaceId: windowWorkspaceId,
    activeWorkspaceSlug: windowWorkspaceSlug,
    refreshWorkspaces,
    remoteWorkspaceId: windowRemoteWorkspaceId,
    selectWorkspace,
    selectWorkspaceBySlug,
    setActiveWorkspaceId: setWindowWorkspaceId,
    setWorkspaces,
    workspaces,
  } = useWorkspaceController()

  // Get initial sessionId and focused mode from URL params (for "Open in New Window" feature)
  const { initialSessionId, isFocusedMode } = useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    return {
      initialSessionId: params.get('sessionId'),
      isFocusedMode: params.get('focused') === 'true',
    }
  }, [])

  const {
    connections: llmConnections,
    refreshConnections: refreshLlmConnections,
    workspaceDefaultConnection: workspaceDefaultLlmConnection,
  } = useLlmConnections(windowWorkspaceId, appState === 'ready')

  const [menuNewChatTrigger, setMenuNewChatTrigger] = useState(0)
  const {
    clearAllRequests,
    clearSessionRequests,
    enqueueCredential,
    enqueuePermission,
    pendingCredentials,
    pendingPermissions,
    respondToCredential: handleRespondToCredential,
    respondToPermission: handleRespondToPermission,
  } = useApprovalRequests()
  const {
    clearDrafts,
    getDraft,
    getDraftAttachmentRefs,
    handleAttachmentsChange,
    handleInputChange,
    hydrateDraftAttachments,
    replaceDrafts,
  } = useSessionDrafts()
  // Unified session options for all session-scoped settings
  const [sessionOptions, setSessionOptions] = useState<Map<string, SessionOptions>>(new Map())

  // Theme state (app-level only)
  const [appTheme, setAppTheme] = useState<ThemeOverrides | null>(null)
  // Reset confirmation dialog
  const [showResetDialog, setShowResetDialog] = useState(false)

  // Auto-update state
  const updateChecker = useUpdateChecker()

  // Notifications enabled state (from app settings)
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)

  // Sources and skills for badge extraction
  const sources = useAtomValue(sourcesAtom)
  const skills = useAtomValue(skillsAtom)

  // Apply theme via hook (injects CSS variables)
  // shikiTheme is passed to ShikiThemeProvider to ensure correct syntax highlighting
  // theme for dark-only themes in light system mode
  const { shikiTheme, isDark } = useTheme({ appTheme })

  // Ref for sessionOptions to access current value in event handlers without re-registering
  const sessionOptionsRef = useRef(sessionOptions)
  // Keep ref in sync with state
  useEffect(() => {
    sessionOptionsRef.current = sessionOptions
  }, [sessionOptions])

  const applyPermissionModeState = useCallback((sessionId: string, state: PermissionModeState, source: 'event' | 'reconcile') => {
    setSessionOptions(prev => {
      const next = new Map(prev)
      const current = next.get(sessionId) ?? defaultSessionOptions
      const currentVersion = current.permissionModeVersion ?? -1

      if (state.modeVersion < currentVersion) {
        window.electronAPI.debugLog(
          '[ModeSync] Ignoring stale permission mode update',
          { sessionId, source, incoming: state.modeVersion, current: currentVersion }
        )
        return prev
      }

      if (
        state.modeVersion === currentVersion &&
        current.permissionMode !== state.permissionMode
      ) {
        window.electronAPI.debugLog(
          '[ModeSync] Equal modeVersion with differing mode detected, applying and requesting reconciliation',
          {
            sessionId,
            source,
            modeVersion: state.modeVersion,
            currentMode: current.permissionMode,
            incomingMode: state.permissionMode,
          }
        )
      }

      next.set(sessionId, {
        ...current,
        permissionMode: state.permissionMode,
        permissionModeVersion: state.modeVersion,
      })
      return next
    })
  }, [])

  const reconcilePermissionModeState = useCallback(async (sessionId: string) => {
    try {
      const state = await window.electronAPI.getSessionPermissionModeState(sessionId)
      if (!state) return
      applyPermissionModeState(sessionId, state, 'reconcile')
    } catch (error) {
      window.electronAPI.debugLog('[ModeSync] Failed to reconcile permission mode', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }, [applyPermissionModeState])

  // Event processor hook - handles all agent events through pure functions
  const { processAgentEvent, clearStreamingState } = useEventProcessor()

  const syncSessionOptionsFromSession = useCallback((session: Session) => {
    setSessionOptions(prev => {
      const next = new Map(prev)
      const current = next.get(session.id)
      const merged = {
        ...defaultSessionOptions,
        ...current,
        permissionMode: session.permissionMode ?? defaultSessionOptions.permissionMode,
        thinkingLevel: session.thinkingLevel ?? DEFAULT_THINKING_LEVEL,
      }

      const hasNonDefaultMode = merged.permissionMode !== defaultSessionOptions.permissionMode
      const hasNonDefaultThinking = merged.thinkingLevel !== DEFAULT_THINKING_LEVEL

      if (!hasNonDefaultMode && !hasNonDefaultThinking && merged.permissionModeVersion == null) {
        next.delete(session.id)
      } else {
        next.set(session.id, merged)
      }

      return next
    })
  }, [])

  const {
    loadSessionsFromServer,
    refreshSessionFromServer,
    refreshSessionListMetadataFromServer,
    sessionLoadError,
    sessionsLoaded,
    trackSessionActivity,
  } = useSessionController({
    store,
    initializeSessions,
    replaceLoadedSession,
    clearStreamingState,
    syncSessionOptionsFromSession,
    reconcilePermissionModeState,
    setSessionOptions,
    initialSessionId,
    workspaceId: windowWorkspaceId,
    remoteWorkspaceId: windowRemoteWorkspaceId,
  })

  // Handle onboarding completion
  const handleOnboardingComplete = useCallback(async () => {
    try {
      // Reload workspaces after onboarding
      const ws = await window.electronAPI.getWorkspaces()
      if (ws.length > 0) {
        // Switch to workspace in-place (no window close/reopen)
        await window.electronAPI.switchWorkspace(ws[0].id)
        setWindowWorkspaceId(ws[0].id)
        setWorkspaces(ws)
      } else {
        setWorkspaces(ws)
      }
    } catch (error) {
      console.error('[App] Failed to load workspaces after onboarding:', error)
      // Still transition to ready — the app can recover via reconnect
    }
    setAppState('ready')
  }, [])

  // Onboarding hook — onConfigSaved fires immediately when billing is saved,
  // ensuring connection state updates before the wizard closes.
  const onboarding = useOnboarding({
    onComplete: handleOnboardingComplete,
    onConfigSaved: refreshLlmConnections,
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
          // If no workspace is selected (thin client without ARCHSTUDIO_WORKSPACE_ID),
          // show workspace picker before entering the main app
          if (!wsId) {
            setAppState('workspace-picker')
          } else {
            setAppState('ready')
          }
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
  const [sessionSelection, setSession] = useSession()

  // Notification system - shows native OS notifications and badge count
  const handleNavigateToSession = useCallback((sessionId: string) => {
    // Navigate to the session via central routing (uses allSessions filter)
    navigate(routes.view.allSessions(sessionId))
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
    window.electronAPI.getNotificationsEnabled().then(setNotificationsEnabled).catch(() => {})

    // Show actionable toast for missing system dependencies (Windows only)
    window.electronAPI.getSystemWarnings().then((warnings) => {
      if (warnings.vcredistMissing) {
        toast.warning(t('toast.vcRedistNotFound'), {
          description: t('toast.vcRedistNotFoundDesc'),
          duration: Infinity,
          action: {
            label: 'Install',
            onClick: () => window.electronAPI.openUrl(warnings.downloadUrl ?? 'https://aka.ms/vs/17/release/vc_redist.x64.exe'),
          },
        })
      }
    }).catch(() => { /* non-fatal startup check */ })
    void loadSessionsFromServer()
    // Load persisted input drafts into ref (no re-render needed).
    // Attachment files are not read here — hydration happens lazily when the session
    // is opened so app startup isn't delayed by reading potentially large files.
    window.electronAPI.getAllDrafts().then((drafts) => {
      if (Object.keys(drafts).length > 0) replaceDrafts(drafts)
    })
    // Load app-level theme
    window.electronAPI.getAppTheme().then(setAppTheme)
  }, [appState, loadSessionsFromServer])

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
    const handoffEventTypes = new Set(['complete', 'error', 'interrupted', 'typed_error', 'session_status_changed', 'session_metadata_changed', 'session_flagged', 'session_unflagged', 'name_changed', 'labels_changed', 'project_id_changed', 'title_generated', 'async_operation'])

    // Helper to handle side effects (same logic for both paths)
    const handleEffects = (effects: Effect[], sessionId: string, eventType: string) => {
      for (const effect of effects) {
        switch (effect.type) {
          case 'permission_request': {
            enqueuePermission(sessionId, effect.request)

            // Native notification for approval-required pauses (same gating as completion notifications)
            const notifySession = store.get(sessionAtomFamily(sessionId))
            if (notifySession && !notifySession.hidden) {
              const isAdminPrompt = effect.request.type === 'admin_approval'
              const promptBody = isAdminPrompt
                ? `Admin approval required: ${effect.request.appName || effect.request.toolName}`
                : `Permission required: ${effect.request.toolName}`
              showSessionNotification(notifySession, promptBody)
            }
            break
          }
          case 'permission_mode_changed': {
            if (typeof effect.modeVersion === 'number' && effect.changedAt && effect.changedBy) {
              applyPermissionModeState(effect.sessionId, {
                permissionMode: effect.permissionMode,
                modeVersion: effect.modeVersion,
                changedAt: effect.changedAt,
                changedBy: effect.changedBy,
              }, 'event')
            } else {
              // Backward compatibility: apply mode optimistically then reconcile authoritative state.
              setSessionOptions(prevOpts => {
                const next = new Map(prevOpts)
                const current = next.get(effect.sessionId) ?? defaultSessionOptions
                next.set(effect.sessionId, { ...current, permissionMode: effect.permissionMode })
                return next
              })
              void reconcilePermissionModeState(effect.sessionId)
            }
            break
          }
          case 'credential_request': {
            enqueueCredential(sessionId, effect.request)
            break
          }
          case 'restore_input': {
            // Queued messages were removed from chat on abort — restore their text to the input field.
            // Append to existing draft (user may have started typing) rather than overwrite.
            const existingText = getDraft(sessionId)
            const restoredText = coerceInputText(effect.text)
            const restored = existingText
              ? `${existingText}\n\n${restoredText}`
              : restoredText
            handleInputChange(sessionId, restored)
            // handleInputChange updates the ref but ChatPage has local state.
            // Dispatch a custom event so ChatPage re-reads the draft.
            window.dispatchEvent(new CustomEvent('craft:restore-input', {
              detail: { sessionId, text: restored },
            }))
            break
          }
          case 'toast_error': {
            toast.error(effect.message, { duration: 5000 })
            break
          }
        }
      }

      // Clear pending permissions and credentials on complete
      if (eventType === 'complete') clearSessionRequests(sessionId)
    }

    const cleanup = window.electronAPI.onSessionEvent((event: SessionEvent) => {
      if (!('sessionId' in event)) return

      const sessionId = event.sessionId
      const workspaceId = windowWorkspaceId ?? ''

      // Session lifecycle events are handled explicitly (not by the agent event processor).
      if (event.type === 'session_created') {
        window.electronAPI.getSessionMessages(sessionId)
          .then((createdSession: Session | null) => {
            if (createdSession) {
              const existingMeta = store.get(sessionMetaMapAtom).has(sessionId)
              if (existingMeta) {
                replaceLoadedSession(createdSession)
              } else {
                addSession(createdSession)
              }
              syncSessionOptionsFromSession(createdSession)
              return
            }
            return window.electronAPI.getSessions().then(initializeSessions)
          })
          .catch((error: unknown) => console.error('Failed to handle session_created event:', error))
        return
      }

      if (event.type === 'session_deleted') {
        removeSession(sessionId)
        return
      }

      const agentEvent = event as unknown as AgentEvent

      // Track activity for stale session watchdog
      trackSessionActivity(sessionId)

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
          // Skip hidden sessions (mini-agent sessions) - they shouldn't trigger notifications
          if (event.type === 'complete' && !updatedSession.hidden) {
            // Get the last assistant/plan message as preview
            const lastMessage = updatedSession.messages.findLast(
              m => (m.role === 'assistant' || m.role === 'plan') && !m.isIntermediate
            )
            // Strip markdown so OS notifications display clean plain text
            const rawPreview = lastMessage?.content?.substring(0, 200) || undefined
            const preview = rawPreview ? stripMarkdown(rawPreview).substring(0, 100) || undefined : undefined
            showSessionNotification(updatedSession, preview)

            // In-app complement to the OS notification: when a *background*
            // session (one not shown in any open panel) finishes, queue a chip
            // above the chat. The OS notification above is suppressed while the
            // window is focused, so the chip is the only completion signal then.
            if (
              store.get(showBackgroundFinishedChipAtom) &&
              !store.get(visibleSessionIdsAtom).has(sessionId)
            ) {
              store.set(pushBackgroundFinishedAtom, {
                sessionId,
                title: getSessionTitle(updatedSession),
                finishedAt: Date.now(),
              })
            }
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
  }, [
    processAgentEvent,
    trackSessionActivity,
    windowWorkspaceId,
    store,
    updateSessionDirect,
    replaceLoadedSession,
    showSessionNotification,
    initializeSessions,
    addSession,
    removeSession,
    syncSessionOptionsFromSession,
    applyPermissionModeState,
    reconcilePermissionModeState,
  ])

  // Transport reconnect recovery — refresh session metadata plus active/processing
  // session content after stale reconnects.
  useEffect(() => {
    const cleanup = window.electronAPI.onReconnected(async (isStale: boolean) => {
      if (!isStale) {
        // Server replayed buffered events — we're caught up, nothing to do
        console.info('[App] Reconnected with event replay — no refresh needed')
        return
      }

      console.warn('[App] Stale reconnect — refreshing session metadata and active/processing sessions')

      const refreshedMetaMap = await refreshSessionListMetadataFromServer({
        removeMissing: false,
        reason: 'stale-reconnect',
        selectedSessionId: sessionSelection.selected,
      })
      const metaMap = refreshedMetaMap ?? store.get(sessionMetaMapAtom)
      const refreshIds = getSessionsToRefreshAfterStaleReconnect(metaMap, sessionSelection.selected)

      console.info(`[App] Stale reconnect — refreshing ${refreshIds.length} session(s):`, refreshIds)

      // Refresh full message content only for the active session plus any
      // session still marked processing after the metadata refresh.
      for (const sessionId of refreshIds) {
        let refreshResult = await refreshSessionFromServer(sessionId)
        if (refreshResult !== 'refreshed') {
          // Server may need time to restart session subprocess after reconnect,
          // or it may still be lazily loading session messages.
          for (const delay of [2000, 4000]) {
            console.warn(`[App] Retrying session refresh for ${sessionId} after ${delay}ms (${refreshResult})`)
            await new Promise(r => setTimeout(r, delay))
            refreshResult = await refreshSessionFromServer(sessionId)
            if (refreshResult === 'refreshed') break
          }
        }
      }

      // Final fallback: if the active session is still empty, force a reload
      // even when the session is already marked loaded.
      if (sessionSelection.selected) {
        const session = store.get(sessionAtomFamily(sessionSelection.selected))
        if (session && (!session.messages || session.messages.length === 0)) {
          console.warn('[App] Active session still has no messages after stale reconnect refresh — forcing message reload')
          await store.set(forceSessionMessagesReloadAtom, sessionSelection.selected)
        } else if (session) {
          console.info(`[App] Stale reconnect recovery complete — active session has ${session.messages?.length ?? 0} messages`)
        }
      }

    })

    return cleanup
  }, [store, sessionSelection.selected, refreshSessionFromServer, refreshSessionListMetadataFromServer])

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

  const {
    archiveSession: handleArchiveSession,
    autoDeleteEmptySession: handleAutoDeleteEmptySession,
    changeSessionStatus: handleSessionStatusChange,
    createSession: handleCreateSession,
    deleteSession: handleDeleteSession,
    flagSession: handleFlagSession,
    markSessionRead: handleMarkSessionRead,
    markSessionUnread: handleMarkSessionUnread,
    renameSession: handleRenameSession,
    setActiveViewingSession: handleSetActiveViewingSession,
    unarchiveSession: handleUnarchiveSession,
    unflagSession: handleUnflagSession,
  } = useAppSessionActions({
    store,
    activeWorkspaceId: windowWorkspaceId,
    addSession,
    removeSession,
    updateSession: updateSessionById,
    syncSessionOptions: syncSessionOptionsFromSession,
  })

  // Deep link navigation is initialized later after handleInputChange is defined

  const handleSendMessage = useCallback(async (sessionId: string, message: string, attachments?: FileAttachment[], skillSlugs?: string[], externalBadges?: ContentBadge[]) => {
    try {
      // Capture pre-send processing state so we can flag mid-stream sends
      // for the queued badge (#616 follow-up — covers Pi steer path which
      // returns status 'accepted', not 'queued').
      const sendingMidStream = store.get(sessionAtomFamily(sessionId))?.isProcessing === true

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

      // Step 3: Extract badges from mentions (sources/skills) with embedded icons
      // Badges are self-contained for display in UserMessageBubble and viewer
      // Merge with any externally provided badges (e.g., from EditPopover context badges)
      // Use workspace slug (not UUID) for skill qualification - SDK expects "workspaceSlug:skillSlug"
      const mentionBadges: ContentBadge[] = windowWorkspaceSlug
        ? extractBadges(message, skills, sources, windowWorkspaceSlug)
        : []
      const badges: ContentBadge[] = [...(externalBadges || []), ...mentionBadges]

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
      // Mark as isPending for optimistic UI — will be confirmed by user_message
      // event. Flag mid-stream sends as queued so the bubble renders with the
      // dashed-draft treatment immediately. Applies to both backends:
      // Pi steers (server emits status: 'accepted' but the renderer preserves
      // isQueued through that update) and Claude queues (server emits 'queued'
      // which confirms it). Cleared by 'processing' status or when the current
      // turn ends.
      const userMessage: Message = {
        id: generateMessageId(),
        role: 'user',
        content: message,
        timestamp: Date.now(),
        attachments: storedAttachments,
        badges: badges.length > 0 ? badges : undefined,
        isPending: true,  // Optimistic - will be confirmed by backend
        isQueued: sendingMidStream,
      }

      // Optimistic UI update - add user message and set processing state
      updateSessionById(sessionId, (s) => ({
        messages: [...s.messages, userMessage],
        isProcessing: true,
        lastMessageAt: Date.now()
      }))

      // Step 6: Send to Claude with processed attachments + stored attachments for persistence
      await window.electronAPI.sendMessage(sessionId, message, processedAttachments, storedAttachments, {
        skillSlugs,
        badges: badges.length > 0 ? badges : undefined,
        optimisticMessageId: userMessage.id,
      })
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
  }, [sessionOptions])

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
    navigate(routes.view.allSessions(session.id))

    // Pre-fill input if provided (after a small delay to ensure component is mounted)
    if (params.input) {
      setTimeout(() => handleInputChange(session.id, params.input!), 100)
    }
  }, [windowWorkspaceId, handleCreateSession, handleInputChange])

  // Centralized link interceptor: classifies file types and decides whether to
  // show an in-app preview overlay or open externally. Replaces the old
  // handleOpenFile/handleOpenUrl that always opened in external apps.
  const linkInterceptor = useLinkInterceptor({
    openFileExternal: async (path) => {
      try {
        await window.electronAPI.openFile(path)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        console.error('Failed to open file:', error)
        toast.error(t('toast.failedToOpenFile'), {
          description: message,
        })
      }
    },
    openUrl: async (url) => {
      try {
        await window.electronAPI.openUrl(url)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        console.error('Failed to open URL:', error)
        // The blocked-URL classifier already explains WHY and (for file:)
        // points the user at preview blocks. Don't append the generic
        // "use Open File instead" hint when the message already carries
        // that guidance.
        const hasRichGuidance = /URL blocked/.test(message)
        const tail = hasRichGuidance ? '' : '. If this is a local path, use Open File instead.'
        toast.error(t('toast.failedToOpenLink'), {
          description: `${message}${tail}`,
        })
      }
    },
    showInFolder: async (path) => {
      try {
        await window.electronAPI.showInFolder(path)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        console.error('Failed to show in folder:', error)
        toast.error(t("toast.failedToReveal", { fileManager: getFileManagerName() }), {
          description: message,
        })
      }
    },
    readFile: (path) => window.electronAPI.readFile(path),
    readFileDataUrl: (path) => window.electronAPI.readFileDataUrl(path),
    readFileBinary: (path) => window.electronAPI.readFileBinary(path),
  })

  const connectionState = useTransportConnectionState()
  const showTransportConnectionBanner = shouldShowTransportConnectionBanner(connectionState)

  const handleReconnectTransport = useCallback(() => {
    void window.electronAPI.reconnectTransport().catch((error) => {
      const message = error instanceof Error ? error.message : 'Unknown error'
      toast.error(t('toast.reconnectFailed'), { description: message })
    })
  }, [])

  const handleOpenFile = linkInterceptor.handleOpenFile
  const handleOpenUrl = linkInterceptor.handleOpenUrl

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
  const resetWorkspaceScopedState = useCallback(() => {
    setSession({ selected: null })
    clearAllRequests()
    setSessionOptions(new Map())
    clearDrafts()
    store.set(sourcesAtom, [])
    store.set(skillsAtom, [])
    store.set(sessionMetaMapAtom, new Map())
    store.set(sessionIdsAtom, [])
  }, [clearDrafts, setSession, store])

  const handleSelectWorkspace = useCallback(async (workspaceId: string, openInNewWindow = false) => {
    await selectWorkspace(workspaceId, {
      openInNewWindow,
      onCurrentWindowSwitch: resetWorkspaceScopedState,
    })
  }, [resetWorkspaceScopedState, selectWorkspace])

  const handleSwitchWorkspaceBySlug = useCallback((slug: string) => {
    selectWorkspaceBySlug(slug, resetWorkspaceScopedState)
  }, [resetWorkspaceScopedState, selectWorkspaceBySlug])

  const handleRefreshWorkspaces = useCallback(() => {
    void refreshWorkspaces()
  }, [refreshWorkspaces])

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
    activeWorkspaceSlug: windowWorkspaceSlug,
    llmConnections,
    workspaceDefaultLlmConnection,
    refreshLlmConnections,
    pendingPermissions,
    pendingCredentials,
    getDraft,
    getDraftAttachmentRefs,
    hydrateDraftAttachments,
    sessionOptions,
    // Session callbacks
    onCreateSession: handleCreateSession,
    onSendMessage: handleSendMessage,
    onRenameSession: handleRenameSession,
    onFlagSession: handleFlagSession,
    onUnflagSession: handleUnflagSession,
    onArchiveSession: handleArchiveSession,
    onUnarchiveSession: handleUnarchiveSession,
    onMarkSessionRead: handleMarkSessionRead,
    onMarkSessionUnread: handleMarkSessionUnread,
    onSetActiveViewingSession: handleSetActiveViewingSession,
    onSessionStatusChange: handleSessionStatusChange,
    onDeleteSession: handleDeleteSession,
    onRespondToPermission: handleRespondToPermission,
    onRespondToCredential: handleRespondToCredential,
    // File/URL handlers
    onOpenFile: handleOpenFile,
    onOpenUrl: handleOpenUrl,
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
    onAttachmentsChange: handleAttachmentsChange,
    // New chat (via deep link navigation)
    openNewChat,
  }), [
    // NOTE: sessions removed to prevent memory leaks - components use atoms instead
    workspaces,
    windowWorkspaceId,
    windowWorkspaceSlug,
    llmConnections,
    workspaceDefaultLlmConnection,
    refreshLlmConnections,
    pendingPermissions,
    pendingCredentials,
    getDraft,
    getDraftAttachmentRefs,
    hydrateDraftAttachments,
    sessionOptions,
    handleCreateSession,
    handleSendMessage,
    handleRenameSession,
    handleFlagSession,
    handleUnflagSession,
    handleArchiveSession,
    handleUnarchiveSession,
    handleMarkSessionRead,
    handleMarkSessionUnread,
    handleSetActiveViewingSession,
    handleSessionStatusChange,
    handleDeleteSession,
    handleRespondToPermission,
    handleRespondToCredential,
    handleOpenFile,
    handleOpenUrl,
    handleSelectWorkspace,
    handleRefreshWorkspaces,
    handleOpenSettings,
    handleOpenKeyboardShortcuts,
    handleOpenStoredUserPreferences,
    handleReset,
    handleSessionOptionsChange,
    handleInputChange,
    handleAttachmentsChange,
    openNewChat,
  ])

  // Platform actions for @archstudio/ui components (overlays, etc.)
  // Memoized to prevent re-renders when these callbacks don't change
  // NOTE: Must be defined before early returns to maintain consistent hook order
  const platformActions = useMemo(() => ({
    onOpenFile: handleOpenFile,
    onOpenUrl: handleOpenUrl,
    // Bypass link interceptor — opens file directly in system editor.
    // Used by overlay header badges (when already viewing a file, "Open" should launch editor).
    onOpenFileExternal: linkInterceptor.openFileExternal,
    // Read file contents as UTF-8 string (used by datatable/spreadsheet/html-preview src fields)
    onReadFile: (path: string) => window.electronAPI.readFile(path),
    // Read file as data URL (used by image-preview blocks)
    onReadFileDataUrl: (path: string) => window.electronAPI.readFileDataUrl(path),
    // Read file as binary Uint8Array (used by PDF preview blocks)
    onReadFileBinary: (path: string) => window.electronAPI.readFileBinary(path),
    // Reveal a file in the system file manager (Finder on macOS, Explorer on Windows, etc.)
    onRevealInFinder: (path: string) => {
      window.electronAPI.showInFolder(path).catch(() => {})
    },
    // Platform-specific file manager name for UI labels
    fileManagerName: getFileManagerName(),
    // Hide/show macOS traffic lights when fullscreen overlays are open
    onSetTrafficLightsVisible: (visible: boolean) => {
      window.electronAPI.setTrafficLightsVisible(visible)
    },
  }), [handleOpenFile, handleOpenUrl, linkInterceptor.openFileExternal])

  // Boot state — the very first paint, before `getSetupNeeds()` resolves and we
  // know whether to show provider setup or the workspace. Deliberately an empty
  // themed surface: no branding, no overlay, nothing to dismiss. It is replaced
  // as soon as the two startup IPC calls settle (single digit ms in practice).
  if (appState === 'loading') {
    return <div className="h-full w-full bg-background" />
  }

  // Reauth state - session expired, need to re-login
  // ModalProvider + WindowCloseHandler ensures X button works on Windows
  if (appState === 'reauth') {
    return (
      <DismissibleLayerProvider>
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
      </DismissibleLayerProvider>
    )
  }

  // Onboarding state
  // ModalProvider + WindowCloseHandler ensures X button works on Windows
  // (without this, the close IPC message has no listener and window stays open)
  if (appState === 'onboarding') {
    return (
      <DismissibleLayerProvider>
        <ModalProvider>
          <WindowCloseHandler />
          <OnboardingWizard
            state={onboarding.state}
            onContinue={onboarding.handleContinue}
            onBack={onboarding.handleBack}
            onSelectProvider={onboarding.handleSelectProvider}
            onSkipSetup={onboarding.handleSkipSetup}
            onSelectApiSetupMethod={onboarding.handleSelectApiSetupMethod}
            onSubmitCredential={onboarding.handleSubmitCredential}
            onSubmitLocalModel={onboarding.handleSubmitLocalModel}
            onStartOAuth={onboarding.handleStartOAuth}
            onFinish={onboarding.handleFinish}
            isWaitingForCode={onboarding.isWaitingForCode}
            onSubmitAuthCode={onboarding.handleSubmitAuthCode}
            onCancelOAuth={onboarding.handleCancelOAuth}
            copilotDeviceCode={onboarding.copilotDeviceCode}
            onBrowseGitBash={onboarding.handleBrowseGitBash}
            onUseGitBashPath={onboarding.handleUseGitBashPath}
            onRecheckGitBash={onboarding.handleRecheckGitBash}
            onClearError={onboarding.handleClearError}
          />
        </ModalProvider>
      </DismissibleLayerProvider>
    )
  }

  // Workspace picker — thin client with no workspace selected
  if (appState === 'workspace-picker') {
    return (
      <DismissibleLayerProvider>
        <ModalProvider>
          <WindowCloseHandler />
          <WorkspacePicker
            onSelectWorkspace={async (id) => {
              await window.electronAPI.switchWorkspace(id)
              setWindowWorkspaceId(id)
              setAppState('ready')
            }}
          />
        </ModalProvider>
      </DismissibleLayerProvider>
    )
  }

  // Ready state — the workspace shell, rendered directly with no interstitial.
  // Data that arrives asynchronously (sessions, connections, drafts) is gated
  // per-consumer; `isSessionsReady` below holds route restoration until the
  // session list has landed.
  return (
    <PlatformProvider actions={platformActions}>
    <ShikiThemeProvider shikiTheme={shikiTheme}>
      <ActionRegistryProvider>
      <FocusProvider>
        <DismissibleLayerProvider>
        <ModalProvider>
        <TooltipProvider delayDuration={0}>
        <NavigationProvider
          workspaceId={windowWorkspaceId}
          workspaceSlug={windowWorkspaceSlug}
          onSwitchWorkspaceBySlug={handleSwitchWorkspaceBySlug}
          onCreateSession={handleCreateSession}
          onInputChange={handleInputChange}
          getDraft={getDraft}
          onAutoDeleteEmptySession={handleAutoDeleteEmptySession}
          isReady={appState === 'ready'}
          isSessionsReady={sessionsLoaded}
          remoteWorkspaceId={windowRemoteWorkspaceId}
        >
          {/* Handle window close requests (X button, Cmd+W) - close modal first if open */}
          <WindowCloseHandler />

          {/* Main UI */}
          <div className="h-full flex flex-col text-foreground">
            {showTransportConnectionBanner && connectionState && (
              <TransportConnectionBanner
                state={connectionState}
                onRetry={handleReconnectTransport}
              />
            )}
            <div className="flex-1 min-h-0">
              {sessionLoadError ? (
                <SessionLoadErrorScreen
                  message={sessionLoadError}
                  onRetry={() => { void loadSessionsFromServer() }}
                />
              ) : (
                <ChatSessionArea
                  contextValue={appShellContextValue}
                  defaultLayout={[20, 32, 48]}
                  menuNewChatTrigger={menuNewChatTrigger}
                  isFocusedMode
                />
              )}
            </div>
            <ResetConfirmationDialog
              open={showResetDialog}
              onConfirm={executeReset}
              onCancel={() => setShowResetDialog(false)}
            />
          </div>

          {/* File preview overlay — rendered by the link interceptor when a previewable file is clicked */}
          {linkInterceptor.previewState && (
            <FilePreviewRenderer
              state={linkInterceptor.previewState}
              onClose={linkInterceptor.closePreview}
              loadDataUrl={linkInterceptor.readFileDataUrl}
              loadPdfData={linkInterceptor.readFileBinary}
              isDark={isDark}
            />
          )}
        </NavigationProvider>
        </TooltipProvider>
        </ModalProvider>
        </DismissibleLayerProvider>
      </FocusProvider>
      </ActionRegistryProvider>
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

/**
 * FilePreviewRenderer - Routes file preview state to the correct overlay component.
 *
 * Handles all preview types from the link interceptor:
 * - image → ImagePreviewOverlay (binary, loaded via data URL)
 * - pdf → PDFPreviewOverlay (binary, embedded via Chromium viewer)
 * - code/text → CodePreviewOverlay (syntax highlighted)
 * - markdown → DocumentFormattedMarkdownOverlay
 * - json → JSONPreviewOverlay
 *
 * File path badges with "Open" / "Reveal in {file manager}" menus are provided
 * automatically by PlatformContext — no per-overlay callback props needed.
 */
function FilePreviewRenderer({
  state,
  onClose,
  loadDataUrl,
  loadPdfData,
  isDark,
}: {
  state: FilePreviewState
  onClose: () => void
  loadDataUrl: (path: string) => Promise<string>
  loadPdfData: (path: string) => Promise<Uint8Array>
  isDark: boolean
}) {
  const theme = isDark ? 'dark' : 'light' as const

  switch (state.type) {
    case 'image':
      return (
        <ImagePreviewOverlay
          isOpen
          onClose={onClose}
          filePath={state.filePath}
          loadDataUrl={loadDataUrl}
          theme={theme}
        />
      )

    case 'pdf':
      return (
        <PDFPreviewOverlay
          isOpen
          onClose={onClose}
          filePath={state.filePath}
          loadPdfData={loadPdfData}
          theme={theme}
        />
      )

    case 'code':
    case 'text':
      return (
        <CodePreviewOverlay
          isOpen
          onClose={onClose}
          filePath={state.filePath}
          content={state.content ?? ''}
          language={state.type === 'code' ? state.language : 'plaintext'}
          mode="read"
          theme={theme}
          error={state.error}
        />
      )

    case 'markdown': {
      // Show PLAN header for .md files in plans folder (handles both absolute and relative paths)
      const isPlanFile =
        (state.filePath.includes('/plans/') || state.filePath.startsWith('plans/')) &&
        state.filePath.endsWith('.md')
      return (
        <DocumentFormattedMarkdownOverlay
          isOpen
          onClose={onClose}
          content={state.content ?? ''}
          filePath={state.filePath}
          variant={isPlanFile ? 'plan' : 'response'}
        />
      )
    }

    case 'json': {
      // JSONPreviewOverlay expects parsed data, not a raw string.
      // @uiw/react-json-view crashes on null value, so guard against it.
      let parsedData: unknown = null
      try {
        if (state.content) parsedData = JSON.parse(state.content)
      } catch {
        // If parsing fails, fall back to showing as code
        return (
          <CodePreviewOverlay
            isOpen
            onClose={onClose}
            filePath={state.filePath}
            content={state.content ?? ''}
            language="json"
            mode="read"
            theme={theme}
            error={state.error}
          />
        )
      }
      // If read failed and content is empty, show raw code overlay with the read error.
      if ((!state.content || !state.content.trim()) && state.error) {
        return (
          <CodePreviewOverlay
            isOpen
            onClose={onClose}
            filePath={state.filePath}
            content={state.content ?? ''}
            language="json"
            mode="read"
            theme={theme}
            error={state.error}
          />
        )
      }
      return (
        <JSONPreviewOverlay
          isOpen
          onClose={onClose}
          filePath={state.filePath}
          title={state.filePath.split('/').pop() ?? 'JSON'}
          data={parsedData}
          theme={theme}
          error={state.error}
        />
      )
    }

    default:
      return null
  }
}
