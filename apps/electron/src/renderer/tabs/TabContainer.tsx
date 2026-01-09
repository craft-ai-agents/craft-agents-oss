/**
 * TabContainer Component
 *
 * Main container combining Header, TabBar, and TabContent.
 * Handles the overall layout of the tabbed panel system.
 */

import * as React from 'react'
import { useState, useEffect, useRef } from 'react'
import {
  ExternalLink,
  Copy,
  MoreHorizontal,
  X,
  Pencil,
  Archive,
  Trash2,
  FileDiff,
  AppWindow,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RenameDialog } from '@/components/ui/rename-dialog'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from '@/components/ui/styled-dropdown'
import { Separator } from '@/components/ui/separator'
import { useChatContext } from '@/context/ChatContext'
import { useCloseTab } from '@/hooks/useCloseTab'
import { getSessionTitle } from '@/utils/session'
import { TabBar } from './TabBar'
import { TabContent } from './TabContent'
import { useTabs } from './useTabs'
import type { Tab, FileTab, BrowserTab, ChatTab, AgentInfoTab, SourceInfoTab } from './types'
import type { FileChange } from '../../shared/types'

interface TabContainerProps {
  className?: string
  /** Initial tab for tab-content windows (standalone windows) */
  initialTab?: Tab | null
}

export function TabContainer({ className, initialTab }: TabContainerProps) {
  const { activeTab, isTabBarVisible, updateChatTabLabel, openTab, tabs } = useTabs()

  // Check if title is at min X position (tab-content windows need stoplight spacer)
  const isTitleAtMinXOfWindow = new URLSearchParams(window.location.search).get('mode') === 'tab-content'

  // Initialize with the initial tab (for tab-content windows)
  // Only run once on mount when initialTab is provided
  const initializedRef = useRef(false)
  useEffect(() => {
    if (initialTab && !initializedRef.current) {
      initializedRef.current = true
      // Only open if we don't already have tabs (fresh window)
      if (tabs.length === 0) {
        openTab(initialTab)
      }
    }
  }, [initialTab, openTab, tabs.length])
  const { sessions, onRenameSession } = useChatContext()
  const { closeTab } = useCloseTab()

  // Rename dialog state
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [renameName, setRenameName] = useState('')
  const [renameSessionId, setRenameSessionId] = useState<string | null>(null)

  // Handle rename submit
  const handleRenameSubmit = () => {
    if (renameSessionId && renameName.trim()) {
      onRenameSession(renameSessionId, renameName.trim())
      updateChatTabLabel(renameSessionId, renameName.trim())
    }
    setRenameDialogOpen(false)
    setRenameName('')
  }

  // Get session for chat tab
  const getChatSession = (tab: Tab) => {
    if (tab.type !== 'chat') return null
    const chatTab = tab as ChatTab
    return sessions.find((s) => s.id === chatTab.sessionId) || null
  }

  // Get title based on tab type
  const getTitle = (tab: Tab): string => {
    if (tab.type === 'chat') {
      const session = getChatSession(tab)
      return session ? getSessionTitle(session) : tab.label
    }
    return tab.label
  }

  // Get subtitle based on tab type
  const getSubtitle = (tab: Tab): string => {
    switch (tab.type) {
      case 'file':
        return (tab as FileTab).path
      case 'browser':
        return (tab as BrowserTab).url
      case 'agent-info':
        return 'Agent'
      case 'shortcuts':
        return 'Reference'
      case 'settings':
        return 'Preferences'
      case 'chat': {
        const session = getChatSession(tab)
        if (session?.agentName) {
          return `@${session.agentName}`
        }
        return session?.workspaceName || 'Conversation'
      }
      default:
        return ''
    }
  }

  // Check if chat tab has an agent
  const hasAgent = (tab: Tab): boolean => {
    if (tab.type !== 'chat') return false
    const session = getChatSession(tab)
    return !!session?.agentName
  }

  // Open rename dialog for session
  const handleOpenRename = (sessionId: string, currentName: string) => {
    setRenameSessionId(sessionId)
    setRenameName(currentName)
    setRenameDialogOpen(true)
  }

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header - matches session list header structure */}
      {activeTab && (
        <TabHeader
          title={getTitle(activeTab)}
          subtitle={getSubtitle(activeTab)}
          tab={activeTab}
          showAgentBadge={hasAgent(activeTab)}
          onOpenRename={handleOpenRename}
          isTitleAtMinXOfWindow={isTitleAtMinXOfWindow}
        />
      )}
      {/* Separator only when tab bar is hidden */}
      {!isTabBarVisible && <Separator />}
      {/* Tab bar - below header, only when multiple tabs */}
      <TabBar onClose={closeTab} />
      {/* Content */}
      <TabContent className="flex-1 overflow-hidden" />

      {/* Rename Dialog */}
      <RenameDialog
        open={renameDialogOpen}
        onOpenChange={setRenameDialogOpen}
        title="Rename conversation"
        value={renameName}
        onValueChange={setRenameName}
        onSubmit={handleRenameSubmit}
      />
    </div>
  )
}

