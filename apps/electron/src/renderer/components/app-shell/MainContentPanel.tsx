/**
 * MainContentPanel - Right panel component for displaying content
 *
 * Renders either:
 * - ChatView for sessions
 * - Settings, Preferences, Shortcuts pages
 * - Source/Agent info pages
 *
 * Uses activeView from NavigationContext to determine what to display.
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { AlertCircle } from 'lucide-react'
import { ChatDisplay } from '@/components/app-shell/ChatDisplay'
import { Panel } from './Panel'
import { useAppShellContext, usePendingPermission, usePendingCredential, useSessionOptionsFor, useSession as useSessionData } from '@/context/AppShellContext'
import { useSession } from '@/hooks/useSession'
import { useAgentState } from '@/hooks/useAgentState'
import { useActiveView } from '@/contexts/NavigationContext'
import { rendererPerf } from '@/lib/perf'
import { ensureSessionMessagesLoadedAtom, loadedSessionsAtom, sessionMetaMapAtom } from '@/atoms/sessions'
import { SettingsPage, PreferencesPage, ShortcutsPage, SourceInfoPage, AgentInfoPage } from '@/pages'

export interface MainContentPanelProps {
  /** Whether the app is in focused mode (single chat, no sidebar) */
  isFocusedMode?: boolean
  /** Optional className for the container */
  className?: string
}

export function MainContentPanel({
  isFocusedMode = false,
  className,
}: MainContentPanelProps) {
  const [sessionState] = useSession()
  const activeSessionId = sessionState.selected
  const activeView = useActiveView()
  const { activeWorkspaceId } = useAppShellContext()

  // Render based on active view type
  switch (activeView.type) {
    case 'settings':
      return (
        <Panel variant="grow" className={className}>
          <SettingsPage />
        </Panel>
      )

    case 'preferences':
      return (
        <Panel variant="grow" className={className}>
          <PreferencesPage />
        </Panel>
      )

    case 'shortcuts':
      return (
        <Panel variant="grow" className={className}>
          <ShortcutsPage />
        </Panel>
      )

    case 'source-info':
      return (
        <Panel variant="grow" className={className}>
          <SourceInfoPage
            sourceSlug={activeView.sourceSlug}
            workspaceId={activeWorkspaceId || ''}
            agentSlug={activeView.agentSlug}
          />
        </Panel>
      )

    case 'agent-info':
      return (
        <Panel variant="grow" className={className}>
          <AgentInfoPage
            agentId={activeView.agentId}
            agentName={activeView.agentName}
            workspaceId={activeWorkspaceId || ''}
          />
        </Panel>
      )

    case 'chat':
    default:
      // If no session is selected, show empty state
      if (!activeSessionId) {
        return (
          <Panel variant="grow" className={className}>
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <p className="text-sm">Select a conversation to get started</p>
            </div>
          </Panel>
        )
      }

      return (
        <Panel variant="grow" className={className}>
          <ChatView sessionId={activeSessionId} isFocusedMode={isFocusedMode} />
        </Panel>
      )
  }
}

/**
 * ChatView - Displays a single session's chat
 * Extracted from the old ChatTabPanel, simplified for direct use
 */
interface ChatViewProps {
  sessionId: string
  isFocusedMode?: boolean
}

