/**
 * ChatPage
 *
 * Displays a single session's chat with a consistent PanelHeader.
 * Extracted from MainContentPanel for consistency with other pages.
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { AlertCircle, Trash2, Flag, FlagOff, Pencil } from 'lucide-react'
import { ChatDisplay } from '@/components/app-shell/ChatDisplay'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { useAppShellContext, usePendingPermission, usePendingCredential, useSessionOptionsFor, useSession as useSessionData } from '@/context/AppShellContext'
import { rendererPerf } from '@/lib/perf'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { StyledDropdownMenuItem, StyledDropdownMenuSeparator } from '@/components/ui/styled-dropdown'
import { routes } from '@/lib/navigate'
import { ensureSessionMessagesLoadedAtom, loadedSessionsAtom, sessionMetaMapAtom } from '@/atoms/sessions'
import { useTutorial } from '@/tutorial/TutorialContext'

export interface ChatPageProps {
  sessionId: string
}

const ChatPage = React.memo(function ChatPage({ sessionId }: ChatPageProps) {
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
    onRenameSession,
    onFlagSession,
    onDeleteSession,
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

  // Get pending permission and credential for this session
  const pendingPermission = usePendingPermission(sessionId)
  const pendingCredential = usePendingCredential(sessionId)

  // Tutorial context - check if sending should be disabled for current step
  const { currentStep } = useTutorial()
  const tutorialDisablesSend = currentStep?.disableSend ?? false

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

  // Get display title for header
  const displayTitle = session?.name || sessionMeta?.name || 'Chat'
  const isFlagged = session?.isFlagged || sessionMeta?.isFlagged || false

  // Session action handlers
  const handleRename = React.useCallback(() => {
    const newName = window.prompt('Rename chat', displayTitle)
    if (newName && newName !== displayTitle) {
      onRenameSession(sessionId, newName)
    }
  }, [sessionId, displayTitle, onRenameSession])

  const handleFlag = React.useCallback(() => {
    onFlagSession(sessionId)
  }, [sessionId, onFlagSession])

  const handleDelete = React.useCallback(async () => {
    await onDeleteSession(sessionId)
  }, [sessionId, onDeleteSession])

  // Build header menu for chat sessions
  const headerMenu = React.useMemo(() => (
    <HeaderMenu route={routes.view.allChats(sessionId)}>
      <StyledDropdownMenuItem onClick={handleRename}>
        <Pencil className="h-3.5 w-3.5" />
        <span className="flex-1">Rename</span>
      </StyledDropdownMenuItem>
      <StyledDropdownMenuItem onClick={handleFlag}>
        {isFlagged ? <FlagOff className="h-3.5 w-3.5" /> : <Flag className="h-3.5 w-3.5" />}
        <span className="flex-1">{isFlagged ? 'Unflag' : 'Flag'}</span>
      </StyledDropdownMenuItem>
      <StyledDropdownMenuSeparator />
      <StyledDropdownMenuItem onClick={handleDelete} variant="destructive">
        <Trash2 className="h-3.5 w-3.5" />
        <span className="flex-1">Delete</span>
      </StyledDropdownMenuItem>
    </HeaderMenu>
  ), [sessionId, isFlagged, handleRename, handleFlag, handleDelete])

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
        isFlagged: sessionMeta.isFlagged,
        workingDirectory: sessionMeta.workingDirectory,
        enabledSourceSlugs: sessionMeta.enabledSourceSlugs,
      }

      return (
        <div className="h-full flex flex-col">
          <PanelHeader title={displayTitle} actions={headerMenu} className="bg-surface-below" />
          <div className="flex-1 flex flex-col min-h-0">
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
              disableSend={tutorialDisablesSend}
            />
          </div>
        </div>
      )
    }

    // Session truly doesn't exist
    return (
      <div className="h-full flex flex-col">
        <PanelHeader title="Chat" className="bg-surface-below" />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <AlertCircle className="h-10 w-10" />
          <p className="text-sm">This session no longer exists</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title={displayTitle} actions={headerMenu} className="bg-surface-below" />
      <div className="flex-1 flex flex-col min-h-0">
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
          disableSend={tutorialDisablesSend}
        />
      </div>
    </div>
  )
})

export default ChatPage