interface TabHeaderProps {
  title: string
  subtitle: string
  tab: Tab
  showAgentBadge?: boolean
  onOpenRename?: (sessionId: string, currentName: string) => void
  /** When true, adds left padding for macOS stoplight buttons (70px) */
  isTitleAtMinXOfWindow?: boolean
}

function TabHeader({ title, subtitle, tab, showAgentBadge, onOpenRename, isTitleAtMinXOfWindow }: TabHeaderProps) {
  return (
    <div className="flex h-[50px] shrink-0 items-center pl-5 pr-2 min-w-0 gap-3 relative z-50">
      {/* Spacer for macOS stoplight buttons when title is at left edge */}
      {isTitleAtMinXOfWindow && <span className="w-[70px] shrink-0" />}
      <div className="flex-1 min-w-0 flex flex-col justify-center select-none">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold truncate font-sans leading-tight">{title}</h1>
          {showAgentBadge && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">Agent</Badge>
          )}
        </div>
        <p className="text-[11px] opacity-50 font-sans leading-tight truncate">{subtitle}</p>
      </div>
      <div className="titlebar-no-drag">
        <TabHeaderActions tab={tab} onOpenRename={onOpenRename} />
      </div>
    </div>
  )
}

interface TabHeaderActionsProps {
  tab: Tab
  onOpenRename?: (sessionId: string, currentName: string) => void
}

/**
 * Render actions dropdown menu for tab
 * Contains type-specific actions + Close tab at the bottom
 */
