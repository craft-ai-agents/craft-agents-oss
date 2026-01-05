import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useTheme } from '@/hooks/useTheme'
import type { ThemeOverrides } from '@config/theme'
import { useSetAtom, useStore } from 'jotai'
import type { Session, Workspace, SessionEvent, Message, SubAgentMetadata, FileAttachment, StoredAttachment, PermissionRequest, CredentialRequest, CredentialResponse, SetupNeeds, TodoState } from '../shared/types'
import type { SessionOptions, SessionOptionUpdates } from './hooks/useSessionOptions'
import { defaultSessionOptions, mergeSessionOptions } from './hooks/useSessionOptions'
import { generateMessageId } from '../shared/types'
import { useEventProcessor } from './event-processor'
import type { AgentEvent, Effect } from './event-processor'
import { Chat } from '@/components/chat/Chat'
import type { ChatContextType } from '@/context/ChatContext'
import { OnboardingWizard, ReauthScreen } from '@/components/onboarding'
import { ResetConfirmationDialog } from '@/components/ResetConfirmationDialog'
import { TooltipProvider } from '@/components/ui/tooltip'
import { FocusProvider } from '@/context/FocusContext'
import { useGlobalShortcuts } from '@/hooks/keyboard'
import { useOnboarding } from '@/hooks/useOnboarding'
import { useDeepLinkNavigation } from '@/hooks/useDeepLinkNavigation'
import { useTabs } from '@/tabs'
import { NavigationProvider } from '@/contexts/NavigationContext'
import { navigate, routes } from './lib/navigate'
import { Spinner } from '@/components/ui/loading-indicator'
import { DEFAULT_MODEL } from '@config/models'
import {
  initializeSessionsAtom,
  addSessionAtom,
  removeSessionAtom,
  syncSessionsToAtomsAtom,
  updateSessionAtom,
  sessionAtomFamily,
  backgroundTasksAtomFamily,
} from '@/atoms/sessions'
import { getDefaultStore } from 'jotai'

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
  // 2. User manually kills them
}

