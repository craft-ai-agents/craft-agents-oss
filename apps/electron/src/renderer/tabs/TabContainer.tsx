/**
 * TabContainer Component
 *
 * Main container combining Header, TabBar, and TabContent.
 * Handles the overall layout of the tabbed panel system.
 */

import * as React from 'react'
import { useState } from 'react'
import {
  ExternalLink,
  Copy,
  MoreHorizontal,
  X,
  Pencil,
  Archive,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from '@/components/ui/styled-dropdown'
import { useChatContext } from '@/context/ChatContext'
import { getSessionTitle } from '@/utils/session'
import { TabBar } from './TabBar'
import { TabContent } from './TabContent'
import { useTabs } from './useTabs'
import type { Tab, FileTab, BrowserTab, ChatTab } from './types'

interface TabContainerProps {
  className?: string
}

export function TabContainer({ className }: TabContainerProps) {
  const { activeTab, tabs } = useTabs()
  const { sessions } = useChatContext()

  // Rename dialog state
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [renameName, setRenameName] = useState('')
  const [renameSessionId, setRenameSessionId] = useState<string | null>(null)

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
      case 'agent-setup':
        return `@${(tab as { agentId: string }).agentId}`
      case 'shortcuts':
        return 'Reference'
      case 'settings':
        return 'Preferences'
      case 'chat': {
        const session = getChatSession(tab)
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
        />
      )}
      {/* Tab bar - below header, only when multiple tabs */}
      <TabBar />
      {/* Content */}
      <TabContent className="flex-1 overflow-hidden" />

      {/* Rename Dialog */}
      <RenameDialog
        open={renameDialogOpen}
        onOpenChange={setRenameDialogOpen}
        sessionId={renameSessionId}
        name={renameName}
        onNameChange={setRenameName}
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
}

function TabHeader({ title, subtitle, tab, showAgentBadge, onOpenRename }: TabHeaderProps) {
  return (
    <div className="flex h-[50px] shrink-0 items-center pl-5 pr-2 min-w-0 gap-3 relative z-50 titlebar-no-drag">
      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold truncate font-sans leading-tight">{title}</h1>
          {showAgentBadge && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">Agent</Badge>
          )}
        </div>
        <p className="text-[11px] opacity-50 font-sans leading-tight truncate">{subtitle}</p>
      </div>
      <TabHeaderActions tab={tab} onOpenRename={onOpenRename} />
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
  const { closeTab } = useTabs()
  const { sessions, onArchiveSession, onDeleteSession } = useChatContext()

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

  const handleArchive = React.useCallback(() => {
    if (session) {
      onArchiveSession(session.id)
    }
  }, [session, onArchiveSession])

  const handleDelete = React.useCallback(() => {
    if (session) {
      onDeleteSession(session.id)
    }
  }, [session, onDeleteSession])

  const handleClose = React.useCallback(() => {
    closeTab(tab.id)
  }, [closeTab, tab.id])

  // Check if there are any type-specific actions
  const hasTypeActions = tab.type === 'file' || tab.type === 'browser' || tab.type === 'chat'

  // Only show menu if closable or has type actions
  if (!tab.closable && !hasTypeActions) {
    return null
  }

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
            <StyledDropdownMenuSeparator />
            {!session.isArchived && (
              <StyledDropdownMenuItem onClick={handleArchive}>
                <Archive />
                Archive
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

        {/* Separator before close if there are other actions */}
        {hasTypeActions && tab.closable && <StyledDropdownMenuSeparator />}

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

/**
 * Rename dialog component
 */
interface RenameDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionId: string | null
  name: string
  onNameChange: (name: string) => void
}

function RenameDialog({ open, onOpenChange, sessionId, name, onNameChange }: RenameDialogProps) {
  const { onRenameSession } = useChatContext()
  const { updateChatTabLabel } = useTabs()

  const handleSubmit = () => {
    if (sessionId && name.trim()) {
      onRenameSession(sessionId, name.trim())
      updateChatTabLabel(sessionId, name.trim())
    }
    onOpenChange(false)
    onNameChange('')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Rename conversation</DialogTitle>
        </DialogHeader>
        <div className="py-4">
          <Input
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Enter a name..."
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleSubmit()
              }
            }}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
