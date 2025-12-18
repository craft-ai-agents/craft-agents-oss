import React, { useState, useEffect, useCallback } from 'react'
import type { Session, Workspace, SessionEvent, Message, SubAgentMetadata, FileAttachment, StoredAttachment, PermissionRequest, SetupNeeds } from '../shared/types'
import { generateMessageId } from '../shared/types'
import { Chat } from '@/components/chat/Chat'
import { OnboardingWizard } from '@/components/onboarding'
import { AddWorkspaceWizard } from '@/components/AddWorkspaceWizard'
import { TooltipProvider } from '@/components/ui/tooltip'
import { FocusProvider } from '@/context/FocusContext'
import { useGlobalShortcuts } from '@/hooks/keyboard'
import { useOnboarding } from '@/hooks/useOnboarding'
import { useAddWorkspace } from '@/hooks/useAddWorkspace'
import { useTabs } from '@/tabs'
import { Spinner } from '@/components/ui/loading-indicator'
import { DEFAULT_MODEL } from '@config/models'

type AppState = 'loading' | 'onboarding' | 'ready' | 'adding-workspace'

export default function App() {
  // App state: loading -> check auth -> onboarding or ready
  const [appState, setAppState] = useState<AppState>('loading')
  const [setupNeeds, setSetupNeeds] = useState<SetupNeeds | null>(null)

  const [sessions, setSessions] = useState<Session[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [agents, setAgents] = useState<SubAgentMetadata[]>([])
  const [isLoadingAgents, setIsLoadingAgents] = useState(false)
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const [currentModel, setCurrentModel] = useState(DEFAULT_MODEL)
  const [menuNewChatTrigger, setMenuNewChatTrigger] = useState(0)
  // Permission requests per session (queue to handle multiple concurrent requests)
  const [pendingPermissions, setPendingPermissions] = useState<Map<string, PermissionRequest[]>>(new Map())

  // Handle onboarding completion
  const handleOnboardingComplete = useCallback(() => {
    setAppState('ready')
    // Reload workspaces and sessions after onboarding
    window.electronAPI.getWorkspaces().then((ws) => {
      setWorkspaces(ws)
      if (ws.length > 0) {
        setActiveWorkspaceId(ws[0].id)
      }
    })
    window.electronAPI.getSessions().then(setSessions)
  }, [])

  // Onboarding hook
  const onboarding = useOnboarding({
    onComplete: handleOnboardingComplete,
    initialSetupNeeds: setupNeeds || undefined,
  })

  // Add workspace completion handler
  const handleAddWorkspaceComplete = useCallback(() => {
    setAppState('ready')
    // Reload workspaces after adding
    window.electronAPI.getWorkspaces().then((ws) => {
      setWorkspaces(ws)
      // Switch to the newly added workspace (last one)
      if (ws.length > 0) {
        setActiveWorkspaceId(ws[ws.length - 1].id)
      }
    })
  }, [])

  // Add workspace cancel handler
  const handleAddWorkspaceCancel = useCallback(() => {
    setAppState('ready')
  }, [])

  // Add workspace hook (separate from onboarding)
  const addWorkspace = useAddWorkspace({
    onComplete: handleAddWorkspaceComplete,
    onCancel: handleAddWorkspaceCancel,
  })

  // Check auth state on mount
  useEffect(() => {
    const checkAuthState = async () => {
      try {
        const needs = await window.electronAPI.getSetupNeeds()
        setSetupNeeds(needs)

        if (needs.isFullyConfigured) {
          setAppState('ready')
        } else {
          setAppState('onboarding')
        }
      } catch (error) {
        console.error('Failed to check auth state:', error)
        // If check fails, show onboarding to be safe
        setAppState('onboarding')
      }
    }

    checkAuthState()
  }, [])

  // Tab system
  const { openShortcutsTab } = useTabs()

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

  // Load workspaces and sessions when app is ready
  useEffect(() => {
    if (appState !== 'ready') return

    window.electronAPI.getWorkspaces().then((ws) => {
      setWorkspaces(ws)
      // Set first workspace as active if none selected
      setActiveWorkspaceId(current => {
        if (!current && ws.length > 0) {
          return ws[0].id
        }
        return current
      })
    })
    window.electronAPI.getSessions().then(setSessions)
  }, [appState])

  // Load agents when workspace changes
  useEffect(() => {
    if (activeWorkspaceId) {
      setIsLoadingAgents(true)
      window.electronAPI.getAgents(activeWorkspaceId)
        .then(setAgents)
        .finally(() => setIsLoadingAgents(false))
    } else {
      setAgents([])
      setIsLoadingAgents(false)
    }
  }, [activeWorkspaceId])

  // Listen for session events
  useEffect(() => {
    const cleanup = window.electronAPI.onSessionEvent((event: SessionEvent) => {
      // Handle permission requests separately (outside session state)
      // Use a queue to handle multiple concurrent permission requests
      if (event.type === 'permission_request') {
        setPendingPermissions(prev => {
          const next = new Map(prev)
          const existingQueue = next.get(event.sessionId) || []
          next.set(event.sessionId, [...existingQueue, event.request])
          return next
        })
        return
      }

      // Handle complete event - clear any pending permission for the session
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

      setSessions(prev => {
        return prev.map(session => {
          if (session.id !== event.sessionId) return session

          switch (event.type) {
            case 'text_delta': {
              const lastMsg = session.messages[session.messages.length - 1]

              if (lastMsg?.role === 'assistant' && lastMsg.isStreaming) {
                return {
                  ...session,
                  messages: [
                    ...session.messages.slice(0, -1),
                    { ...lastMsg, content: lastMsg.content + event.delta }
                  ]
                }
              }

              return {
                ...session,
                messages: [
                  ...session.messages,
                  {
                    id: generateMessageId(),
                    role: 'assistant' as const,
                    content: event.delta,
                    timestamp: Date.now(),
                    isStreaming: true
                  }
                ]
              }
            }

            case 'text_complete': {
              const msgs = session.messages
              const lastAssistant = msgs[msgs.length - 1]
              if (lastAssistant?.role === 'assistant') {
                return {
                  ...session,
                  messages: [
                    ...msgs.slice(0, -1),
                    { ...lastAssistant, content: event.text, isStreaming: false }
                  ]
                }
              }
              return session
            }

            case 'tool_start':
              return {
                ...session,
                messages: [
                  ...session.messages,
                  {
                    id: generateMessageId(),
                    role: 'tool' as const,
                    content: `Running ${event.toolName}...`,
                    timestamp: Date.now(),
                    toolName: event.toolName,
                    toolUseId: event.toolUseId,
                    toolInput: event.toolInput
                  }
                ]
              }

            case 'tool_result': {
              const toolMsgs = session.messages
              const matchingTool = toolMsgs.find(m => m.toolUseId === event.toolUseId)
              if (matchingTool) {
                return {
                  ...session,
                  messages: toolMsgs.map(m =>
                    m.toolUseId === event.toolUseId
                      ? { ...m, content: event.result, toolResult: event.result }
                      : m
                  )
                }
              }
              const lastTool = toolMsgs.findLast(m => m.toolName === event.toolName && !m.toolResult)
              if (lastTool) {
                return {
                  ...session,
                  messages: toolMsgs.map(m =>
                    m.id === lastTool.id
                      ? { ...m, content: event.result, toolResult: event.result }
                      : m
                  )
                }
              }
              return session
            }

            case 'error':
              return {
                ...session,
                messages: [
                  ...session.messages,
                  {
                    id: generateMessageId(),
                    role: 'error' as const,
                    content: event.error,
                    timestamp: Date.now()
                  }
                ]
              }

            case 'typed_error':
              return {
                ...session,
                messages: [
                  ...session.messages,
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

            case 'status':
              return {
                ...session,
                messages: [
                  ...session.messages,
                  {
                    id: generateMessageId(),
                    role: 'status' as const,
                    content: event.message,
                    timestamp: Date.now()
                  }
                ]
              }

            case 'complete':
              return { ...session, isProcessing: false }

            case 'title_generated':
              return { ...session, name: event.title }

            default:
              return session
          }
        })
      })
    })

    return cleanup
  }, [])

  // Listen for menu bar events
  useEffect(() => {
    const unsubNewChat = window.electronAPI.onMenuNewChat(() => {
      setMenuNewChatTrigger(n => n + 1)
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
    return session
  }, [agents])

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    await window.electronAPI.deleteSession(sessionId)
    setSessions(prev => prev.filter(s => s.id !== sessionId))
  }, [])

  const handleArchiveSession = useCallback(async (sessionId: string) => {
    await window.electronAPI.archiveSession(sessionId)
    setSessions(prev => prev.map(s =>
      s.id === sessionId ? { ...s, isArchived: true } : s
    ))
  }, [])

  const handleUnarchiveSession = useCallback(async (sessionId: string) => {
    await window.electronAPI.unarchiveSession(sessionId)
    setSessions(prev => prev.map(s =>
      s.id === sessionId ? { ...s, isArchived: false } : s
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
              }
            }
            return att
          })
        )
      }

      // Step 3: Create user message with StoredAttachments (for UI display)
      const userMessage: Message = {
        id: generateMessageId(),
        role: 'user',
        content: message,
        timestamp: Date.now(),
        attachments: storedAttachments,
      }

      setSessions(prev => prev.map(s =>
        s.id === sessionId
          ? { ...s, messages: [...s.messages, userMessage], isProcessing: true, lastMessageAt: Date.now() }
          : s
      ))

      // Step 4: Send to Claude with processed attachments + stored attachments for persistence
      await window.electronAPI.sendMessage(sessionId, message, processedAttachments, storedAttachments)
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
  }, [])

  const handleRefreshAgents = useCallback(async () => {
    if (activeWorkspaceId) {
      const refreshedAgents = await window.electronAPI.refreshAgents(activeWorkspaceId)
      setAgents(refreshedAgents)
    }
  }, [activeWorkspaceId])

  const handleRespondToPermission = useCallback(async (sessionId: string, requestId: string, allowed: boolean, alwaysAllow: boolean) => {
    // Send response to main process
    const success = await window.electronAPI.respondToPermission(sessionId, requestId, allowed, alwaysAllow)

    if (success) {
      // Remove only the first permission from the queue (the one we just responded to)
      setPendingPermissions(prev => {
        const next = new Map(prev)
        const queue = next.get(sessionId) || []
        const remainingQueue = queue.slice(1) // Remove first item
        if (remainingQueue.length === 0) {
          next.delete(sessionId)
        } else {
          next.set(sessionId, remainingQueue)
        }
        return next
      })
    } else {
      // Response failed (agent/session gone) - clear the permission anyway
      // to avoid UI being stuck with stale permission
      console.error('Permission response failed - agent may be gone')
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
    console.log('Open settings')
    // TODO: Implement settings panel
  }, [])

  const handleOpenKeyboardShortcuts = useCallback(() => {
    openShortcutsTab()
  }, [openShortcutsTab])

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
      setActiveWorkspaceId(null)
      // Reset setupNeeds to force fresh onboarding start
      setSetupNeeds({
        needsCraftAuth: true,
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

  // Start add workspace flow (separate from onboarding)
  const handleAddWorkspace = useCallback(() => {
    setAppState('adding-workspace')
  }, [])

  // Handle cancel during onboarding
  const handleOnboardingCancel = useCallback(() => {
    onboarding.handleCancel()
  }, [onboarding])

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
  if (appState === 'adding-workspace') {
    return (
      <AddWorkspaceWizard
        state={addWorkspace.state}
        spaceCategories={addWorkspace.spaceCategories}
        onLogin={addWorkspace.handleLogin}
        onSelectSpace={addWorkspace.handleSelectSpace}
        onContinue={addWorkspace.handleContinue}
        onBack={addWorkspace.handleBack}
        onCancel={addWorkspace.handleCancel}
      />
    )
  }

  // Ready state - main app
  return (
    <FocusProvider>
      <TooltipProvider>
        <div className="h-full text-foreground">
          <Chat
            workspaces={workspaces}
            sessions={sessions}
            agents={agents}
            isLoadingAgents={isLoadingAgents}
            activeWorkspaceId={activeWorkspaceId}
            defaultLayout={[20, 32, 48]}
            currentModel={currentModel}
            menuNewChatTrigger={menuNewChatTrigger}
            onModelChange={setCurrentModel}
            onSelectWorkspace={setActiveWorkspaceId}
            onCreateSession={handleCreateSession}
            onDeleteSession={handleDeleteSession}
            onArchiveSession={handleArchiveSession}
            onUnarchiveSession={handleUnarchiveSession}
            onRenameSession={handleRenameSession}
            onSendMessage={handleSendMessage}
            onOpenFile={handleOpenFile}
            onOpenUrl={handleOpenUrl}
            onOpenSettings={handleOpenSettings}
            onOpenKeyboardShortcuts={handleOpenKeyboardShortcuts}
            onRefreshAgents={handleRefreshAgents}
            onLogout={handleLogout}
            onAddWorkspace={handleAddWorkspace}
            pendingPermissions={pendingPermissions}
            onRespondToPermission={handleRespondToPermission}
          />
        </div>
      </TooltipProvider>
    </FocusProvider>
  )
}
