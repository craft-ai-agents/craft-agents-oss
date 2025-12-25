import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { Session, Workspace, SessionEvent, Message, SubAgentMetadata, FileAttachment, StoredAttachment, PermissionRequest, SetupNeeds, TodoState, Mode } from '../shared/types'
import type { SessionOptions, SessionOptionUpdates } from './hooks/useSessionOptions'
import { defaultSessionOptions, mergeSessionOptions } from './hooks/useSessionOptions'
import { getToolDisplayName } from '@craft-agent/shared/utils/toolNames'
import { generateMessageId } from '../shared/types'
import { Chat } from '@/components/chat/Chat'
import type { ChatContextType } from '@/context/ChatContext'
import { OnboardingWizard, ReauthScreen } from '@/components/onboarding'
import { AddWorkspaceFlow } from '@/components/AddWorkspaceFlow'
import { TooltipProvider } from '@/components/ui/tooltip'
import { FocusProvider } from '@/context/FocusContext'
import { useGlobalShortcuts } from '@/hooks/keyboard'
import { useOnboarding } from '@/hooks/useOnboarding'
import { useDeepLinkNavigation } from '@/hooks/useDeepLinkNavigation'
import { useTabs } from '@/tabs'
import { Spinner } from '@/components/ui/loading-indicator'
import { DEFAULT_MODEL } from '@config/models'

type AppState = 'loading' | 'onboarding' | 'reauth' | 'ready' | 'adding-workspace'

