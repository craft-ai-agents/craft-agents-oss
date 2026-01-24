/**
 * SessionMenu - Shared menu content for session actions
 *
 * Used by:
 * - SessionList (dropdown via "..." button, context menu via right-click)
 * - ChatPage (title dropdown menu)
 *
 * Uses MenuComponents context to render with either DropdownMenu or ContextMenu
 * primitives, allowing the same component to work in both scenarios.
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
import { cn } from '@/lib/utils'
import { useMenuComponents } from '@/components/ui/menu-context'
import { getStateColor, getStateIcon, type TodoStateId } from '@/config/todo-states'
import type { TodoState } from '@/config/todo-states'

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
    const result = await window.electronAPI.sessionCommand(sessionId, { type: 'shareToViewer' }) as { success: boolean; url?: string; error?: string } | undefined
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

  const handleCopyPath = async () => {
    const result = await window.electronAPI.sessionCommand(sessionId, { type: 'copyPath' }) as { success: boolean; path?: string } | undefined
    if (result?.success && result.path) {
      await navigator.clipboard.writeText(result.path)
      toast.success('Path copied to clipboard')
    }
  }

  const handleRefreshTitle = async () => {
    const result = await window.electronAPI.sessionCommand(sessionId, { type: 'refreshTitle' }) as { success: boolean; title?: string; error?: string } | undefined
    if (result?.success) {
      toast.success('Title refreshed', { description: result.title })
    } else {
      toast.error('Failed to refresh title', { description: result?.error || 'Unknown error' })
    }
  }

  // Get menu components from context (works with both DropdownMenu and ContextMenu)
  const { MenuItem, Separator, Sub, SubTrigger, SubContent } = useMenuComponents()

  return (
    <>
      {/* Share/Shared based on shared state */}
      {!sharedUrl ? (
        <MenuItem onClick={handleShare}>
          <CloudUpload className="h-3.5 w-3.5" />
          <span className="flex-1">Share</span>
        </MenuItem>
      ) : (
        <Sub>
          <SubTrigger>
            <CloudUpload className="h-3.5 w-3.5" />
            <span className="flex-1">Shared</span>
          </SubTrigger>
          <SubContent>
            <MenuItem onClick={handleOpenInBrowser}>
              <Globe className="h-3.5 w-3.5" />
              <span className="flex-1">Open in Browser</span>
            </MenuItem>
            <MenuItem onClick={handleCopyLink}>
              <Copy className="h-3.5 w-3.5" />
              <span className="flex-1">Copy Link</span>
            </MenuItem>
            <MenuItem onClick={handleUpdateShare}>
              <RefreshCw className="h-3.5 w-3.5" />
              <span className="flex-1">Update Share</span>
            </MenuItem>
            <MenuItem onClick={handleRevokeShare} variant="destructive">
              <Link2Off className="h-3.5 w-3.5" />
              <span className="flex-1">Stop Sharing</span>
            </MenuItem>
          </SubContent>
        </Sub>
      )}
      <Separator />

      {/* Status submenu - includes all statuses plus Flag/Unflag at the bottom */}
      <Sub>
        <SubTrigger>
          <span
            className="shrink-0 flex items-center justify-center -mt-px h-3.5 w-3.5 [&>svg]:w-full [&>svg]:h-full [&>div>svg]:w-full [&>div>svg]:h-full [&>img]:w-full [&>img]:h-full"
            style={{ color: getStateColor(currentTodoState, todoStates) ?? 'var(--foreground)' }}
          >
            {getStateIcon(currentTodoState, todoStates)}
          </span>
          <span className="flex-1">Status</span>
        </SubTrigger>
        <SubContent>
          {todoStates.map((state) => {
            // Only apply color if icon is colorable (uses currentColor)
            const applyColor = state.iconColorable
            return (
              <MenuItem
                key={state.id}
                onClick={() => onTodoStateChange(state.id)}
                className={currentTodoState === state.id ? 'bg-foreground/5' : ''}
              >
                <span
                  className="shrink-0 flex items-center justify-center -mt-px h-3.5 w-3.5 [&>svg]:w-full [&>svg]:h-full [&>div>svg]:w-full [&>div>svg]:h-full [&>img]:w-full [&>img]:h-full"
                  style={applyColor ? { color: state.resolvedColor } : undefined}
                >
                  {state.icon}
                </span>
                <span className="flex-1">{state.label}</span>
              </MenuItem>
            )
          })}

        </SubContent>
      </Sub>

      {/* Flag/Unflag */}
      {!isFlagged ? (
        <MenuItem onClick={onFlag}>
          <Flag className="h-3.5 w-3.5 text-info" />
          <span className="flex-1">Flag</span>
        </MenuItem>
      ) : (
        <MenuItem onClick={onUnflag}>
          <FlagOff className="h-3.5 w-3.5" />
          <span className="flex-1">Unflag</span>
        </MenuItem>
      )}

      {/* Mark as Unread - only show if session has been read */}
      {!hasUnreadMessages && hasMessages && (
        <MenuItem onClick={onMarkUnread}>
          <MailOpen className="h-3.5 w-3.5" />
          <span className="flex-1">Mark as Unread</span>
        </MenuItem>
      )}

      <Separator />

      {/* Rename */}
      <MenuItem onClick={onRename}>
        <Pencil className="h-3.5 w-3.5" />
        <span className="flex-1">Rename</span>
      </MenuItem>

      {/* Regenerate Title - AI-generate based on recent messages */}
      <MenuItem onClick={handleRefreshTitle}>
        <RefreshCw className="h-3.5 w-3.5" />
        <span className="flex-1">Regenerate Title</span>
      </MenuItem>

      <Separator />

      {/* Open in New Window */}
      <MenuItem onClick={onOpenInNewWindow}>
        <AppWindow className="h-3.5 w-3.5" />
        <span className="flex-1">Open in New Window</span>
      </MenuItem>

      {/* View in Finder */}
      <MenuItem onClick={handleShowInFinder}>
        <FolderOpen className="h-3.5 w-3.5" />
        <span className="flex-1">View in Finder</span>
      </MenuItem>

      {/* Copy Path */}
      <MenuItem onClick={handleCopyPath}>
        <Copy className="h-3.5 w-3.5" />
        <span className="flex-1">Copy Path</span>
      </MenuItem>

      <Separator />

      {/* Delete */}
      <MenuItem onClick={onDelete} variant="destructive">
        <Trash2 className="h-3.5 w-3.5" />
        <span className="flex-1">Delete</span>
      </MenuItem>
    </>
  )
}