const ChatView = React.memo(function ChatView({ sessionId, isFocusedMode }: ChatViewProps) {
  // Diagnostic: mark when component runs
  React.useLayoutEffect(() => {
    rendererPerf.markSessionSwitch(sessionId, 'panel.mounted')
  }, [sessionId])

  const {
    activeWorkspaceId,
    currentModel,
    onSendMessage,
    onOpenFile,
    onOpenUrl,
    onModelChange,
    onRespondToPermission,
    onRespondToCredential,
    onMarkSessionRead,
    textareaRef,
    getDraft,
    onInputChange,
    enabledSources,
    enabledModes,
    onSessionSourcesChange,
  } = useAppShellContext()

  // Use the unified session options hook for clean access
  const {
    options: sessionOpts,
    setOption,
    setPermissionMode,
  } = useSessionOptionsFor(sessionId)

  // Use per-session atom for isolated updates
  const session = useSessionData(sessionId)

  // Track if messages are loaded for this session (for lazy loading)
  const loadedSessions = useAtomValue(loadedSessionsAtom)
  const messagesLoaded = loadedSessions.has(sessionId)

  // Check if session exists in metadata (for loading state detection)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const sessionMeta = sessionMetaMap.get(sessionId)

  // Fallback: ensure messages are loaded when session is viewed
  const ensureMessagesLoaded = useSetAtom(ensureSessionMessagesLoadedAtom)
  React.useEffect(() => {
    ensureMessagesLoaded(sessionId)
  }, [sessionId, ensureMessagesLoaded])

  // Perf: Mark when session data is available
  const sessionLoadedMarkedRef = React.useRef<string | null>(null)
  React.useLayoutEffect(() => {
    if (session && sessionLoadedMarkedRef.current !== sessionId) {
      sessionLoadedMarkedRef.current = sessionId
      rendererPerf.markSessionSwitch(sessionId, 'session.loaded')
    }
  }, [sessionId, session])

  // Mark session as read when displayed (not processing)
  React.useEffect(() => {
    if (session && !session.isProcessing) {
      onMarkSessionRead(session.id)
    }
  }, [session?.id, session?.isProcessing, onMarkSessionRead])

  // Get agent status from main process
  const agentState = useAgentState(
    session ? activeWorkspaceId : null,
    session ? (session.agentId || null) : null
  )

  // Perf: Mark when agent state resolves
  const agentStatusMarkedRef = React.useRef<string | null>(null)
  React.useLayoutEffect(() => {
    if ((agentState.status.status !== 'idle' || !agentState.isLoading) &&
        agentStatusMarkedRef.current !== sessionId) {
      agentStatusMarkedRef.current = sessionId
      rendererPerf.markSessionSwitch(sessionId, 'agent.status')
    }
  }, [sessionId, agentState.status.status, agentState.isLoading])

  // Get pending permission and credential for this session
  const pendingPermission = usePendingPermission(sessionId)
  const pendingCredential = usePendingCredential(sessionId)

  // Track draft value for this session
  const [inputValue, setInputValue] = React.useState(() => getDraft(sessionId))
  const inputValueRef = React.useRef(inputValue)
  inputValueRef.current = inputValue

  // Re-sync from parent when session changes
  React.useEffect(() => {
    setInputValue(getDraft(sessionId))
  }, [getDraft, sessionId])

  // Sync when draft is set externally (e.g., from notifications or shortcuts)
  // PERFORMANCE NOTE: This bounded polling (max 10 attempts × 50ms = 500ms)
  // handles external draft injection. Drafts use a ref for typing performance,
  // so they're not directly reactive. This polling only runs on session switch,
  // not continuously. Alternative: Add a Jotai atom for draft changes.
  React.useEffect(() => {
    let attempts = 0
    const maxAttempts = 10
    const interval = setInterval(() => {
      const currentDraft = getDraft(sessionId)
      if (currentDraft !== inputValueRef.current && currentDraft !== '') {
        setInputValue(currentDraft)
        clearInterval(interval)
      }
      attempts++
      if (attempts >= maxAttempts) {
        clearInterval(interval)
      }
    }, 50)

    return () => clearInterval(interval)
  }, [sessionId, getDraft])

  const handleInputChange = React.useCallback((value: string) => {
    setInputValue(value)
    inputValueRef.current = value
    onInputChange(sessionId, value)
  }, [sessionId, onInputChange])

  // Working directory for this session
  const workingDirectory = session?.workingDirectory
  const handleWorkingDirectoryChange = React.useCallback(async (path: string) => {
    if (!session) return
    await window.electronAPI.sessionCommand(session.id, { type: 'updateWorkingDirectory', dir: path })
  }, [session])

  const handleOpenFile = React.useCallback(
    (path: string) => {
      onOpenFile(path)
    },
    [onOpenFile]
  )

  const handleOpenUrl = React.useCallback(
    (url: string) => {
      onOpenUrl(url)
    },
    [onOpenUrl]
  )

  // Handler to activate agent directly
  const handleActivateAgent = React.useCallback(() => {
    if (session?.agentId) {
      agentState.activate()
    }
  }, [session?.agentId, agentState])

  // Auto-mark agent as active when ready
  const { isReady, markActive } = agentState
  React.useEffect(() => {
    if (isReady && session?.agentId) {
      markActive()
    }
  }, [isReady, session?.agentId, markActive])

  // Agent setup state from centralized hook
  const agentSetupState = React.useMemo(() => {
    if (!session?.agentId) return undefined

    if (agentState.bannerState === 'hidden') {
      return undefined
    }

    const getAction = () => {
      switch (agentState.bannerState) {
        case 'error':
          return () => agentState.reload()
        default:
          return () => {}
      }
    }

    return {
      state: agentState.bannerState,
      agentName: agentState.agentName || session.agentName,
      reason: agentState.bannerReason ?? undefined,
      onAction: getAction(),
    }
  }, [session?.agentId, session?.agentName, agentState.bannerState, agentState.bannerReason, agentState.agentName, agentState.reload])

  // Perf: Mark when data is ready
  const dataReadyMarkedRef = React.useRef<string | null>(null)
  React.useLayoutEffect(() => {
    if (messagesLoaded && session && dataReadyMarkedRef.current !== sessionId) {
      dataReadyMarkedRef.current = sessionId
      rendererPerf.markSessionSwitch(sessionId, 'data.ready')
    }
  }, [sessionId, messagesLoaded, session])

  // Perf: Mark render complete after paint
  React.useEffect(() => {
    if (session) {
      const rafId = requestAnimationFrame(() => {
        rendererPerf.endSessionSwitch(sessionId)
      })
      return () => cancelAnimationFrame(rafId)
    }
  }, [sessionId, session])

  // Handle missing session - loading or deleted
  if (!session) {
    if (sessionMeta) {
      // Session exists in metadata but not loaded yet - show loading state
      const skeletonSession = {
        id: sessionMeta.id,
        workspaceId: sessionMeta.workspaceId,
        workspaceName: '',
        name: sessionMeta.name,
        preview: sessionMeta.preview,
        lastMessageAt: sessionMeta.lastMessageAt || 0,
        messages: [],
        isProcessing: sessionMeta.isProcessing || false,
        agentId: sessionMeta.agentId,
        agentName: sessionMeta.agentName,
        isFlagged: sessionMeta.isFlagged,
        workingDirectory: sessionMeta.workingDirectory,
        enabledSourceSlugs: sessionMeta.enabledSourceSlugs,
      }

      return (
        <ChatDisplay
          session={skeletonSession}
          onSendMessage={() => {}}
          onOpenFile={handleOpenFile}
          onOpenUrl={handleOpenUrl}
          currentModel={currentModel}
          onModelChange={onModelChange}
          textareaRef={textareaRef}
          pendingPermission={undefined}
          onRespondToPermission={onRespondToPermission}
          pendingCredential={undefined}
          onRespondToCredential={onRespondToCredential}
          agentSetupState={undefined}
          ultrathinkEnabled={sessionOpts.ultrathinkEnabled}
          onUltrathinkChange={(enabled) => setOption('ultrathinkEnabled', enabled)}
          permissionMode={sessionOpts.permissionMode}
          onPermissionModeChange={setPermissionMode}
          enabledModes={enabledModes}
          inputValue={inputValue}
          onInputChange={handleInputChange}
          sources={enabledSources}
          onSourcesChange={(slugs) => onSessionSourcesChange?.(sessionId, slugs)}
          workingDirectory={sessionMeta.workingDirectory}
          onWorkingDirectoryChange={handleWorkingDirectoryChange}
          messagesLoading={true}
        />
      )
    }

    // Session truly doesn't exist
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <AlertCircle className="h-10 w-10" />
        <p className="text-sm">This session no longer exists</p>
      </div>
    )
  }

  return (
    <ChatDisplay
      session={session}
      onSendMessage={(message, attachments) => {
        if (session) {
          onSendMessage(session.id, message, attachments)
        }
      }}
      onOpenFile={handleOpenFile}
      onOpenUrl={handleOpenUrl}
      currentModel={currentModel}
      onModelChange={onModelChange}
      textareaRef={textareaRef}
      pendingPermission={pendingPermission}
      onRespondToPermission={onRespondToPermission}
      pendingCredential={pendingCredential}
      onRespondToCredential={onRespondToCredential}
      agentSetupState={agentSetupState}
      ultrathinkEnabled={sessionOpts.ultrathinkEnabled}
      onUltrathinkChange={(enabled) => setOption('ultrathinkEnabled', enabled)}
      permissionMode={sessionOpts.permissionMode}
      onPermissionModeChange={setPermissionMode}
      enabledModes={enabledModes}
      inputValue={inputValue}
      onInputChange={handleInputChange}
      sources={enabledSources}
      onSourcesChange={(slugs) => onSessionSourcesChange?.(sessionId, slugs)}
      workingDirectory={workingDirectory}
      onWorkingDirectoryChange={handleWorkingDirectoryChange}
      messagesLoading={!messagesLoaded}
    />
  )
})