export default function App() {
  // App state: loading -> check auth -> onboarding or ready
  const [appState, setAppState] = useState<AppState>('loading')
  const [setupNeeds, setSetupNeeds] = useState<SetupNeeds | null>(null)

  const [sessions, setSessions] = useState<Session[]>([])

  // Per-session Jotai atom setters for isolated updates
  // These update individual session atoms without triggering re-renders in other sessions
  const initializeSessions = useSetAtom(initializeSessionsAtom)
  const addSession = useSetAtom(addSessionAtom)
  const removeSession = useSetAtom(removeSessionAtom)
  const syncSessionsToAtoms = useSetAtom(syncSessionsToAtomsAtom)
  const updateSessionDirect = useSetAtom(updateSessionAtom)
  const store = useStore()

  // Auto-sync React state to per-session atoms
  // This enables components using useSession(id) to get isolated updates
  // while keeping React state as the single source of truth
  useEffect(() => {
    syncSessionsToAtoms(sessions)
  }, [sessions, syncSessionsToAtoms])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [agents, setAgents] = useState<SubAgentMetadata[]>([])
  const [isLoadingAgents, setIsLoadingAgents] = useState(false)
  // Window's workspace ID - fixed for this window (multi-window architecture)
  const [windowWorkspaceId, setWindowWorkspaceId] = useState<string | null>(null)
  const [currentModel, setCurrentModel] = useState(DEFAULT_MODEL)
  const [menuNewChatTrigger, setMenuNewChatTrigger] = useState(0)
  const [menuNewChatTabTrigger, setMenuNewChatTabTrigger] = useState(0)
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

  // Theme state (cascading: app → workspace → agent)
  const [appTheme, setAppTheme] = useState<ThemeOverrides | null>(null)
  const [workspaceTheme, setWorkspaceTheme] = useState<ThemeOverrides | null>(null)
  // Reset confirmation dialog
  const [showResetDialog, setShowResetDialog] = useState(false)

  // Apply theme via hook (injects CSS variables)
  useTheme({ appTheme, workspaceTheme })

  // Ref for sessionOptions to access current value in event handlers without re-registering
  const sessionOptionsRef = useRef(sessionOptions)
  // Keep ref in sync with state
  useEffect(() => {
    sessionOptionsRef.current = sessionOptions
  }, [sessionOptions])

  // Event processor hook - handles all agent events through pure functions
  const { processAgentEvent } = useEventProcessor()

  const DRAFT_SAVE_DEBOUNCE_MS = 500

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

  // Onboarding hook
  const onboarding = useOnboarding({
    onComplete: handleOnboardingComplete,
    initialSetupNeeds: setupNeeds || undefined,
  })

  // Reauth login handler - re-authenticate with Craft when session expired
  const handleReauthLogin = useCallback(async () => {
    const result = await window.electronAPI.startCraftOAuth()
    if (result.success) {
      // Re-check setup needs after successful login
      const needs = await window.electronAPI.getSetupNeeds()
      if (needs.isFullyConfigured) {
        setAppState('ready')
      } else {
        // Still needs more setup (shouldn't happen normally, but handle gracefully)
        setSetupNeeds(needs)
        setAppState('onboarding')
      }
    } else {
      throw new Error(result.error || 'Login failed')
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
          setAppState('ready')
        } else if (needs.needsReauth) {
          // Session expired - show simple re-login screen (preserves conversations)
          setAppState('reauth')
        } else {
          // New user or needs full setup - show full onboarding
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

  // Tab system - only closeChatTabBySession is needed, navigation uses navigate()
  const { closeChatTabBySession } = useTabs()

  // Load workspaces, sessions, model, and drafts when app is ready
  useEffect(() => {
    if (appState !== 'ready') return

    window.electronAPI.getWorkspaces().then(setWorkspaces)
    window.electronAPI.getSessions().then((loadedSessions) => {
      setSessions(loadedSessions)
      // Initialize per-session atoms for isolated streaming updates
      initializeSessions(loadedSessions)
      // Initialize unified sessionOptions from session data
      const optionsMap = new Map<string, SessionOptions>()
      for (const s of loadedSessions) {
        // Only store non-default options to keep the map lean
        const hasNonDefaultMode = s.permissionMode && s.permissionMode !== 'ask'
        if (hasNonDefaultMode) {
          optionsMap.set(s.id, {
            ultrathinkEnabled: false, // ultrathink is single-shot, never persisted
            permissionMode: s.permissionMode ?? 'ask',
          })
        }
      }
      setSessionOptions(optionsMap)
    })
    // Load stored model preference
    window.electronAPI.getModel().then((storedModel) => {
      if (storedModel) {
        setCurrentModel(storedModel)
      }
    })
    // Load persisted input drafts into ref (no re-render needed)
    window.electronAPI.getAllDrafts().then((drafts) => {
      if (Object.keys(drafts).length > 0) {
        sessionDraftsRef.current = new Map(Object.entries(drafts))
      }
    })
    // Load app-level theme
    window.electronAPI.getAppTheme().then(setAppTheme)
  }, [appState])

  // Load agents and workspace theme when window's workspace is set
  useEffect(() => {
    if (windowWorkspaceId) {
      setIsLoadingAgents(true)
      window.electronAPI.getAgents(windowWorkspaceId)
        .then(setAgents)
        .finally(() => setIsLoadingAgents(false))
      // Load workspace-level theme
      window.electronAPI.getWorkspaceTheme(windowWorkspaceId).then(setWorkspaceTheme)
    } else {
      setAgents([])
      setIsLoadingAgents(false)
    }
  }, [windowWorkspaceId])

  // Subscribe to agents changed events (when agents are created/synced/deleted via chat)
  useEffect(() => {
    const cleanup = window.electronAPI.onAgentsChanged(() => {
      if (windowWorkspaceId) {
        console.log('[App] Agents changed, refreshing list')
        window.electronAPI.getAgents(windowWorkspaceId)
          .then(setAgents)
      }
    })
    return cleanup
  }, [windowWorkspaceId])

  // Subscribe to theme change events (live updates when theme.json files change)
  useEffect(() => {
    const cleanupApp = window.electronAPI.onAppThemeChange((theme) => {
      console.log('[App] App theme changed')
      setAppTheme(theme)
    })
    const cleanupWorkspace = window.electronAPI.onWorkspaceThemeChange((theme) => {
      console.log('[App] Workspace theme changed')
      setWorkspaceTheme(theme)
    })
    // Note: Agent theme changes are not yet wired up (would need active agent tracking)
    return () => {
      cleanupApp()
      cleanupWorkspace()
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
    const handoffEventTypes = new Set(['complete', 'error', 'interrupted', 'typed_error', 'todo_state_changed'])

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
          case 'ask_question_request': {
            console.log('[App] ask_question_request:', effect.sessionId, effect.request)
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

        // For handoff events, also sync to React state
        // This reconciles React state with all the streaming updates
        if (isHandoff) {
          setSessions(prev => {
            const exists = prev.some(s => s.id === sessionId)
            if (!exists) {
              return [...prev, updatedSession]
            }
            return prev.map(s => s.id === sessionId ? updatedSession : s)
          })
        }

        return
      }

      // Not streaming: React state is source of truth (syncs to atoms via useEffect)
      setSessions(prev => {
        const currentSession = prev.find(s => s.id === sessionId) ?? null

        const { session: updatedSession, effects } = processAgentEvent(
          agentEvent,
          currentSession,
          workspaceId
        )

        // Handle side effects
        handleEffects(effects, sessionId, event.type)

        // Handle background task events
        handleBackgroundTaskEvent(store, sessionId, event, agentEvent)

        // If session didn't exist before, add it
        if (!currentSession) {
          return [...prev, updatedSession]
        }

        // Update existing session
        return prev.map(s => s.id === sessionId ? updatedSession : s)
      })
    })

    return cleanup
  }, [processAgentEvent, windowWorkspaceId, store, updateSessionDirect])

  // Listen for menu bar events
  useEffect(() => {
    const unsubNewChat = window.electronAPI.onMenuNewChat(() => {
      setMenuNewChatTrigger(n => n + 1)
    })
    const unsubNewChatTab = window.electronAPI.onMenuNewChatTab(() => {
      setMenuNewChatTabTrigger(n => n + 1)
    })
    const unsubSettings = window.electronAPI.onMenuOpenSettings(() => {
      handleOpenSettings()
    })
    const unsubShortcuts = window.electronAPI.onMenuKeyboardShortcuts(() => {
      navigate(routes.tab.shortcuts())
    })
    const unsubHelp = window.electronAPI.onMenuOpenHelp(() => {
      // Open help documentation URL
      window.electronAPI.openUrl('https://craft.do/help')
    })

    return () => {
      unsubNewChat()
      unsubNewChatTab()
      unsubSettings()
      unsubShortcuts()
      unsubHelp()
    }
  }, [])

  const handleCreateSession = useCallback(async (workspaceId: string, agentId?: string): Promise<Session> => {
    // Find agent if provided - prefer displayName for human-readable title
    const agent = agentId ? agents.find(a => a.id === agentId) : undefined
    const agentName = agent?.displayName || agent?.name
    // Pass agentName to main process so it's stored in the session
    const session = await window.electronAPI.createSession(workspaceId, agentId, agentName)
    setSessions(prev => [session, ...prev])
    // Also update per-session atom for isolated updates
    addSession(session)

    // Apply session defaults to the unified sessionOptions
    const hasNonDefaultMode = session.permissionMode && session.permissionMode !== 'ask'
    if (hasNonDefaultMode) {
      setSessionOptions(prev => {
        const next = new Map(prev)
        next.set(session.id, {
          ultrathinkEnabled: false,
          permissionMode: session.permissionMode ?? 'ask',
        })
        return next
      })
    }

    return session
  }, [agents, addSession])

  // Deep link navigation is initialized later after handleInputChange is defined

  const handleDeleteSession = useCallback(async (sessionId: string, skipConfirmation = false): Promise<boolean> => {
    // Show confirmation dialog before deleting (unless skipped or session is empty)
    if (!skipConfirmation) {
      // Check if session has any messages - skip confirmation for empty sessions
      const session = sessions.find(s => s.id === sessionId)
      const isEmpty = !session || session.messages.length === 0

      if (!isEmpty) {
        const confirmed = await window.electronAPI.showDeleteSessionConfirmation(session.name || 'Untitled')
        if (!confirmed) return false
      }
    }

    // Close the tab first to prevent race conditions where the tab
    // tries to render while the session is being deleted
    closeChatTabBySession(sessionId)
    await window.electronAPI.deleteSession(sessionId)
    setSessions(prev => prev.filter(s => s.id !== sessionId))
    // Also remove from per-session atom
    removeSession(sessionId)
    return true
  }, [closeChatTabBySession, sessions, removeSession])

  const handleFlagSession = useCallback(async (sessionId: string) => {
    await window.electronAPI.flagSession(sessionId)
    setSessions(prev => prev.map(s =>
      s.id === sessionId ? { ...s, isFlagged: true } : s
    ))
  }, [])

  const handleUnflagSession = useCallback(async (sessionId: string) => {
    await window.electronAPI.unflagSession(sessionId)
    setSessions(prev => prev.map(s =>
      s.id === sessionId ? { ...s, isFlagged: false } : s
    ))
  }, [])

  const handleMarkSessionRead = useCallback(async (sessionId: string) => {
    await window.electronAPI.markSessionRead(sessionId)
    // Find the session and compute the last final assistant message ID
    setSessions(prev => prev.map(s => {
      if (s.id !== sessionId) return s
      const lastFinalId = s.messages.findLast(
        m => m.role === 'assistant' && !m.isIntermediate
      )?.id
      return lastFinalId ? { ...s, lastReadMessageId: lastFinalId } : s
    }))
  }, [])

  const handleMarkSessionUnread = useCallback(async (sessionId: string) => {
    await window.electronAPI.markSessionUnread(sessionId)
    setSessions(prev => prev.map(s =>
      s.id === sessionId ? { ...s, lastReadMessageId: undefined } : s
    ))
  }, [])

  const handleTodoStateChange = useCallback(async (sessionId: string, state: TodoState) => {
    await window.electronAPI.setTodoState(sessionId, state)
    setSessions(prev => prev.map(s =>
      s.id === sessionId ? { ...s, todoState: state } : s
    ))
  }, [])

  const handleRenameSession = useCallback(async (sessionId: string, name: string) => {
    await window.electronAPI.renameSession(sessionId, name)
    // Update state immediately (don't rely on event timing)
    setSessions(prev => prev.map(s =>
      s.id === sessionId ? { ...s, name } : s
    ))
  }, [])

  const handleSendMessage = useCallback(async (sessionId: string, message: string, attachments?: FileAttachment[]) => {
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
          setSessions(prev => prev.map(s =>
            s.id === sessionId
              ? {
                  ...s,
                  messages: [...s.messages, {
                    id: generateMessageId(),
                    role: 'warning' as const,
                    content: `⚠️ ${failedCount} attachment(s) could not be stored and will not be sent: ${failedNames}`,
                    timestamp: Date.now()
                  }]
                }
              : s
          ))
        }

        // Step 2: Create processed attachments for Claude
        // - Office files: Convert to text with markdown content
        // - Others: Use original FileAttachment
        // - All: Include storedPath so agent knows where files are stored
        processedAttachments = await Promise.all(
          successfulAttachments.map(async (att, i) => {
            const stored = storedAttachments?.[i]
            if (!stored) {
              console.error(`Missing stored attachment at index ${i}`)
              return att // Fall back to original
            }
            // Include storedPath and markdownPath for all attachment types
            // Agent will use Read tool to access text/office files via these paths
            return {
              ...att,
              storedPath: stored.storedPath,
              markdownPath: stored.markdownPath,
            }
          })
        )
      }

      // Step 3: Check if ultrathink is enabled for this session
      const isUltrathink = sessionOptions.get(sessionId)?.ultrathinkEnabled ?? false

      // Step 4: Create user message with StoredAttachments (for UI display)
      // Mark as isPending for optimistic UI - will be confirmed by user_message event
      const userMessage: Message = {
        id: generateMessageId(),
        role: 'user',
        content: message,
        timestamp: Date.now(),
        attachments: storedAttachments,
        ultrathink: isUltrathink || undefined,  // Only set if true
        isPending: true,  // Optimistic - will be confirmed by backend
      }

      setSessions(prev => prev.map(s =>
        s.id === sessionId
          ? { ...s, messages: [...s.messages, userMessage], isProcessing: true, lastMessageAt: Date.now() }
          : s
      ))

      // Step 5: Send to Claude with processed attachments + stored attachments for persistence
      await window.electronAPI.sendMessage(sessionId, message, processedAttachments, storedAttachments, {
        ultrathinkEnabled: isUltrathink,
      })

      // Auto-disable ultrathink after sending (single-shot activation)
      if (isUltrathink) {
        handleSessionOptionsChange(sessionId, { ultrathinkEnabled: false })
      }
    } catch (error) {
      console.error('Failed to send message:', error)
      setSessions(prev => prev.map(s =>
        s.id === sessionId
          ? {
              ...s,
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
            }
          : s
      ))
    }
  }, [sessionOptions])

  const handleRefreshAgents = useCallback(async () => {
    if (windowWorkspaceId) {
      setIsLoadingAgents(true)
      try {
        // Reload local agents
        const refreshedAgents = await window.electronAPI.refreshAgents(windowWorkspaceId)
        setAgents(refreshedAgents)
      } finally {
        setIsLoadingAgents(false)
      }
    }
  }, [windowWorkspaceId])

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
      window.electronAPI.setPermissionMode(sessionId, updates.permissionMode)
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

  // Deep link navigation - handles craftagents:// URLs
  // Must be after handleCreateSession and handleInputChange are defined
  const { openNewChat } = useDeepLinkNavigation({
    workspaceId: windowWorkspaceId,
    onCreateSession: handleCreateSession,
    onInputChange: handleInputChange,
    isReady: appState === 'ready',
  })

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
      // Force sessions state refresh to ensure React processes any pending tool_result updates
      console.log('[App] handleRespondToPermission: forcing sessions state refresh')
      setSessions(prev => [...prev])
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
      // Force sessions state refresh to ensure React processes any pending updates
      console.log('[App] handleRespondToCredential: forcing sessions state refresh')
      setSessions(prev => [...prev])
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
    navigate(routes.tab.settings())
  }, [])

  const handleOpenKeyboardShortcuts = useCallback(() => {
    navigate(routes.tab.shortcuts())
  }, [])

  const handleOpenStoredUserPreferences = useCallback(() => {
    navigate(routes.tab.preferences())
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
      setSessions([])
      setWorkspaces([])
      setAgents([])
      setWindowWorkspaceId(null)
      // Reset setupNeeds to force fresh onboarding start
      setSetupNeeds({
        needsCraftAuth: true,
        needsReauth: false,
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
  }, [onboarding])

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

      // 3. Clear pending permissions/credentials (not relevant to new workspace)
      setPendingPermissions(new Map())
      setPendingCredentials(new Map())

      // Note: Agents and theme will reload automatically due to windowWorkspaceId dependency
      // in useEffect hooks
    }
  }, [windowWorkspaceId])

  // Handle workspace refresh (e.g., after icon upload)
  const handleRefreshWorkspaces = useCallback(() => {
    window.electronAPI.getWorkspaces().then(setWorkspaces)
  }, [])

  // Handle cancel during onboarding
  const handleOnboardingCancel = useCallback(() => {
    onboarding.handleCancel()
  }, [onboarding])

  // Build context value for Chat component
  // This is memoized to prevent unnecessary re-renders
  // IMPORTANT: Must be before early returns to maintain consistent hook order
  const chatContextValue = useMemo<ChatContextType>(() => ({
    // Data
    sessions,
    workspaces,
    agents,
    isLoadingAgents,
    activeWorkspaceId: windowWorkspaceId,
    currentModel,
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
    onTodoStateChange: handleTodoStateChange,
    onDeleteSession: handleDeleteSession,
    onRespondToPermission: handleRespondToPermission,
    onRespondToCredential: handleRespondToCredential,
    // File/URL handlers
    onOpenFile: handleOpenFile,
    onOpenUrl: handleOpenUrl,
    // Model
    onModelChange: handleModelChange,
    // Workspace
    onSelectWorkspace: handleSelectWorkspace,
    onRefreshWorkspaces: handleRefreshWorkspaces,
    // App actions
    onOpenSettings: handleOpenSettings,
    onOpenKeyboardShortcuts: handleOpenKeyboardShortcuts,
    onOpenStoredUserPreferences: handleOpenStoredUserPreferences,
    onRefreshAgents: handleRefreshAgents,
    onReset: handleReset,
    // Session options
    onSessionOptionsChange: handleSessionOptionsChange,
    onInputChange: handleInputChange,
    // New chat (via deep link navigation)
    openNewChat,
  }), [
    sessions,
    workspaces,
    agents,
    isLoadingAgents,
    windowWorkspaceId,
    currentModel,
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
    handleTodoStateChange,
    handleDeleteSession,
    handleRespondToPermission,
    handleRespondToCredential,
    handleOpenFile,
    handleOpenUrl,
    handleModelChange,
    handleSelectWorkspace,
    handleRefreshWorkspaces,
    handleOpenSettings,
    handleOpenKeyboardShortcuts,
    handleOpenStoredUserPreferences,
    handleRefreshAgents,
    handleReset,
    handleSessionOptionsChange,
    handleInputChange,
    openNewChat,
  ])

  // Loading state
  if (appState === 'loading') {
    return (
      <div className="h-full flex items-center justify-center bg-background text-foreground">
        <div className="flex flex-col items-center gap-4">
          <Spinner className="text-2xl text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  // Reauth state - session expired, need to re-login
  if (appState === 'reauth') {
    return (
      <>
        <ReauthScreen
          onLogin={handleReauthLogin}
          onReset={handleReauthReset}
        />
        <ResetConfirmationDialog
          open={showResetDialog}
          onConfirm={executeReset}
          onCancel={() => setShowResetDialog(false)}
        />
      </>
    )
  }

  // Onboarding state
  if (appState === 'onboarding') {
    return (
      <OnboardingWizard
        state={onboarding.state}
        onCancel={handleOnboardingCancel}
        onContinue={onboarding.handleContinue}
        onBack={onboarding.handleBack}
        onLogin={onboarding.handleLogin}
        onOpenLoginManually={onboarding.handleOpenLoginManually}
        onRetryLogin={onboarding.handleRetryLogin}
        onSelectBillingMethod={onboarding.handleSelectBillingMethod}
        onSubmitCredential={onboarding.handleSubmitCredential}
        onStartOAuth={onboarding.handleStartOAuth}
        onFinish={onboarding.handleFinish}
        existingClaudeToken={onboarding.existingClaudeToken}
        isClaudeCliInstalled={onboarding.isClaudeCliInstalled}
        onUseExistingClaudeToken={onboarding.handleUseExistingClaudeToken}
      />
    )
  }

  // Ready state - main app
  return (
    <FocusProvider>
      <TooltipProvider>
        <NavigationProvider
          workspaceId={windowWorkspaceId}
          onCreateSession={handleCreateSession}
          onInputChange={handleInputChange}
          isReady={appState === 'ready'}
        >
          <div className="h-full text-foreground">
            <Chat
              contextValue={chatContextValue}
              defaultLayout={[20, 32, 48]}
              menuNewChatTrigger={menuNewChatTrigger}
              menuNewChatTabTrigger={menuNewChatTabTrigger}
            />
            <ResetConfirmationDialog
              open={showResetDialog}
              onConfirm={executeReset}
              onCancel={() => setShowResetDialog(false)}
            />
          </div>
        </NavigationProvider>
      </TooltipProvider>
    </FocusProvider>
  )
}
