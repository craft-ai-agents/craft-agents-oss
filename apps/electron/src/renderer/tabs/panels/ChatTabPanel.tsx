/**
 * ChatTabPanel
 *
 * Wraps the ChatDisplay component for use in the tab system.
 * Gets session data from ChatContext and agent status from main process.
 */

import * as React from 'react'
import { AlertCircle, Bot } from 'lucide-react'
import { ChatDisplay } from '@/components/chat/ChatDisplay'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/loading-indicator'
import { useChatContext, usePendingPermission, usePendingCredential, useSessionOptionsFor, useSession } from '@/context/ChatContext'
import { useAgentState } from '../../hooks/useAgentState'
import type { Tab, ChatTab } from '../types'
import { useTabs } from '../useTabs'

interface ChatTabPanelProps {
  tab: Tab
}

export default function ChatTabPanel({ tab }: ChatTabPanelProps) {
  const chatTab = tab as ChatTab
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
    setMode,
  } = useSessionOptionsFor(chatTab.sessionId)

  const { closeTab, openAgentSetupTab } = useTabs()

  // Use per-session atom for isolated updates
  // Only re-renders when THIS session changes, not when other sessions stream
  const session = useSession(chatTab.sessionId)

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

  // Get pending permission and credential for this session
  const pendingPermission = usePendingPermission(chatTab.sessionId)
  const pendingCredential = usePendingCredential(chatTab.sessionId)

  // Get initial draft value for this session (only on mount/session change)
  // Using useMemo to call getter only once - subsequent typing is handled by FreeFormInput's internal state
  const initialInputValue = React.useMemo(() => {
    return getDraft(chatTab.sessionId)
  }, [getDraft, chatTab.sessionId])

  const handleInputChange = React.useCallback((value: string) => {
    onInputChange(chatTab.sessionId, value)
  }, [chatTab.sessionId, onInputChange])

  // Working directory for this session
  const workingDirectory = session?.workingDirectory
  const handleWorkingDirectoryChange = React.useCallback(async (path: string) => {
    if (!session) return
    // Update session's working directory
    await window.electronAPI.updateSessionWorkingDirectory(session.id, path)
    // Also update global default for future sessions
    await window.electronAPI.setDefaultWorkingDirectory(path)
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

  // Handler to open agent setup wizard (for review/auth states)
  const handleOpenSetupWizard = React.useCallback(() => {
    if (session?.agentId) {
      openAgentSetupTab(
        session.agentId,
        chatTab.workspaceId,
        session?.agentName || 'Agent'
      )
    }
  }, [session?.agentId, session?.agentName, chatTab.workspaceId, openAgentSetupTab])

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
        case 'setup':
          return handleActivateAgent
        case 'error':
          return () => agentState.reload()
        default:
          return handleOpenSetupWizard
      }
    }

    return {
      state: agentState.bannerState,
      agentName: agentState.agentName || session.agentName,
      reason: agentState.bannerReason ?? undefined,
      onAction: getAction(),
    }
  }, [session?.agentId, session?.agentName, agentState.bannerState, agentState.bannerReason, agentState.agentName, agentState.reload, handleActivateAgent, handleOpenSetupWizard])

  // Handle missing session (deleted while tab was open)
  if (!session) {
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
      skipPermissions={sessionOpts.skipPermissions}
      onSkipPermissionsChange={(enabled) => setOption('skipPermissions', enabled)}
      safeModeEnabled={sessionOpts.activeModes.includes('safe')}
      onSafeModeChange={(enabled) => setMode('safe', enabled)}
      // Input draft preservation - initial value only, FreeFormInput manages its own state
      inputValue={initialInputValue}
      onInputChange={handleInputChange}
      // Sources
      sources={enabledSources}
      onSourcesChange={(slugs) => onSessionSourcesChange?.(chatTab.sessionId, slugs)}
      // Working directory (per session)
      workingDirectory={workingDirectory}
      onWorkingDirectoryChange={handleWorkingDirectoryChange}
    />
  )
}
