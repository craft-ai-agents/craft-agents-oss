/**
 * SessionMenu - Shared dropdown menu content for session actions
 *
 * Used by:
 * - SessionList (item context menu)
 * - ChatPage (title dropdown menu)
 *
 * Provides consistent session actions:
 * - Share / Shared submenu
 * - Status submenu
 * - Flag/Unflag
 * - Mark as Unread
 * - Rename
 * - Open in New Window
 * - View in Finder
 * - Delete
 */

import * as React from 'react'
import {
  Trash2,
  Pencil,
  Flag,
  FlagOff,
  MailOpen,
  FolderOpen,
  Copy,
  Link2Off,
  AppWindow,
  CloudUpload,
  Globe,
  RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn, isHexColor } from '@/lib/utils'
import {
  DropdownMenuSub,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
  StyledDropdownMenuSubTrigger,
  StyledDropdownMenuSubContent,
} from '@/components/ui/styled-dropdown'
import { getStateColor, getStateIcon, type TodoStateId } from '@/config/todo-states'
import type { TodoState } from '@/config/todo-states'
import { routes } from '@/contexts/NavigationContext'

export interface SessionMenuProps {
  /** Session ID */
  sessionId: string
  /** Session name for rename dialog */
  sessionName: string
  /** Whether session is flagged */
  isFlagged: boolean
  /** Shared URL if session is shared */
  sharedUrl?: string | null
  /** Whether session has messages */
  hasMessages: boolean
  /** Whether session has unread messages */
  hasUnreadMessages: boolean
  /** Current todo state */
  currentTodoState: TodoStateId
  /** Available todo states */
  todoStates: TodoState[]
  /** Callbacks */
  onRename: () => void
  onFlag: () => void
  onUnflag: () => void
  onMarkUnread: () => void
  onTodoStateChange: (state: TodoStateId) => void
  onOpenInNewWindow: () => void
  onDelete: () => void
}

/**
 * SessionMenu - Renders the menu items for session actions
 * This is the content only, not wrapped in a DropdownMenu
 */
