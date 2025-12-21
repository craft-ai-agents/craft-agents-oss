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
import { useChatContext, usePendingPermission } from '@/context/ChatContext'
import { useAgentState } from '../../hooks/useAgentState'
import type { Tab, ChatTab } from '../types'
import { useTabs } from '../useTabs'

interface ChatTabPanelProps {
  tab: Tab
}

export default function ChatTabPanel({ tab }: ChatTabPanelProps) {
  const chatTab = tab as ChatTab
  const {
    sessions,
    currentModel,
    onSendMessage,
    onOpenFile,
    onOpenUrl,
    onModelChange,
    onRespondToPermission,
    textareaRef,
    // Advanced options
    ultrathinkEnabled,
    skipPermissions,
    onUltrathinkChange,
    onSkipPermissionsChange,
    // Input drafts
    sessionDrafts,
    onInputChange,
  } = useChatContext()

  const { closeTab, openAgentSetupTab, activeTabId } = useTabs()

  // Track if this tab is active
  const isActiveTab = activeTabId === chatTab.id

  // Local ref for THIS tab's textarea (not the shared one from context)
  const localTextareaRef = React.useRef<HTMLTextAreaElement | null>(null)

  // Global storage for caret positions per session and focus state
  type CaretState = { selectionStart: number; selectionEnd: number }
  type GlobalInputState = {
    __inputWasFocused?: boolean
    __caretPositions?: Map<string, CaretState>
  }
  const getGlobalState = () => window as unknown as GlobalInputState
  const getCaretPositions = () => {
    const state = getGlobalState()
    if (!state.__caretPositions) {
      state.__caretPositions = new Map()
    }
    return state.__caretPositions
  }

  // Capture local textarea ref from the DOM when this panel mounts/updates
  // We need our own ref because the shared textareaRef only points to one textarea at a time
  React.useEffect(() => {
    // Find the textarea within this panel's DOM
    const panel = document.querySelector(`[data-session-panel="${chatTab.sessionId}"]`)
    const textarea = panel?.querySelector('textarea') as HTMLTextAreaElement | null
    localTextareaRef.current = textarea
  })

  // Save caret position before switching away from this tab
  const prevIsActiveRef = React.useRef(isActiveTab)
  React.useEffect(() => {
    if (prevIsActiveRef.current && !isActiveTab && localTextareaRef.current) {
      const textarea = localTextareaRef.current
      getCaretPositions().set(chatTab.sessionId, {
        selectionStart: textarea.selectionStart,
        selectionEnd: textarea.selectionEnd,
      })
    }
    prevIsActiveRef.current = isActiveTab
  }, [isActiveTab, chatTab.sessionId])

  // Auto-focus textarea when switching to this tab if input was previously focused
  // Restore caret position or jump to end
  React.useEffect(() => {
    if (isActiveTab) {
      const wasInputFocused = getGlobalState().__inputWasFocused
      if (wasInputFocused) {
        // Use setTimeout to ensure the panel is visible and textarea is ready
        setTimeout(() => {
          const panel = document.querySelector(`[data-session-panel="${chatTab.sessionId}"]`)
          const textarea = panel?.querySelector('textarea') as HTMLTextAreaElement | null
          if (!textarea) return

          textarea.focus()

          // Restore saved caret position or jump to end of text
          const savedCaret = getCaretPositions().get(chatTab.sessionId)
          const textLength = textarea.value.length
          if (savedCaret && savedCaret.selectionEnd <= textLength) {
            textarea.setSelectionRange(savedCaret.selectionStart, savedCaret.selectionEnd)
          } else {
            // Jump to end if no saved position or text changed
            textarea.setSelectionRange(textLength, textLength)
          }
        }, 0)
      }
    }
  }, [isActiveTab, chatTab.sessionId])

  // Track when focus leaves/enters ANY textarea to persist across tab switches
  React.useEffect(() => {
    const handleFocusIn = (e: FocusEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'TEXTAREA') {
        getGlobalState().__inputWasFocused = true
      }
    }
    const handleFocusOut = (e: FocusEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'TEXTAREA') {
        const textarea = e.target as HTMLTextAreaElement
        // Save caret position for this session
        const panel = textarea.closest('[data-session-panel]')
        const sessionId = panel?.getAttribute('data-session-panel')
        if (sessionId) {
          getCaretPositions().set(sessionId, {
            selectionStart: textarea.selectionStart,
            selectionEnd: textarea.selectionEnd,
          })
        }

        // Only clear the focus flag if blur wasn't caused by clicking a tab or session
        const relatedTarget = e.relatedTarget as HTMLElement | null
        const isTabBarClick = relatedTarget?.closest('[data-tab-bar]') !== null
        const isSessionListClick = relatedTarget?.closest('[data-session-list]') !== null
        if (!isTabBarClick && !isSessionListClick) {
          getGlobalState().__inputWasFocused = false
        }
      }
    }

    document.addEventListener('focusin', handleFocusIn)
    document.addEventListener('focusout', handleFocusOut)

    return () => {
      document.removeEventListener('focusin', handleFocusIn)
      document.removeEventListener('focusout', handleFocusOut)
    }
  }, [])

  // Find the session for this tab - check early to avoid unnecessary hook calls
  const session = sessions.find((s) => s.id === chatTab.sessionId) || null

  // Get agent status from main process (source of truth)
  // Agent-scoped: keyed by (workspaceId, agentId), not sessionId
  // Pass null for agentId if session doesn't exist to avoid unnecessary IPC calls
  const agentState = useAgentState(
    session ? chatTab.workspaceId : null,
    session ? (chatTab.agentId || null) : null
  )

  // Get pending permission for this session
  const pendingPermission = usePendingPermission(chatTab.sessionId)

  // Get draft input value for this session
  const inputValue = sessionDrafts.get(chatTab.sessionId) ?? ''
  const handleInputChange = React.useCallback((value: string) => {
    onInputChange(chatTab.sessionId, value)
  }, [chatTab.sessionId, onInputChange])

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
    <div data-session-panel={chatTab.sessionId} className="h-full">
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
        agentSetupState={agentSetupState}
        // Advanced options
        ultrathinkEnabled={ultrathinkEnabled}
        onUltrathinkChange={onUltrathinkChange}
        skipPermissions={skipPermissions}
        onSkipPermissionsChange={onSkipPermissionsChange}
        // Input draft preservation
        inputValue={inputValue}
        onInputChange={handleInputChange}
      />
    </div>
  )
}
