/**
 * ChatTabPanel
 *
 * Wraps the ChatDisplay component for use in the tab system.
 * Gets session data from ChatContext and agent status from main process.
 */

import * as React from 'react'
import { AlertCircle } from 'lucide-react'
import { useAtomValue, useSetAtom } from 'jotai'
import { ChatDisplay } from '@/components/chat/ChatDisplay'
import { Button } from '@/components/ui/button'
import { useChatContext, usePendingPermission, usePendingCredential, useSessionOptionsFor, useSession } from '@/context/ChatContext'
import { useAgentState } from '../../hooks/useAgentState'
import { rendererPerf } from '@/lib/perf'
import { ensureSessionMessagesLoadedAtom, loadedSessionsAtom, sessionMetaMapAtom } from '../../atoms/sessions'
import type { Tab, ChatTab } from '../types'
import { useTabs } from '../useTabs'

interface ChatTabPanelProps {
  tab: Tab
}

/**
 * ChatTabPanel is memoized to prevent re-renders when other sessions stream.
 * The `tab` prop only changes when switching tabs, and all context values
 * extracted via useChatContext() are stable callbacks/refs.
 */
export default React.memo(function ChatTabPanel({ tab }: ChatTabPanelProps) {
  const chatTab = tab as ChatTab

  // Diagnostic: mark when panel component runs (before any hooks)
  React.useLayoutEffect(() => {
    rendererPerf.markSessionSwitch(chatTab.sessionId, 'panel.mounted')
  }, [chatTab.sessionId])

  const {
    currentModel,
    onSendMessage,
    onOpenFile,
    onOpenUrl,
    onModelChange,
    onRespondToPermission,
    onRespondToCredential,
    onMarkSessionRead,
    textareaRef,
    // Input drafts
    getDraft,
    onInputChange,
    // Sources
    enabledSources,
    onSessionSourcesChange,
  } = useChatContext()

  // Use the unified session options hook for clean access
  const {
    options: sessionOpts,
    setOption,
    setPermissionMode,
  } = useSessionOptionsFor(chatTab.sessionId)

  const { closeTab } = useTabs()

  // Use per-session atom for isolated updates
  // Only re-renders when THIS session changes, not when other sessions stream
  const session = useSession(chatTab.sessionId)

  // Track if messages are loaded for this session (for lazy loading)
  const loadedSessions = useAtomValue(loadedSessionsAtom)
  const messagesLoaded = loadedSessions.has(chatTab.sessionId)

  // Check if session exists in metadata (for loading state detection)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const sessionMeta = sessionMetaMap.get(chatTab.sessionId)

  // Fallback: ensure messages are loaded when tab is viewed
  // Messages are typically preloaded by openChatTab before the tab switch,
  // but this handles edge cases (e.g., direct URL navigation, tab restoration)
  const ensureMessagesLoaded = useSetAtom(ensureSessionMessagesLoadedAtom)
  React.useEffect(() => {
    ensureMessagesLoaded(chatTab.sessionId)
  }, [chatTab.sessionId, ensureMessagesLoaded])

  // Perf: Mark when session data is available (useLayoutEffect to fire before end)
  // Use a ref to ensure we only mark once per session switch
  const sessionLoadedMarkedRef = React.useRef<string | null>(null)
  React.useLayoutEffect(() => {
    if (session && sessionLoadedMarkedRef.current !== chatTab.sessionId) {
      sessionLoadedMarkedRef.current = chatTab.sessionId
      rendererPerf.markSessionSwitch(chatTab.sessionId, 'session.loaded')
    }
  }, [chatTab.sessionId, session])

  // Mark session as read when displayed (not processing)
  // This handles all navigation methods: click, keyboard, tab switch
  React.useEffect(() => {
    if (session && !session.isProcessing) {
      onMarkSessionRead(session.id)
    }
  }, [session?.id, session?.isProcessing, onMarkSessionRead])

  // Get agent status from main process (source of truth)
  // Agent-scoped: keyed by (workspaceId, agentId), not sessionId
  // Pass null for agentId if session doesn't exist to avoid unnecessary IPC calls
  const agentState = useAgentState(
    session ? chatTab.workspaceId : null,
    session ? (chatTab.agentId || null) : null
  )

  // Perf: Mark when agent state resolves (useLayoutEffect to fire before end)
  // Use a ref to ensure we only mark once per session switch
  const agentStatusMarkedRef = React.useRef<string | null>(null)
  React.useLayoutEffect(() => {
    if ((agentState.status.status !== 'idle' || !agentState.isLoading) &&
        agentStatusMarkedRef.current !== chatTab.sessionId) {
      agentStatusMarkedRef.current = chatTab.sessionId
      rendererPerf.markSessionSwitch(chatTab.sessionId, 'agent.status')
    }
  }, [chatTab.sessionId, agentState.status.status, agentState.isLoading])

  // Get pending permission and credential for this session
  const pendingPermission = usePendingPermission(chatTab.sessionId)
  const pendingCredential = usePendingCredential(chatTab.sessionId)

  // Track draft value for this session
  // We need to re-sync when draft changes externally (e.g., "Edit in Chat" pre-fills input)
  // Use state + effect instead of useMemo so we can react to external draft changes
  const [inputValue, setInputValue] = React.useState(() => getDraft(chatTab.sessionId))
  const inputValueRef = React.useRef(inputValue)
  inputValueRef.current = inputValue

  // Re-sync from parent when session changes
  React.useEffect(() => {
    setInputValue(getDraft(chatTab.sessionId))
  }, [getDraft, chatTab.sessionId])

  // Also sync when draft is set externally (e.g., from SourceInfoTabPanel's "Edit in Chat")
  // This polls the draft ref to detect external changes
  React.useEffect(() => {
    // Check for external draft changes every 50ms for a short period after mount
    // This handles the case where openNewChat sets the draft after tab is mounted
    let attempts = 0
    const maxAttempts = 10 // 500ms total
    const interval = setInterval(() => {
      const currentDraft = getDraft(chatTab.sessionId)
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
  }, [chatTab.sessionId, getDraft])

  const handleInputChange = React.useCallback((value: string) => {
    // Update local state to keep in sync with FreeFormInput
    setInputValue(value)
    inputValueRef.current = value
    // Propagate to parent for draft persistence
    onInputChange(chatTab.sessionId, value)
  }, [chatTab.sessionId, onInputChange])

  // Working directory for this session
  const workingDirectory = session?.workingDirectory
  const handleWorkingDirectoryChange = React.useCallback(async (path: string) => {
    if (!session) return
    // Update session's working directory
    await window.electronAPI.sessionCommand(session.id, { type: 'updateWorkingDirectory', dir: path })
  }, [session])

  // Handle file opens - optionally open in tab instead of external app
  const handleOpenFile = React.useCallback(
    (path: string) => {
      // For now, open in external app (can be changed to openFileTab later)
      onOpenFile(path)
    },
    [onOpenFile]
  )

  // Handle URL opens - optionally open in tab instead of external browser
  const handleOpenUrl = React.useCallback(
    (url: string) => {
      // For now, open in external browser (can be changed to openBrowserTab later)
      onOpenUrl(url)
    },
    [onOpenUrl]
  )

  // Handler to activate agent directly (shows progress in this panel)
  const handleActivateAgent = React.useCallback(() => {
    if (session?.agentId) {
      agentState.activate()
    }
  }, [session?.agentId, agentState])

  // Auto-mark agent as active when ready (no extra click needed)
  const { isReady, markActive } = agentState
  React.useEffect(() => {
    if (isReady && session?.agentId) {
      markActive()
    }
  }, [isReady, session?.agentId, markActive])

  // Agent setup state from centralized hook (single source of truth)
  // Maps agentState.bannerState to SetupAuthBanner props with appropriate onAction
  const agentSetupState = React.useMemo(() => {
    if (!session?.agentId) return undefined

    // Hidden state - no banner needed
    if (agentState.bannerState === 'hidden') {
      return undefined
    }

    // Determine action based on banner state
    const getAction = () => {
      switch (agentState.bannerState) {
        case 'error':
          return () => agentState.reload()
        default:
          // Agent setup wizard was removed - no action available for auth states
          return () => {
            // No-op: banner will still show what's needed but clicking won't navigate
          }
      }
    }

    return {
      state: agentState.bannerState,
      agentName: agentState.agentName || session.agentName,
      reason: agentState.bannerReason ?? undefined,
      onAction: getAction(),
    }
  }, [session?.agentId, session?.agentName, agentState.bannerState, agentState.bannerReason, agentState.agentName, agentState.reload])

  // Perf: Mark when data is ready (before rendering ChatDisplay)
  // Use a ref to track if we've already marked for this session switch
  const dataReadyMarkedRef = React.useRef<string | null>(null)
  React.useLayoutEffect(() => {
    if (messagesLoaded && session && dataReadyMarkedRef.current !== chatTab.sessionId) {
      dataReadyMarkedRef.current = chatTab.sessionId
      rendererPerf.markSessionSwitch(chatTab.sessionId, 'data.ready')
    }
  }, [chatTab.sessionId, messagesLoaded, session])

  // Perf: Mark render complete after paint
  // Using useEffect + rAF to fire after DOM is painted and visible to user
  React.useEffect(() => {
    if (session) {
      // Wait for next frame to ensure paint is complete
      const rafId = requestAnimationFrame(() => {
        rendererPerf.endSessionSwitch(chatTab.sessionId)
      })
      return () => cancelAnimationFrame(rafId)
    }
  }, [chatTab.sessionId, session])

  // Handle missing session
  // Two cases: (1) session truly deleted, (2) session not yet loaded (exists in meta map)
  if (!session) {
    // If session exists in metadata, it's just not loaded yet - show loading state
    if (sessionMeta) {
      // Create a skeleton session from metadata for the loading state
      const skeletonSession = {
        id: sessionMeta.id,
        workspaceId: sessionMeta.workspaceId,
        workspaceName: '', // Not needed for loading state
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
          onSendMessage={() => {}} // Disabled during loading
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
          inputValue={inputValue}
          onInputChange={handleInputChange}
          sources={enabledSources}
          onSourcesChange={(slugs) => onSessionSourcesChange?.(chatTab.sessionId, slugs)}
          workingDirectory={sessionMeta.workingDirectory}
          onWorkingDirectoryChange={handleWorkingDirectoryChange}
          messagesLoading={true}
        />
      )
    }

    // Session truly doesn't exist (deleted while tab was open)
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <AlertCircle className="h-10 w-10" />
        <p className="text-sm">This session no longer exists</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => closeTab(chatTab.id)}
        >
          Close Tab
        </Button>
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
      // Advanced options - using unified session options hook
      ultrathinkEnabled={sessionOpts.ultrathinkEnabled}
      onUltrathinkChange={(enabled) => setOption('ultrathinkEnabled', enabled)}
      permissionMode={sessionOpts.permissionMode}
      onPermissionModeChange={setPermissionMode}
      // Input draft preservation - synced from parent, FreeFormInput manages its own internal state
      inputValue={inputValue}
      onInputChange={handleInputChange}
      // Sources
      sources={enabledSources}
      onSourcesChange={(slugs) => onSessionSourcesChange?.(chatTab.sessionId, slugs)}
      // Working directory (per session)
      workingDirectory={workingDirectory}
      onWorkingDirectoryChange={handleWorkingDirectoryChange}
      // Lazy loading - show spinner in messages area while loading
      messagesLoading={!messagesLoaded}
    />
  )
})