export default function App() {
  // App state: loading -> check auth -> onboarding or ready
  const [appState, setAppState] = useState<AppState>('loading')
  const [setupNeeds, setSetupNeeds] = useState<SetupNeeds | null>(null)

  const [sessions, setSessions] = useState<Session[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [agents, setAgents] = useState<SubAgentMetadata[]>([])
  const [isLoadingAgents, setIsLoadingAgents] = useState(false)
  // Window's workspace ID - fixed for this window (multi-window architecture)
  const [windowWorkspaceId, setWindowWorkspaceId] = useState<string | null>(null)
  // Window mode - 'add-workspace' opens the wizard in a new window
  const [windowMode, setWindowMode] = useState<string | null>(null)
  const [currentModel, setCurrentModel] = useState(DEFAULT_MODEL)
  const [menuNewChatTrigger, setMenuNewChatTrigger] = useState(0)
  const [menuNewChatTabTrigger, setMenuNewChatTabTrigger] = useState(0)
  // Permission requests per session (queue to handle multiple concurrent requests)
  const [pendingPermissions, setPendingPermissions] = useState<Map<string, PermissionRequest[]>>(new Map())
  // Draft input text per session (preserved across mode switches and conversation changes)
  const [sessionDrafts, setSessionDrafts] = useState<Map<string, string>>(new Map())
  // Unified session options - replaces ultrathinkSessions, skipPermissionsSessions, sessionModes
  // All session-scoped options in one place (ultrathink, skipPermissions, activeModes, etc.)
  const [sessionOptions, setSessionOptions] = useState<Map<string, SessionOptions>>(new Map())

  // Queue for tool_result events that arrive before their tool_start (out-of-order handling)
  // Using ref to avoid stale closure issues in the useEffect event handler
  const orphanedToolResultsRef = useRef<Map<string, { result: string; toolName: string; turnId?: string; parentToolUseId?: string; isError?: boolean }>>(new Map())
  // Ref for sessionOptions to access current value in event handlers without re-registering
  const sessionOptionsRef = useRef(sessionOptions)
  // Keep ref in sync with state
  useEffect(() => {
    sessionOptionsRef.current = sessionOptions
  }, [sessionOptions])

  // Performance: Throttle streaming text state updates to reduce React re-renders
  // Accumulates deltas in ref, flushes to state every 200ms (or immediately on complete)
  const STREAMING_THROTTLE_MS = 200
  const DRAFT_SAVE_DEBOUNCE_MS = 500
  const streamingTextRef = useRef<Map<string, { content: string; turnId?: string; timer?: ReturnType<typeof setTimeout> }>>(new Map())

  // Helper to flush accumulated streaming text to React state
  const flushStreamingText = useCallback((sessionId: string, createNew: boolean = false) => {
    const streaming = streamingTextRef.current.get(sessionId)
    if (!streaming) return

    // Clear timer first, then atomically read and clear content
    // This prevents race conditions where new deltas arrive mid-flush
    if (streaming.timer) {
      clearTimeout(streaming.timer)
      streaming.timer = undefined
    }

    // Atomically grab and clear content (new deltas will start fresh accumulation)
    const content = streaming.content
    const turnId = streaming.turnId
    streaming.content = ''

    // If no content accumulated, nothing to flush
    if (!content) {
      streamingTextRef.current.delete(sessionId)
      return
    }

    // Update React state with accumulated content
    setSessions(prev => prev.map(session => {
      if (session.id !== sessionId) return session

      const lastMsg = session.messages[session.messages.length - 1]

      // Append to existing streaming message
      if (lastMsg?.role === 'assistant' && lastMsg.isStreaming &&
          (!turnId || lastMsg.turnId === turnId)) {
        return {
          ...session,
          messages: [
            ...session.messages.slice(0, -1),
            { ...lastMsg, content: lastMsg.content + content }
          ]
        }
      }

      // Create new streaming message if needed
      if (createNew) {
        return {
          ...session,
          messages: [
            ...session.messages,
            {
              id: generateMessageId(),
              role: 'assistant' as const,
              content,
              timestamp: Date.now(),
              isStreaming: true,
              isPending: true,
              turnId
            }
          ]
        }
      }

      return session
    }))
  }, [])

  // Handle onboarding completion
  const handleOnboardingComplete = useCallback(() => {
    // Reload workspaces after onboarding
    window.electronAPI.getWorkspaces().then((ws) => {
      if (ws.length > 0) {
        // Open new workspace window, then close this (stale) window
        window.electronAPI.openWorkspace(ws[0].id)
        window.electronAPI.closeWindow()
        return
      }
      // Fallback: no workspaces (shouldn't happen after onboarding)
      setWorkspaces(ws)
      setAppState('ready')
    })
  }, [])

  // Onboarding hook
  const onboarding = useOnboarding({
    onComplete: handleOnboardingComplete,
    initialSetupNeeds: setupNeeds || undefined,
  })

  // Add workspace completion handler
  const handleAddWorkspaceComplete = useCallback(() => {
    // Reload workspaces after adding
    window.electronAPI.getWorkspaces().then((ws) => {
      if (ws.length > 0) {
        // Get the newly added workspace (last one in list)
        const newWorkspace = ws[ws.length - 1]
        // Open new workspace window, then close this (add-workspace) window
        window.electronAPI.openWorkspace(newWorkspace.id)
        window.electronAPI.closeWindow()
      }
    })
  }, [])

  // Add workspace cancel handler
  const handleAddWorkspaceCancel = useCallback(() => {
    // If this was an add-workspace window, close it
    if (windowMode === 'add-workspace') {
      window.electronAPI.closeWindow()
    } else {
      // Fallback for in-app flow (shouldn't happen anymore)
      setAppState('ready')
    }
  }, [windowMode])

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

  // Reauth logout handler - clear everything and start fresh
  const handleReauthLogout = useCallback(async () => {
    const confirmed = await window.electronAPI.showLogoutConfirmation()
    if (confirmed) {
      await window.electronAPI.logout()
      // Reset to full onboarding
      setSetupNeeds(null)
      setAppState('onboarding')
    }
  }, [])

  // Check auth state and get window's workspace ID on mount
  useEffect(() => {
    const initialize = async () => {
      try {
        // Get this window's workspace ID (passed via URL query param from main process)
        const wsId = await window.electronAPI.getWindowWorkspace()
        setWindowWorkspaceId(wsId)

        // Get window mode (e.g., 'add-workspace' for wizard window)
        const mode = await window.electronAPI.getWindowMode()
        setWindowMode(mode)

        // If this is an add-workspace window, show the wizard directly
        if (mode === 'add-workspace') {
          // Load workspaces for duplicate name validation
          const ws = await window.electronAPI.getWorkspaces()
          setWorkspaces(ws)
          setAppState('adding-workspace')
          return
        }

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

  // Tab system
  const { openSettingsTab, openShortcutsTab, openPreferencesTab, closeChatTabBySession } = useTabs()

  // Global shortcut: Cmd+/ to show keyboard shortcuts
  useGlobalShortcuts({
    shortcuts: [
      {
        key: '/',
        cmd: true,
        action: openShortcutsTab,
      },
    ],
  })

  // Load workspaces, sessions, model, and drafts when app is ready
  useEffect(() => {
    if (appState !== 'ready') return

    window.electronAPI.getWorkspaces().then(setWorkspaces)
    window.electronAPI.getSessions().then((loadedSessions) => {
      setSessions(loadedSessions)
      // Initialize unified sessionOptions from session data
      const optionsMap = new Map<string, SessionOptions>()
      for (const s of loadedSessions) {
        // Only store non-default options to keep the map lean
        const hasOptions = s.skipPermissions || (s.activeModes && s.activeModes.length > 0)
        if (hasOptions) {
          optionsMap.set(s.id, {
            ultrathinkEnabled: false, // ultrathink is single-shot, never persisted
            skipPermissions: s.skipPermissions ?? false,
            activeModes: s.activeModes ?? [],
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
    // Load persisted input drafts
    window.electronAPI.getAllDrafts().then((drafts) => {
      if (Object.keys(drafts).length > 0) {
        setSessionDrafts(new Map(Object.entries(drafts)))
      }
    })
  }, [appState])

  // Load agents when window's workspace is set
  useEffect(() => {
    if (windowWorkspaceId) {
      setIsLoadingAgents(true)
      window.electronAPI.getAgents(windowWorkspaceId)
        .then(setAgents)
        .finally(() => setIsLoadingAgents(false))
    } else {
      setAgents([])
      setIsLoadingAgents(false)
    }
  }, [windowWorkspaceId])

  // Listen for session events
  useEffect(() => {
    const cleanup = window.electronAPI.onSessionEvent((event: SessionEvent) => {
      // Handle permission requests separately (outside session state)
      // Use a queue to handle multiple concurrent permission requests
      if (event.type === 'permission_request') {
        console.log('[App] permission_request received:', {
          sessionId: event.sessionId,
          requestId: event.request.requestId,
          toolName: event.request.toolName,
        })

        // Auto-approve if skipPermissions is enabled for this session
        if (sessionOptionsRef.current.get(event.sessionId)?.skipPermissions) {
          console.log('[App] permission_request: auto-approving (skipPermissions enabled)')
          window.electronAPI.respondToPermission(event.sessionId, event.request.requestId, true, false)
          return
        }
        setPendingPermissions(prev => {
          const next = new Map(prev)
          const existingQueue = next.get(event.sessionId) || []
          console.log('[App] permission_request: queuing, current queue size:', existingQueue.length)
          next.set(event.sessionId, [...existingQueue, event.request])
          return next
        })
        return
      }

      // Handle mode change events (generic for any mode type)
      if (event.type === 'mode_changed') {
        console.log('[App] mode_changed:', event.sessionId, event.mode, event.enabled)
        setSessionOptions(prev => {
          const next = new Map(prev)
          const current = next.get(event.sessionId) ?? defaultSessionOptions
          const currentModes = current.activeModes
          let newModes: Mode[]
          if (event.enabled) {
            newModes = currentModes.includes(event.mode) ? currentModes : [...currentModes, event.mode]
          } else {
            newModes = currentModes.filter(m => m !== event.mode)
          }
          next.set(event.sessionId, { ...current, activeModes: newModes })
          return next
        })
        return
      }

      // Handle plan submitted event - add plan message to session
      if (event.type === 'plan_submitted') {
        console.log('[App] plan_submitted:', event.sessionId)
        setSessions(prev => prev.map(session => {
          if (session.id !== event.sessionId) return session
          return {
            ...session,
            messages: [...session.messages, event.message],
          }
        }))
        return
      }

      // Handle complete event - clear any pending requests for the session
      if (event.type === 'complete') {
        setPendingPermissions(prev => {
          if (prev.has(event.sessionId)) {
            const next = new Map(prev)
            next.delete(event.sessionId)
            return next
          }
          return prev
        })
      }

      // Handle session_restarted event - update session's selectedConnectionIds and clear messages
      if (event.type === 'session_restarted') {
        console.log('[App] session_restarted:', event.sessionId, event.selectedConnectionIds)
        setSessions(prev => prev.map(session => {
          if (session.id !== event.sessionId) return session
          return {
            ...session,
            messages: [],
            selectedConnectionIds: event.selectedConnectionIds,
            isProcessing: false,
          }
        }))
        return
      }

      // Performance: Handle text_delta with throttled updates
      // Accumulates deltas in ref, only triggers React state update every 100ms
      if (event.type === 'text_delta') {
        const sessionId = event.sessionId
        const existing = streamingTextRef.current.get(sessionId)

        if (existing) {
          // Append to existing accumulated content
          existing.content += event.delta
          if (event.turnId) existing.turnId = event.turnId
          // Schedule timer if not already scheduled (might have been cleared by flush)
          if (!existing.timer) {
            existing.timer = setTimeout(() => flushStreamingText(sessionId, false), STREAMING_THROTTLE_MS)
          }
        } else {
          // First delta for this session - need to check if we should create new message
          // Check current state to see if there's an existing streaming message
          setSessions(prev => {
            const session = prev.find(s => s.id === sessionId)
            if (!session) return prev

            const lastMsg = session.messages[session.messages.length - 1]
            const hasExistingStreaming = lastMsg?.role === 'assistant' && lastMsg.isStreaming &&
              (!event.turnId || lastMsg.turnId === event.turnId)

            if (hasExistingStreaming) {
              // Will append to existing message on flush
              streamingTextRef.current.set(sessionId, {
                content: event.delta,
                turnId: event.turnId,
                timer: setTimeout(() => flushStreamingText(sessionId, false), STREAMING_THROTTLE_MS)
              })
              return prev // Don't update state yet
            } else {
              // Need to create new streaming message immediately (first delta of a turn)
              streamingTextRef.current.set(sessionId, {
                content: '',
                turnId: event.turnId,
                timer: setTimeout(() => flushStreamingText(sessionId, false), STREAMING_THROTTLE_MS)
              })
              return prev.map(s => {
                if (s.id !== sessionId) return s
                return {
                  ...s,
                  messages: [
                    ...s.messages,
                    {
                      id: generateMessageId(),
                      role: 'assistant' as const,
                      content: event.delta,
                      timestamp: Date.now(),
                      isStreaming: true,
                      isPending: true,
                      turnId: event.turnId
                    }
                  ]
                }
              })
            }
          })
        }
        return // Don't process through normal setSessions below
      }

      // Handle text_complete - flush pending deltas AND update message state in ONE atomic operation
      // This prevents race conditions where separate setSessions calls could leave the message
      // in a partially-updated state (content flushed but isStreaming still true)
      if (event.type === 'text_complete') {
        const streaming = streamingTextRef.current.get(event.sessionId)

        // Clear timer and discard any pending content (event.text has the complete final text)
        if (streaming) {
          if (streaming.timer) {
            clearTimeout(streaming.timer)
            streaming.timer = undefined
          }
          // Full cleanup - streaming for this session is done
          streamingTextRef.current.delete(event.sessionId)
        }

        // Single atomic state update: flush pending content AND mark complete
        setSessions(prev => prev.map(session => {
          if (session.id !== event.sessionId) return session

          const msgs = session.messages
          // Find assistant message by turnId (not by position, since tools may be inserted after)
          const assistantIndex = event.turnId
            ? msgs.findIndex(m => m.role === 'assistant' && m.turnId === event.turnId)
            : msgs.findLastIndex(m => m.role === 'assistant' && m.isStreaming)

          if (assistantIndex !== -1) {
            const assistantMsg = msgs[assistantIndex]
            // event.text contains the complete final text from the SDK
            return {
              ...session,
              // Note: Do NOT set isProcessing here - only 'complete' event signals the agent loop is done.
              // Setting it false here causes a brief "idle" flash before the next tool_start.
              messages: [
                ...msgs.slice(0, assistantIndex),
                {
                  ...assistantMsg,
                  content: event.text,
                  isStreaming: false,
                  isPending: false,
                  isIntermediate: event.isIntermediate,
                  turnId: event.turnId,
                  // For intermediate messages, parentToolUseId enables nesting under parent tool
                  parentToolUseId: event.parentToolUseId,
                },
                ...msgs.slice(assistantIndex + 1)
              ]
            }
          }
          return session
        }))
        return // Don't fall through to the switch below
      }

      setSessions(prev => prev.map(session => {
          if (session.id !== event.sessionId) return session

          switch (event.type) {
            // Note: text_delta is handled above with throttling for performance
            // It accumulates deltas in a ref and flushes every 100ms
            // Note: text_complete is also handled above with atomic flush + state update

            case 'tool_start': {
              console.log('[App] tool_start received:', {
                sessionId: session.id,
                toolUseId: event.toolUseId,
                toolName: event.toolName,
              })

              // Check if a message with this toolUseId already exists
              // SDK sends two events per tool: first from stream_event (empty input),
              // second from assistant message (complete input)
              const existingIndex = session.messages.findIndex(m => m.toolUseId === event.toolUseId)
              if (existingIndex !== -1) {
                // Update existing message with complete input (second event has full input)
                return {
                  ...session,
                  // isProcessing already true from user message send, stays true until 'complete'
                  messages: session.messages.map((m, i) =>
                    i === existingIndex
                      ? {
                          ...m,
                          toolInput: event.toolInput,
                          toolIntent: event.toolIntent || m.toolIntent,
                          toolDisplayName: event.toolDisplayName || m.toolDisplayName,
                          parentToolUseId: event.parentToolUseId || m.parentToolUseId,
                        }
                      : m
                  )
                }
              }

              // Check if we have a queued result for this tool (out-of-order case)
              // This handles tool_result arriving before tool_start
              const queuedResult = orphanedToolResultsRef.current.get(event.toolUseId)
              if (queuedResult) {
                orphanedToolResultsRef.current.delete(event.toolUseId)

                // Create message AND apply result in one update
                return {
                  ...session,
                  // isProcessing already true from user message send, stays true until 'complete'
                  messages: [
                    ...session.messages,
                    {
                      id: generateMessageId(),
                      role: 'tool' as const,
                      content: queuedResult.result,
                      timestamp: Date.now(),
                      toolName: event.toolName,
                      toolUseId: event.toolUseId,
                      toolInput: event.toolInput,
                      toolResult: queuedResult.result,
                      toolStatus: 'completed',  // Already complete!
                      toolIntent: event.toolIntent,
                      toolDisplayName: event.toolDisplayName,
                      turnId: event.turnId,
                      parentToolUseId: event.parentToolUseId || queuedResult.parentToolUseId,  // Preserve hierarchy from either source
                      isError: queuedResult.isError,
                    }
                  ]
                }
              }

              // Normal case - create new pending tool message
              return {
                ...session,
                // isProcessing already true from user message send, stays true until 'complete'
                messages: [
                  ...session.messages,
                  {
                    id: generateMessageId(),
                    role: 'tool' as const,
                    content: `Running ${getToolDisplayName(event.toolName)}...`,
                    timestamp: Date.now(),
                    toolName: event.toolName,
                    toolUseId: event.toolUseId,
                    toolInput: event.toolInput,
                    toolIntent: event.toolIntent,
                    toolDisplayName: event.toolDisplayName,
                    turnId: event.turnId,
                    parentToolUseId: event.parentToolUseId,  // Preserve hierarchy
                  }
                ]
              }
            }

            case 'tool_result': {
              const toolMsgs = session.messages
              // Explicit role check to avoid matching non-tool messages
              const matchingTool = toolMsgs.find(m => m.role === 'tool' && m.toolUseId === event.toolUseId)

              // Debug logging for tool_result handling
              const allToolMessages = toolMsgs.filter(m => m.role === 'tool')
              console.log('[App] tool_result received:', {
                sessionId: session.id,
                eventToolUseId: event.toolUseId,
                eventToolName: event.toolName,
                foundMatch: !!matchingTool,
                matchingToolStatus: matchingTool?.toolStatus,
                matchingToolHasResult: matchingTool?.toolResult !== undefined,
                allToolsCount: allToolMessages.length,
                allToolStatuses: allToolMessages.map(m => ({
                  toolUseId: m.toolUseId,
                  toolName: m.toolName,
                  toolStatus: m.toolStatus,
                  hasResult: m.toolResult !== undefined,
                })),
              })

              if (matchingTool) {
                console.log('[App] tool_result: marking tool as completed:', event.toolUseId, 'isError:', event.isError)
                // Normal case - message exists, update it
                // Preserve parentToolUseId (from tool_start) or use event's if available
                return {
                  ...session,
                  messages: toolMsgs.map(m =>
                    m.toolUseId === event.toolUseId
                      ? { ...m, content: event.result, toolResult: event.result, toolStatus: 'completed', parentToolUseId: event.parentToolUseId || m.parentToolUseId, isError: event.isError }
                      : m
                  )
                }
              }

              // Message doesn't exist yet - queue the result for when tool_start arrives
              // This handles out-of-order events (result before start)
              orphanedToolResultsRef.current.set(event.toolUseId, {
                result: event.result,
                toolName: event.toolName,
                turnId: event.turnId,
                parentToolUseId: event.parentToolUseId,  // Preserve hierarchy for out-of-order case
                isError: event.isError,
              })
              console.warn(`[App] tool_result arrived before tool_start for ${event.toolUseId} (${event.toolName}) - queued`)

              return session  // No change yet - will be applied when tool_start arrives
            }

            case 'error': {
              // Fail-safe: Mark any running tools as failed
              const messagesWithFailedTools = session.messages.map(m =>
                m.role === 'tool' && m.toolResult === undefined && m.toolStatus !== 'completed' && m.toolStatus !== 'error'
                  ? { ...m, toolStatus: 'error' as const, toolResult: 'Error occurred', isError: true }
                  : m
              )
              return {
                ...session,
                messages: [
                  ...messagesWithFailedTools,
                  {
                    id: generateMessageId(),
                    role: 'error' as const,
                    content: event.error,
                    timestamp: Date.now()
                  }
                ]
              }
            }

            case 'typed_error': {
              // Fail-safe: Mark any running tools as failed
              const messagesWithFailedTools = session.messages.map(m =>
                m.role === 'tool' && m.toolResult === undefined && m.toolStatus !== 'completed' && m.toolStatus !== 'error'
                  ? { ...m, toolStatus: 'error' as const, toolResult: 'Error occurred', isError: true }
                  : m
              )
              return {
                ...session,
                messages: [
                  ...messagesWithFailedTools,
                  {
                    id: generateMessageId(),
                    role: 'error' as const,
                    content: event.error.title
                      ? `${event.error.title}: ${event.error.message}`
                      : event.error.message,
                    timestamp: Date.now(),
                    // Include error details for collapsible display
                    errorCode: event.error.code,
                    errorTitle: event.error.title,
                    errorDetails: event.error.details,
                    errorOriginal: event.error.originalError,
                    errorCanRetry: event.error.canRetry,
                  }
                ]
              }
            }

            case 'status':
              return {
                ...session,
                messages: [
                  ...session.messages,
                  {
                    id: generateMessageId(),
                    role: 'status' as const,
                    content: event.message,
                    timestamp: Date.now(),
                    statusType: event.statusType
                  }
                ]
              }

            case 'info': {
              // If this is a compaction complete, update the existing compacting message
              if (event.statusType === 'compaction_complete') {
                return {
                  ...session,
                  messages: session.messages.map(m =>
                    m.role === 'status' && m.statusType === 'compacting'
                      ? { ...m, role: 'info' as const, content: event.message, statusType: 'compaction_complete' as const, infoLevel: event.level }
                      : m
                  )
                }
              }
              // Otherwise, add as new info message
              return {
                ...session,
                messages: [
                  ...session.messages,
                  {
                    id: generateMessageId(),
                    role: 'info' as const,
                    content: event.message,
                    timestamp: Date.now(),
                    infoLevel: event.level
                  }
                ]
              }
            }

            case 'complete': {
              // Clear any orphaned tool results (memory cleanup)
              orphanedToolResultsRef.current.clear()

              // Fail-safe: Mark any still-running tools as complete
              // This ensures tools never get stuck in "running" state if tool_result was lost
              const runningTools = session.messages.filter(m =>
                m.role === 'tool' && m.toolResult === undefined && m.toolStatus !== 'completed' && m.toolStatus !== 'error'
              )
              const hasRunningTools = runningTools.length > 0

              console.log('[App] complete received:', {
                sessionId: session.id,
                hasRunningTools,
                runningToolIds: runningTools.map(m => m.toolUseId),
                allToolStatuses: session.messages.filter(m => m.role === 'tool').map(m => ({
                  toolUseId: m.toolUseId,
                  toolName: m.toolName,
                  toolStatus: m.toolStatus,
                  hasResult: m.toolResult !== undefined,
                })),
              })

              if (hasRunningTools) {
                return {
                  ...session,
                  isProcessing: false,
                  messages: session.messages.map(m =>
                    m.role === 'tool' && m.toolResult === undefined && m.toolStatus !== 'completed' && m.toolStatus !== 'error'
                      ? { ...m, toolStatus: 'completed' as const, toolResult: '' }
                      : m
                  )
                }
              }

              return { ...session, isProcessing: false }
            }

            case 'interrupted': {
              // Fail-safe: Mark any running tools as interrupted
              const messagesWithInterruptedTools = session.messages.map(m =>
                m.role === 'tool' && m.toolResult === undefined && m.toolStatus !== 'completed' && m.toolStatus !== 'error'
                  ? { ...m, toolStatus: 'error' as const, toolResult: 'Interrupted', isError: true }
                  : m
              )
              return {
                ...session,
                isProcessing: false,
                messages: [
                  ...messagesWithInterruptedTools,
                  // Use message from main process (already persisted)
                  event.message as Message
                ]
              }
            }

            case 'title_generated':
              return { ...session, name: event.title }

            case 'working_directory_changed':
              return { ...session, workingDirectory: event.workingDirectory }

            default:
              return session
          }
        }
      ))
    })

    return cleanup
  }, [])

  // Debug: Log sessions state changes to verify tool updates are persisting
  useEffect(() => {
    const toolMessages = sessions.flatMap(s =>
      s.messages.filter(m => m.role === 'tool')
    )
    if (toolMessages.length > 0) {
      console.log('[App] sessions state updated - tool messages:',
        toolMessages.map(m => ({
          sessionId: sessions.find(s => s.messages.includes(m))?.id,
          toolUseId: m.toolUseId,
          toolName: m.toolName,
          toolStatus: m.toolStatus,
          hasResult: m.toolResult !== undefined,
        }))
      )
    }
  }, [sessions])

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
      openShortcutsTab()
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
  }, [openShortcutsTab])

  const handleCreateSession = useCallback(async (workspaceId: string, agentId?: string): Promise<Session> => {
    // Find agent if provided - prefer displayName for human-readable title
    const agent = agentId ? agents.find(a => a.id === agentId) : undefined
    const agentName = agent?.displayName || agent?.name
    // Pass agentName to main process so it's stored in the session
    const session = await window.electronAPI.createSession(workspaceId, agentId, agentName)
    setSessions(prev => [session, ...prev])

    // Apply session defaults to the unified sessionOptions
    const hasDefaults = session.skipPermissions || (session.activeModes && session.activeModes.length > 0)
    if (hasDefaults) {
      setSessionOptions(prev => {
        const next = new Map(prev)
        next.set(session.id, {
          ultrathinkEnabled: false,
          skipPermissions: session.skipPermissions ?? false,
          activeModes: session.activeModes ?? [],
        })
        return next
      })
    }

    return session
  }, [agents])

  // Deep link navigation - handles craftagents:// URLs
  // Must be after handleCreateSession is defined
  useDeepLinkNavigation({
    workspaceId: windowWorkspaceId,
    onCreateSession: handleCreateSession,
    isReady: appState === 'ready',
  })

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
    return true
  }, [closeChatTabBySession, sessions])

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
            if (att.type === 'office' && stored.markdownPath) {
              // Read the converted markdown and send as text
              const markdown = await window.electronAPI.readFile(stored.markdownPath)
              return {
                ...att,
                type: 'text' as const,
                text: markdown,
                base64: undefined, // Don't send binary
                storedPath: stored.storedPath, // Include storage path for agent reference
              }
            }
            // Include storedPath for all attachment types
            return {
              ...att,
              storedPath: stored.storedPath,
            }
          })
        )
      }

      // Step 3: Check if ultrathink is enabled for this session
      const isUltrathink = sessionOptions.get(sessionId)?.ultrathinkEnabled ?? false

      // Step 4: Create user message with StoredAttachments (for UI display)
      const userMessage: Message = {
        id: generateMessageId(),
        role: 'user',
        content: message,
        timestamp: Date.now(),
        attachments: storedAttachments,
        ultrathink: isUltrathink || undefined,  // Only set if true
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
    if (updates.skipPermissions !== undefined) {
      window.electronAPI.setSkipPermissions(sessionId, updates.skipPermissions)
    }
    if (updates.activeModes !== undefined) {
      // Sync mode changes with backend (compare to get added/removed modes)
      const current = sessionOptions.get(sessionId)?.activeModes ?? []
      for (const mode of updates.activeModes) {
        if (!current.includes(mode)) {
          window.electronAPI.setMode(sessionId, mode, true)
        }
      }
      for (const mode of current) {
        if (!updates.activeModes.includes(mode)) {
          window.electronAPI.setMode(sessionId, mode, false)
        }
      }
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

  const handleInputChange = useCallback((sessionId: string, value: string) => {
    // Update local state immediately
    setSessionDrafts(prev => {
      const next = new Map(prev)
      if (value) {
        next.set(sessionId, value)
      } else {
        next.delete(sessionId) // Clean up empty drafts
      }
      return next
    })

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
    openSettingsTab()
  }, [openSettingsTab])

  const handleOpenKeyboardShortcuts = useCallback(() => {
    openShortcutsTab()
  }, [openShortcutsTab])

  const handleOpenStoredUserPreferences = useCallback(() => {
    openPreferencesTab()
  }, [openPreferencesTab])

  const handleLogout = useCallback(async () => {
    try {
      // Show native confirmation dialog
      const confirmed = await window.electronAPI.showLogoutConfirmation()
      if (!confirmed) return

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
      console.error('Logout failed:', error)
    }
  }, [onboarding])

  // Start add workspace flow (opens in new window)
  const handleAddWorkspace = useCallback(() => {
    window.electronAPI.openAddWorkspaceWindow()
  }, [])

  // Handle workspace selection - opens workspace in its own window (multi-window architecture)
  const handleSelectWorkspace = useCallback((workspaceId: string) => {
    // If selecting current workspace, do nothing
    if (workspaceId === windowWorkspaceId) return
    // Open (or focus) the window for the selected workspace
    window.electronAPI.openWorkspace(workspaceId)
  }, [windowWorkspaceId])

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
    sessionDrafts,
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
    // File/URL handlers
    onOpenFile: handleOpenFile,
    onOpenUrl: handleOpenUrl,
    // Model
    onModelChange: handleModelChange,
    // Workspace
    onSelectWorkspace: handleSelectWorkspace,
    onAddWorkspace: handleAddWorkspace,
    // App actions
    onOpenSettings: handleOpenSettings,
    onOpenKeyboardShortcuts: handleOpenKeyboardShortcuts,
    onOpenStoredUserPreferences: handleOpenStoredUserPreferences,
    onRefreshAgents: handleRefreshAgents,
    onLogout: handleLogout,
    // Session options
    onSessionOptionsChange: handleSessionOptionsChange,
    onInputChange: handleInputChange,
  }), [
    sessions,
    workspaces,
    agents,
    isLoadingAgents,
    windowWorkspaceId,
    currentModel,
    pendingPermissions,
    sessionDrafts,
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
    handleOpenFile,
    handleOpenUrl,
    handleModelChange,
    handleSelectWorkspace,
    handleAddWorkspace,
    handleOpenSettings,
    handleOpenKeyboardShortcuts,
    handleOpenStoredUserPreferences,
    handleRefreshAgents,
    handleLogout,
    handleSessionOptionsChange,
    handleInputChange,
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
      <ReauthScreen
        onLogin={handleReauthLogin}
        onLogout={handleReauthLogout}
      />
    )
  }

  // Onboarding state
  if (appState === 'onboarding') {
    return (
      <OnboardingWizard
        state={onboarding.state}
        spaceCategories={onboarding.spaceCategories}
        isLoadingSpaces={onboarding.isLoadingSpaces}
        onCancel={handleOnboardingCancel}
        onContinue={onboarding.handleContinue}
        onBack={onboarding.handleBack}
        onLogin={onboarding.handleLogin}
        onOpenLoginManually={onboarding.handleOpenLoginManually}
        onRetryLogin={onboarding.handleRetryLogin}
        onSelectSpace={onboarding.handleSelectSpace}
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

  // Add workspace state (separate from onboarding)
  // Render AddWorkspaceFlow only when visible so the hook mounts/unmounts properly
  if (appState === 'adding-workspace') {
    return (
      <AddWorkspaceFlow
        onComplete={handleAddWorkspaceComplete}
        onCancel={handleAddWorkspaceCancel}
        existingWorkspaceNames={workspaces.map(w => w.name)}
      />
    )
  }

  // Ready state - main app
  return (
    <FocusProvider>
      <TooltipProvider>
        <div className="h-full text-foreground">
          <Chat
            contextValue={chatContextValue}
            defaultLayout={[20, 32, 48]}
            menuNewChatTrigger={menuNewChatTrigger}
            menuNewChatTabTrigger={menuNewChatTabTrigger}
          />
        </div>
      </TooltipProvider>
    </FocusProvider>
  )
}
