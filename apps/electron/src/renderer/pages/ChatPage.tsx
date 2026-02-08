/**
 * ChatPage
 *
 * Displays a single session's chat with a consistent PanelHeader.
 * Extracted from MainContentPanel for consistency with other pages.
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { AlertCircle, Globe, Copy, RefreshCw, Link2Off, Info, ChevronDown, FolderOpen, Pin, Share } from 'lucide-react'
import { ChatDisplay, type ChatDisplayHandle } from '@/components/app-shell/ChatDisplay'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { SessionMenu } from '@/components/app-shell/SessionMenu'
import { RenameDialog } from '@/components/ui/rename-dialog'
import { toast } from 'sonner'
import { HeaderIconButton } from '@/components/ui/HeaderIconButton'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { StyledDropdownMenuContent, StyledDropdownMenuItem, StyledDropdownMenuSeparator } from '@/components/ui/styled-dropdown'
import { cn } from '@/lib/utils'
import type { AvailableApp } from '../../../shared/types'
import { useAppShellContext, usePendingPermission, usePendingCredential, useSessionOptionsFor, useSession as useSessionData } from '@/context/AppShellContext'
import { rendererPerf } from '@/lib/perf'
import { routes } from '@/lib/navigate'
import { ensureSessionMessagesLoadedAtom, loadedSessionsAtom, sessionMetaMapAtom } from '@/atoms/sessions'
import { getSessionTitle } from '@/utils/session'

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
    onRespondToPermission,
    onRespondToCredential,
    onMarkSessionRead,
    onMarkSessionUnread,
    onSetActiveViewingSession,
    textareaRef,
    getDraft,
    onInputChange,
    enabledSources,
    skills,
    labels,
    onSessionLabelsChange,
    enabledModes,
    todoStates,
    onSessionSourcesChange,
    onRenameSession,
    onFlagSession,
    onUnflagSession,
    onTodoStateChange,
    onDeleteSession,
    rightSidebarButton,
    sessionListSearchQuery,
    isSearchModeActive,
    chatDisplayRef,
    onChatMatchInfoChange,
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

  // Track window focus state for marking session as read when app regains focus
  const [isWindowFocused, setIsWindowFocused] = React.useState(true)
  React.useEffect(() => {
    window.electronAPI.getWindowFocusState().then(setIsWindowFocused)
    const cleanup = window.electronAPI.onWindowFocusChange(setIsWindowFocused)
    return cleanup
  }, [])

  // Track always-on-top (pin) state
  const [isPinned, setIsPinned] = React.useState(false)
  const pinRequestIdRef = React.useRef(0)
  React.useEffect(() => {
    window.electronAPI.getAlwaysOnTop().then(setIsPinned)
  }, [])

  const handleTogglePin = React.useCallback(() => {
    setIsPinned((prev) => {
      const next = !prev
      const requestId = ++pinRequestIdRef.current
      window.electronAPI.setAlwaysOnTop(next)
        .then((actual) => {
          if (pinRequestIdRef.current !== requestId) return
          if (actual === next) {
            setIsPinned(actual)
            return
          }
          setTimeout(() => {
            if (pinRequestIdRef.current !== requestId) return
            window.electronAPI.getAlwaysOnTop()
              .then((state) => {
                if (pinRequestIdRef.current === requestId) {
                  setIsPinned(state)
                }
              })
              .catch(() => {
                if (pinRequestIdRef.current === requestId) {
                  setIsPinned(prev)
                }
              })
          }, 120)
        })
        .catch(() => {
          if (pinRequestIdRef.current === requestId) {
            setIsPinned(prev)
          }
        })
      return next
    })
  }, [])

  // Track which session user is viewing (for unread state machine).
  // This tells main process user is looking at this session, so:
  // 1. If not processing → clear hasUnread immediately
  // 2. If processing → when it completes, main process will clear hasUnread
  // The main process handles all the logic; we just report viewing state.
  React.useEffect(() => {
    if (session && isWindowFocused) {
      onSetActiveViewingSession(session.id)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, isWindowFocused, onSetActiveViewingSession])

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

  // Session model change handler - persists per-session model
  const handleModelChange = React.useCallback((model: string) => {
    if (activeWorkspaceId) {
      window.electronAPI.setSessionModel(sessionId, activeWorkspaceId, model)
    }
  }, [sessionId, activeWorkspaceId])

  // Effective model for this session (session-specific or global fallback)
  const effectiveModel = session?.model || currentModel

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

  // Get display title for header - use getSessionTitle for consistent fallback logic with SessionList
  // Priority: name > first user message > preview > "New chat"
  const displayTitle = session ? getSessionTitle(session) : (sessionMeta ? getSessionTitle(sessionMeta) : 'Chat')
  const isFlagged = session?.isFlagged || sessionMeta?.isFlagged || false
  const sharedUrl = session?.sharedUrl || sessionMeta?.sharedUrl || null
  const currentTodoState = session?.todoState || sessionMeta?.todoState || 'todo'
  const hasMessages = !!(session?.messages?.length || sessionMeta?.lastFinalMessageId)
  const hasUnreadMessages = sessionMeta
    ? !!(sessionMeta.lastFinalMessageId && sessionMeta.lastFinalMessageId !== sessionMeta.lastReadMessageId)
    : false
  // Use isAsyncOperationOngoing for shimmer effect (sharing, updating share, revoking, title regeneration)
  const isAsyncOperationOngoing = session?.isAsyncOperationOngoing || sessionMeta?.isAsyncOperationOngoing || false

  // Rename dialog state
  const [renameDialogOpen, setRenameDialogOpen] = React.useState(false)
  const [renameName, setRenameName] = React.useState('')

  // Session action handlers
  const handleRename = React.useCallback(() => {
    setRenameName(displayTitle)
    setRenameDialogOpen(true)
  }, [displayTitle])

  const handleRenameSubmit = React.useCallback(() => {
    if (renameName.trim() && renameName.trim() !== displayTitle) {
      onRenameSession(sessionId, renameName.trim())
    }
    setRenameDialogOpen(false)
  }, [sessionId, renameName, displayTitle, onRenameSession])

  const handleFlag = React.useCallback(() => {
    onFlagSession(sessionId)
  }, [sessionId, onFlagSession])

  const handleUnflag = React.useCallback(() => {
    onUnflagSession(sessionId)
  }, [sessionId, onUnflagSession])

  const handleMarkUnread = React.useCallback(() => {
    onMarkSessionUnread(sessionId)
  }, [sessionId, onMarkSessionUnread])

  const handleTodoStateChange = React.useCallback((state: string) => {
    onTodoStateChange(sessionId, state)
  }, [sessionId, onTodoStateChange])

  const handleLabelsChange = React.useCallback((newLabels: string[]) => {
    onSessionLabelsChange?.(sessionId, newLabels)
  }, [sessionId, onSessionLabelsChange])

  const handleDelete = React.useCallback(async () => {
    await onDeleteSession(sessionId)
  }, [sessionId, onDeleteSession])

  const handleOpenInNewWindow = React.useCallback(async () => {
    const route = routes.view.allChats(sessionId)
    const separator = route.includes('?') ? '&' : '?'
    const url = `bunnyagents://${route}${separator}window=focused`
    try {
      await window.electronAPI?.openUrl(url)
    } catch (error) {
      console.error('[ChatPage] openUrl failed:', error)
    }
  }, [sessionId])

  // Share action handlers
  const handleShare = React.useCallback(async () => {
    const result = await window.electronAPI.sessionCommand(sessionId, { type: 'shareToViewer' }) as { success: boolean; url?: string; error?: string } | undefined
    if (result?.success && result.url) {
      await navigator.clipboard.writeText(result.url)
      toast.success('Link copied to clipboard', {
        description: result.url,
        action: { label: 'Open', onClick: () => window.electronAPI.openUrl(result.url!) },
      })
    } else {
      toast.error('Failed to share', { description: result?.error || 'Unknown error' })
    }
  }, [sessionId])

  const handleOpenInBrowser = React.useCallback(() => {
    if (sharedUrl) window.electronAPI.openUrl(sharedUrl)
  }, [sharedUrl])

  const handleCopyLink = React.useCallback(async () => {
    if (sharedUrl) {
      await navigator.clipboard.writeText(sharedUrl)
      toast.success('Link copied to clipboard')
    }
  }, [sharedUrl])

  const handleUpdateShare = React.useCallback(async () => {
    const result = await window.electronAPI.sessionCommand(sessionId, { type: 'updateShare' }) as { success: boolean; error?: string } | undefined
    if (result?.success) {
      toast.success('Share updated')
    } else {
      toast.error('Failed to update share', { description: result?.error })
    }
  }, [sessionId])

  const handleRevokeShare = React.useCallback(async () => {
    const result = await window.electronAPI.sessionCommand(sessionId, { type: 'revokeShare' }) as { success: boolean; error?: string } | undefined
    if (result?.success) {
      toast.success('Sharing stopped')
    } else {
      toast.error('Failed to stop sharing', { description: result?.error })
    }
  }, [sessionId])

  // Share button with dropdown menu rendered in PanelHeader actions slot
  const shareButton = React.useMemo(() => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <HeaderIconButton
          icon={<Share className={cn("h-4 w-4", sharedUrl && "fill-current")} />}
          className={sharedUrl ? 'text-accent' : 'text-foreground'}
        />
      </DropdownMenuTrigger>
      <StyledDropdownMenuContent align="end" sideOffset={8}>
        {sharedUrl ? (
          <>
            <StyledDropdownMenuItem onClick={handleOpenInBrowser}>
              <Globe className="h-3.5 w-3.5" />
              <span className="flex-1">Open in Browser</span>
            </StyledDropdownMenuItem>
            <StyledDropdownMenuItem onClick={handleCopyLink}>
              <Copy className="h-3.5 w-3.5" />
              <span className="flex-1">Copy Link</span>
            </StyledDropdownMenuItem>
            <StyledDropdownMenuItem onClick={handleUpdateShare}>
              <RefreshCw className="h-3.5 w-3.5" />
              <span className="flex-1">Update Share</span>
            </StyledDropdownMenuItem>
            <StyledDropdownMenuSeparator />
            <StyledDropdownMenuItem onClick={handleRevokeShare} variant="destructive">
              <Link2Off className="h-3.5 w-3.5" />
              <span className="flex-1">Stop Sharing</span>
            </StyledDropdownMenuItem>
            <StyledDropdownMenuSeparator />
            <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl('https://agents.craft.do/docs/go-further/sharing')}>
              <Info className="h-3.5 w-3.5" />
              <span className="flex-1">Learn More</span>
            </StyledDropdownMenuItem>
          </>
        ) : (
          <>
            <StyledDropdownMenuItem onClick={handleShare}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M8 8.53809C6.74209 8.60866 5.94798 8.80911 5.37868 9.37841C4.5 10.2571 4.5 11.6713 4.5 14.4997V15.4997C4.5 18.3282 4.5 19.7424 5.37868 20.6211C6.25736 21.4997 7.67157 21.4997 10.5 21.4997H13.5C16.3284 21.4997 17.7426 21.4997 18.6213 20.6211C19.5 19.7424 19.5 18.3282 19.5 15.4997V14.4997C19.5 11.6713 19.5 10.2571 18.6213 9.37841C18.052 8.80911 17.2579 8.60866 16 8.53809M12 14V3.5M9.5 5.5C9.99903 4.50411 10.6483 3.78875 11.5606 3.24093C11.7612 3.12053 11.8614 3.06033 12 3.06033C12.1386 3.06033 12.2388 3.12053 12.4394 3.24093C13.3517 3.78875 14.001 4.50411 14.5 5.5" />
              </svg>
              <span className="flex-1">Share Online</span>
            </StyledDropdownMenuItem>
            <StyledDropdownMenuSeparator />
            <StyledDropdownMenuItem onClick={() => window.electronAPI.openUrl('https://agents.craft.do/docs/go-further/sharing')}>
              <Info className="h-3.5 w-3.5" />
              <span className="flex-1">Learn More</span>
            </StyledDropdownMenuItem>
          </>
        )}
      </StyledDropdownMenuContent>
    </DropdownMenu>
  ), [sharedUrl, handleShare, handleOpenInBrowser, handleCopyLink, handleUpdateShare, handleRevokeShare])

  // Open In button for header - opens working directory in various apps
  const openInButton = React.useMemo(() => (
    <OpenInButton workingDirectory={workingDirectory} />
  ), [workingDirectory])

  // Pin button for always-on-top mode
  const pinButton = React.useMemo(() => (
    <HeaderIconButton
      icon={<Pin className={cn("h-4 w-4", isPinned && "fill-current")} />}
      onClick={handleTogglePin}

      className={cn('transition-none', isPinned ? 'text-accent hover:text-accent active:text-accent' : 'text-foreground hover:text-foreground')}
    />
  ), [isPinned, handleTogglePin])

  // Combine header actions: OpenIn button + Pin button + Share button
  const headerActions = React.useMemo(() => (
    <>
      {openInButton}
      {pinButton}
      {shareButton}
    </>
  ), [openInButton, pinButton, shareButton])

  // Build title menu content for chat sessions using shared SessionMenu
  const sessionLabels = session?.labels ?? []
  const titleMenu = React.useMemo(() => (
    <SessionMenu
      sessionId={sessionId}
      sessionName={displayTitle}
      isFlagged={isFlagged}
      sharedUrl={sharedUrl}
      hasMessages={hasMessages}
      hasUnreadMessages={hasUnreadMessages}
      currentTodoState={currentTodoState}
      todoStates={todoStates ?? []}
      sessionLabels={sessionLabels}
      labels={labels ?? []}
      onLabelsChange={handleLabelsChange}
      onRename={handleRename}
      onFlag={handleFlag}
      onUnflag={handleUnflag}
      onMarkUnread={handleMarkUnread}
      onTodoStateChange={handleTodoStateChange}
      onOpenInNewWindow={handleOpenInNewWindow}
      onDelete={handleDelete}
    />
  ), [
    sessionId,
    displayTitle,
    isFlagged,
    sharedUrl,
    hasMessages,
    hasUnreadMessages,
    currentTodoState,
    todoStates,
    sessionLabels,
    labels,
    handleLabelsChange,
    handleRename,
    handleFlag,
    handleUnflag,
    handleMarkUnread,
    handleTodoStateChange,
    handleOpenInNewWindow,
    handleDelete,
  ])

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
        <>
          <div className="h-full flex flex-col">
            <PanelHeader  title={displayTitle} titleMenu={titleMenu} actions={headerActions} rightSidebarButton={rightSidebarButton} isRegeneratingTitle={isAsyncOperationOngoing} />
            <div className="flex-1 flex flex-col min-h-0">
              <ChatDisplay
                ref={chatDisplayRef}
                session={skeletonSession}
                onSendMessage={() => {}}
                onOpenFile={handleOpenFile}
                onOpenUrl={handleOpenUrl}
                currentModel={effectiveModel}
                onModelChange={handleModelChange}
                textareaRef={textareaRef}
                pendingPermission={undefined}
                onRespondToPermission={onRespondToPermission}
                pendingCredential={undefined}
                onRespondToCredential={onRespondToCredential}
                thinkingLevel={sessionOpts.thinkingLevel}
                onThinkingLevelChange={(level) => setOption('thinkingLevel', level)}
                ultrathinkEnabled={sessionOpts.ultrathinkEnabled}
                onUltrathinkChange={(enabled) => setOption('ultrathinkEnabled', enabled)}
                permissionMode={sessionOpts.permissionMode}
                onPermissionModeChange={setPermissionMode}
                enabledModes={enabledModes}
                inputValue={inputValue}
                onInputChange={handleInputChange}
                sources={enabledSources}
                skills={skills}
                todoStates={todoStates}
                onTodoStateChange={handleTodoStateChange}
                workspaceId={activeWorkspaceId || undefined}
                onSourcesChange={(slugs) => onSessionSourcesChange?.(sessionId, slugs)}
                workingDirectory={sessionMeta.workingDirectory}
                onWorkingDirectoryChange={handleWorkingDirectoryChange}
                messagesLoading={true}
                searchQuery={sessionListSearchQuery}
                isSearchModeActive={isSearchModeActive}
                onMatchInfoChange={onChatMatchInfoChange}
              />
            </div>
          </div>
          <RenameDialog
            open={renameDialogOpen}
            onOpenChange={setRenameDialogOpen}
            title="Rename Chat"
            value={renameName}
            onValueChange={setRenameName}
            onSubmit={handleRenameSubmit}
            placeholder="Enter chat name..."
          />
        </>
      )
    }

    // Session truly doesn't exist
    return (
      <div className="h-full flex flex-col">
        <PanelHeader  title="Chat" rightSidebarButton={rightSidebarButton} />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <AlertCircle className="h-10 w-10" />
          <p className="text-sm">This session no longer exists</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="h-full flex flex-col">
        <PanelHeader  title={displayTitle} titleMenu={titleMenu} actions={headerActions} rightSidebarButton={rightSidebarButton} isRegeneratingTitle={isAsyncOperationOngoing} />
        <div className="flex-1 flex flex-col min-h-0">
          <ChatDisplay
            ref={chatDisplayRef}
            session={session}
            onSendMessage={(message, attachments, skillSlugs) => {
              if (session) {
                onSendMessage(session.id, message, attachments, skillSlugs)
              }
            }}
            onOpenFile={handleOpenFile}
            onOpenUrl={handleOpenUrl}
            currentModel={effectiveModel}
            onModelChange={handleModelChange}
            textareaRef={textareaRef}
            pendingPermission={pendingPermission}
            onRespondToPermission={onRespondToPermission}
            pendingCredential={pendingCredential}
            onRespondToCredential={onRespondToCredential}
            thinkingLevel={sessionOpts.thinkingLevel}
            onThinkingLevelChange={(level) => setOption('thinkingLevel', level)}
            ultrathinkEnabled={sessionOpts.ultrathinkEnabled}
            onUltrathinkChange={(enabled) => setOption('ultrathinkEnabled', enabled)}
            permissionMode={sessionOpts.permissionMode}
            onPermissionModeChange={setPermissionMode}
            enabledModes={enabledModes}
            inputValue={inputValue}
            onInputChange={handleInputChange}
            sources={enabledSources}
            skills={skills}
            labels={labels}
            onLabelsChange={(newLabels) => onSessionLabelsChange?.(sessionId, newLabels)}
            todoStates={todoStates}
            onTodoStateChange={handleTodoStateChange}
            workspaceId={activeWorkspaceId || undefined}
            onSourcesChange={(slugs) => onSessionSourcesChange?.(sessionId, slugs)}
            workingDirectory={workingDirectory}
            onWorkingDirectoryChange={handleWorkingDirectoryChange}
            sessionFolderPath={session?.sessionFolderPath}
            messagesLoading={!messagesLoaded}
            searchQuery={sessionListSearchQuery}
            isSearchModeActive={isSearchModeActive}
            onMatchInfoChange={onChatMatchInfoChange}
          />
        </div>
      </div>
      <RenameDialog
        open={renameDialogOpen}
        onOpenChange={setRenameDialogOpen}
        title="Rename Chat"
        value={renameName}
        onValueChange={setRenameName}
        onSubmit={handleRenameSubmit}
        placeholder="Enter chat name..."
      />
    </>
  )
})

/**
 * OpenInButton - Dropdown button to open working directory in various apps
 */