function TabHeaderActions({ tab, onOpenRename }: TabHeaderActionsProps) {
  const { closeTab } = useCloseTab()
  const { closeTab: rawCloseTab } = useTabs()
  const { sessions, onDeleteSession, onTodoStateChange, activeWorkspaceId } = useChatContext()

  // Get session for chat tab
  const session = tab.type === 'chat'
    ? sessions.find((s) => s.id === (tab as ChatTab).sessionId)
    : null

  const handleOpenExternal = React.useCallback(() => {
    if (tab.type === 'file') {
      window.electronAPI.openFile((tab as FileTab).path)
    } else if (tab.type === 'browser') {
      window.electronAPI.openUrl((tab as BrowserTab).url)
    }
  }, [tab])

  const handleCopyUrl = React.useCallback(async () => {
    if (tab.type === 'browser') {
      await navigator.clipboard.writeText((tab as BrowserTab).url)
    }
  }, [tab])

  const handleRename = React.useCallback(() => {
    if (session && onOpenRename) {
      onOpenRename(session.id, getSessionTitle(session))
    }
  }, [session, onOpenRename])

  const handleComplete = React.useCallback(() => {
    if (session) {
      onTodoStateChange(session.id, 'done')
    }
  }, [session, onTodoStateChange])

  const handleDelete = React.useCallback(() => {
    if (session) {
      // Close the tab immediately to prevent race conditions
      // (the session removal from state happens async, tab must close first)
      rawCloseTab(tab.id)
      onDeleteSession(session.id)
    }
  }, [session, onDeleteSession, rawCloseTab, tab.id])

  // Collect all Edit/Write activities from the session and open session diff view
  const handleViewAllChanges = React.useCallback(() => {
    if (!session) return

    // Collect all successful Edit/Write tool messages from session
    const changes: FileChange[] = []
    for (const m of session.messages) {
      if (m.role !== 'tool' || m.isError) continue
      const input = m.toolInput as Record<string, unknown> | undefined
      if (m.toolName === 'Edit' && input) {
        changes.push({
          id: m.id,
          filePath: (input.file_path as string) || 'unknown',
          toolType: 'Edit',
          original: (input.old_string as string) || '',
          modified: (input.new_string as string) || '',
        })
      } else if (m.toolName === 'Write' && input) {
        changes.push({
          id: m.id,
          filePath: (input.file_path as string) || 'unknown',
          toolType: 'Write',
          original: '',
          modified: (input.content as string) || '',
        })
      }
    }

    if (changes.length > 0) {
      window.electronAPI.openPreview({
        mode: 'multi-diff',
        sessionId: session.id,
        previewId: 'session', // Use 'session' as a special previewId for session-level view
        multiDiff: {
          turnId: 'session',
          changes,
        },
      })
    }
  }, [session])

  // Check if session has any Edit/Write activities
  const hasChanges = session?.messages.some(
    m => m.role === 'tool' && (m.toolName === 'Edit' || m.toolName === 'Write')
  ) ?? false

  const handleClose = React.useCallback(() => {
    closeTab(tab.id)
  }, [closeTab, tab.id])

  // Handle "Move to New Window" action
  const handleMoveToNewWindow = React.useCallback(() => {
    if (!activeWorkspaceId) return

    // Build tab params based on tab type
    const tabParams: Record<string, string> = {}

    switch (tab.type) {
      case 'chat': {
        const chatTab = tab as ChatTab
        tabParams.sessionId = chatTab.sessionId
        if (chatTab.agentId) tabParams.agentId = chatTab.agentId
        break
      }
      case 'agent-info': {
        const agentTab = tab as AgentInfoTab
        tabParams.agentId = agentTab.agentId
        break
      }
      case 'file': {
        const fileTab = tab as FileTab
        tabParams.path = fileTab.path
        break
      }
      case 'browser': {
        const browserTab = tab as BrowserTab
        tabParams.url = browserTab.url
        break
      }
      case 'source-info': {
        const sourceTab = tab as SourceInfoTab
        tabParams.sourceSlug = sourceTab.sourceSlug
        if (sourceTab.agentSlug) tabParams.agentSlug = sourceTab.agentSlug
        break
      }
      // settings, shortcuts, preferences don't need extra params
    }

    // Open in new window
    window.electronAPI.openTabContentWindow({
      workspaceId: activeWorkspaceId,
      tabType: tab.type,
      tabParams,
    })

    // Close the tab in the current window
    rawCloseTab(tab.id)
  }, [activeWorkspaceId, rawCloseTab, tab])

  // Check if there are any type-specific actions
  const hasTypeActions = tab.type === 'file' || tab.type === 'browser' || tab.type === 'chat'

  // Always show menu - at minimum we have "Move to New Window"
  // (previously only showed if closable or had type actions)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 rounded-[4px] titlebar-no-drag hover:bg-foreground/5 data-[state=open]:bg-foreground/5"
        >
          <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <StyledDropdownMenuContent align="end">
        {/* Chat tab actions */}
        {tab.type === 'chat' && session && (
          <>
            <StyledDropdownMenuItem onClick={handleRename}>
              <Pencil />
              Rename
            </StyledDropdownMenuItem>
            {hasChanges && (
              <StyledDropdownMenuItem onClick={handleViewAllChanges}>
                <FileDiff />
                View All Changes
              </StyledDropdownMenuItem>
            )}
            <StyledDropdownMenuSeparator />
            {session.todoState !== 'done' && session.todoState !== 'cancelled' && (
              <StyledDropdownMenuItem onClick={handleComplete}>
                <Archive />
                Mark Done
              </StyledDropdownMenuItem>
            )}
            <StyledDropdownMenuItem onClick={handleDelete} variant="destructive">
              <Trash2 />
              Delete
            </StyledDropdownMenuItem>
          </>
        )}

        {/* File tab actions */}
        {tab.type === 'file' && (
          <StyledDropdownMenuItem onClick={handleOpenExternal}>
            <ExternalLink />
            Open in default app
          </StyledDropdownMenuItem>
        )}

        {/* Browser tab actions */}
        {tab.type === 'browser' && (
          <>
            <StyledDropdownMenuItem onClick={handleCopyUrl}>
              <Copy />
              Copy URL
            </StyledDropdownMenuItem>
            <StyledDropdownMenuItem onClick={handleOpenExternal}>
              <ExternalLink />
              Open in browser
            </StyledDropdownMenuItem>
          </>
        )}

        {/* Separator before window/close actions if there are type-specific actions */}
        {hasTypeActions && <StyledDropdownMenuSeparator />}

        {/* Move to new window */}
        <StyledDropdownMenuItem onClick={handleMoveToNewWindow}>
          <AppWindow />
          Move to New Window
        </StyledDropdownMenuItem>

        {/* Close tab action */}
        {tab.closable && (
          <StyledDropdownMenuItem onClick={handleClose}>
            <X />
            Close tab
          </StyledDropdownMenuItem>
        )}
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}