export function SessionMenu({
  sessionId,
  sessionName,
  isFlagged,
  sharedUrl,
  hasMessages,
  hasUnreadMessages,
  currentTodoState,
  todoStates,
  onRename,
  onFlag,
  onUnflag,
  onMarkUnread,
  onTodoStateChange,
  onOpenInNewWindow,
  onDelete,
}: SessionMenuProps) {
  // Share handlers
  const handleShare = async () => {
    const result = await window.electronAPI.sessionCommand(sessionId, { type: 'shareToViewer' })
    if (result?.success && result.url) {
      await navigator.clipboard.writeText(result.url)
      toast.success('Link copied to clipboard', {
        description: result.url,
        action: {
          label: 'Open',
          onClick: () => window.electronAPI.openUrl(result.url!),
        },
      })
    } else {
      toast.error('Failed to share', { description: result?.error || 'Unknown error' })
    }
  }

  const handleOpenInBrowser = () => {
    if (sharedUrl) window.electronAPI.openUrl(sharedUrl)
  }

  const handleCopyLink = async () => {
    if (sharedUrl) {
      await navigator.clipboard.writeText(sharedUrl)
      toast.success('Link copied to clipboard')
    }
  }

  const handleUpdateShare = async () => {
    const result = await window.electronAPI.sessionCommand(sessionId, { type: 'updateShare' })
    if (result?.success) {
      toast.success('Share updated')
    } else {
      toast.error('Failed to update share', { description: result?.error })
    }
  }

  const handleRevokeShare = async () => {
    const result = await window.electronAPI.sessionCommand(sessionId, { type: 'revokeShare' })
    if (result?.success) {
      toast.success('Sharing stopped')
    } else {
      toast.error('Failed to stop sharing', { description: result?.error })
    }
  }

  const handleShowInFinder = () => {
    window.electronAPI.sessionCommand(sessionId, { type: 'showInFinder' })
  }

  return (
    <>
      {/* Share/Shared based on shared state */}
      {!sharedUrl ? (
        <StyledDropdownMenuItem onClick={handleShare}>
          <CloudUpload className="h-3.5 w-3.5" />
          <span className="flex-1">Share</span>
        </StyledDropdownMenuItem>
      ) : (
        <DropdownMenuSub>
          <StyledDropdownMenuSubTrigger>
            <CloudUpload className="h-3.5 w-3.5" />
            <span className="flex-1">Shared</span>
          </StyledDropdownMenuSubTrigger>
          <StyledDropdownMenuSubContent>
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
            <StyledDropdownMenuItem onClick={handleRevokeShare} variant="destructive">
              <Link2Off className="h-3.5 w-3.5" />
              <span className="flex-1">Stop Sharing</span>
            </StyledDropdownMenuItem>
          </StyledDropdownMenuSubContent>
        </DropdownMenuSub>
      )}
      <StyledDropdownMenuSeparator />

      {/* Status submenu */}
      <DropdownMenuSub>
        <StyledDropdownMenuSubTrigger>
          <span
            className={cn(
              'shrink-0 flex items-center justify-center -mt-px h-3.5 w-3.5',
              '[&>svg]:w-full [&>svg]:h-full [&>div>svg]:w-full [&>div>svg]:h-full [&>img]:w-full [&>img]:h-full',
              !isHexColor(getStateColor(currentTodoState, todoStates)) &&
                (getStateColor(currentTodoState, todoStates) || 'text-muted-foreground')
            )}
            style={
              isHexColor(getStateColor(currentTodoState, todoStates))
                ? { color: getStateColor(currentTodoState, todoStates) }
                : undefined
            }
          >
            {getStateIcon(currentTodoState, todoStates)}
          </span>
          <span className="flex-1">Status</span>
        </StyledDropdownMenuSubTrigger>
        <StyledDropdownMenuSubContent>
          {todoStates.map((state) => (
            <StyledDropdownMenuItem
              key={state.id}
              onClick={() => onTodoStateChange(state.id)}
              className={currentTodoState === state.id ? 'bg-foreground/5' : ''}
            >
              <span
                className={cn(
                  'shrink-0 flex items-center justify-center -mt-px h-3.5 w-3.5',
                  '[&>svg]:w-full [&>svg]:h-full [&>div>svg]:w-full [&>div>svg]:h-full [&>img]:w-full [&>img]:h-full',
                  !isHexColor(state.color) && state.color
                )}
                style={isHexColor(state.color) ? { color: state.color } : undefined}
              >
                {state.icon}
              </span>
              <span className="flex-1">{state.label}</span>
            </StyledDropdownMenuItem>
          ))}
        </StyledDropdownMenuSubContent>
      </DropdownMenuSub>

      {/* Flag/Unflag */}
      {!isFlagged ? (
        <StyledDropdownMenuItem onClick={onFlag}>
          <Flag className="h-3.5 w-3.5" />
          <span className="flex-1">Flag</span>
        </StyledDropdownMenuItem>
      ) : (
        <StyledDropdownMenuItem onClick={onUnflag}>
          <FlagOff className="h-3.5 w-3.5" />
          <span className="flex-1">Unflag</span>
        </StyledDropdownMenuItem>
      )}

      {/* Mark as Unread - only show if session has been read */}
      {!hasUnreadMessages && hasMessages && (
        <StyledDropdownMenuItem onClick={onMarkUnread}>
          <MailOpen className="h-3.5 w-3.5" />
          <span className="flex-1">Mark as Unread</span>
        </StyledDropdownMenuItem>
      )}

      <StyledDropdownMenuSeparator />

      {/* Rename */}
      <StyledDropdownMenuItem onClick={onRename}>
        <Pencil className="h-3.5 w-3.5" />
        <span className="flex-1">Rename</span>
      </StyledDropdownMenuItem>

      {/* Open in New Window */}
      <StyledDropdownMenuItem onClick={onOpenInNewWindow}>
        <AppWindow className="h-3.5 w-3.5" />
        <span className="flex-1">Open in New Window</span>
      </StyledDropdownMenuItem>

      <StyledDropdownMenuSeparator />

      {/* View in Finder */}
      <StyledDropdownMenuItem onClick={handleShowInFinder}>
        <FolderOpen className="h-3.5 w-3.5" />
        <span className="flex-1">View in Finder</span>
      </StyledDropdownMenuItem>

      <StyledDropdownMenuSeparator />

      {/* Delete */}
      <StyledDropdownMenuItem onClick={onDelete} variant="destructive">
        <Trash2 className="h-3.5 w-3.5" />
        <span className="flex-1">Delete</span>
      </StyledDropdownMenuItem>
    </>
  )
}