function OpenInButton({ workingDirectory }: { workingDirectory?: string }) {
  const [isOpen, setIsOpen] = React.useState(false)
  const [availableApps, setAvailableApps] = React.useState<AvailableApp[]>([])
  const [isLoading, setIsLoading] = React.useState(true)

  // Fetch available apps on mount (cached, don't refetch on every open)
  React.useEffect(() => {
    let cancelled = false

    if (!workingDirectory) {
      setAvailableApps([])
      setIsLoading(false)
      return
    }

    const promise = window.electronAPI?.getAvailableApps?.(workingDirectory)
    if (!promise) {
      setAvailableApps([])
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    promise
      .then(apps => {
        if (cancelled) return
        setAvailableApps(apps || [])
        setIsLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setAvailableApps([])
        setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [workingDirectory])

  const handleOpenWith = React.useCallback((appId: string) => {
    if (workingDirectory) {
      window.electronAPI?.openWithApp?.(workingDirectory, appId)
      setIsOpen(false)
    }
  }, [workingDirectory])

  // Handle keyboard shortcuts (1-9 for quick selection)
  React.useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key
      if (key >= '1' && key <= '9') {
        const index = parseInt(key) - 1
        if (index < availableApps.length) {
          e.preventDefault()
          handleOpenWith(availableApps[index].id)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, availableApps, handleOpenWith])

  if (!workingDirectory) return null

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <HeaderIconButton
          icon={<FolderOpen className="h-4 w-4" />}
          className={cn("text-foreground/70", isOpen && "bg-foreground/5")}
        />
      </DropdownMenuTrigger>
      <StyledDropdownMenuContent side="bottom" align="end" sideOffset={8} className="min-w-[200px]">
        {availableApps.map((app, index) => (
          <StyledDropdownMenuItem
            key={app.id}
            onClick={() => handleOpenWith(app.id)}
          >
            <span className="w-5 text-muted-foreground text-[12px] tabular-nums">{index + 1}</span>
            <span className="flex-1">{app.name}</span>
          </StyledDropdownMenuItem>
        ))}
        {isLoading && (
          <div className="px-3 py-2 text-sm text-muted-foreground">Loading...</div>
        )}
        {!isLoading && availableApps.length === 0 && (
          <div className="px-3 py-2 text-sm text-muted-foreground">No apps found</div>
        )}
        <StyledDropdownMenuSeparator />
        <StyledDropdownMenuItem
          onClick={() => {
            if (workingDirectory) {
              navigator.clipboard.writeText(workingDirectory)
              setIsOpen(false)
            }
          }}
        >
          <Copy className="w-5 h-3.5 text-muted-foreground" />
          <span className="flex-1">Copy path</span>
          <span className="text-muted-foreground text-[12px]">⌘⇧C</span>
        </StyledDropdownMenuItem>
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}

export default ChatPage
