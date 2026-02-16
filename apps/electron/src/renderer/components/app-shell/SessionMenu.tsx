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
  Archive,
  ArchiveRestore,
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
  Tag,
} from 'lucide-react'
import { toast } from 'sonner'
import { useMenuComponents } from '@/components/ui/menu-context'
import { getStateColor, getStateIcon, type SessionStatusId } from '@/config/session-status-config'
import type { SessionStatus } from '@/config/session-status-config'
import type { LabelConfig } from '@craft-agent/shared/labels'
import { extractLabelId } from '@craft-agent/shared/labels'
import { LabelMenuItems, StatusMenuItems } from './SessionMenuParts'

export interface SessionMenuProps {
  /** Session ID */
  sessionId: string
  /** Session name for rename dialog */
  sessionName: string
  /** Whether session is flagged */
  isFlagged: boolean
  /** Whether session is archived */
  isArchived?: boolean
  /** Shared URL if session is shared */
  sharedUrl?: string | null
  /** Whether session has messages */
  hasMessages: boolean
  /** Whether session has unread messages */
  hasUnreadMessages: boolean
  /** Current todo state */
  currentSessionStatus: SessionStatusId
  /** Available todo states */
  sessionStatuses: SessionStatus[]
  /** Current labels applied to this session (e.g. ["bug", "priority::3"]) */
  sessionLabels?: string[]
  /** All available label configs (tree structure) for the labels submenu */
  labels?: LabelConfig[]
  /** Callback when labels are toggled (receives full updated labels array) */
  onLabelsChange?: (labels: string[]) => void
  /** Callbacks */
  onRename: () => void
  onFlag: () => void
  onUnflag: () => void
  onArchive: () => void
  onUnarchive: () => void
  onMarkUnread: () => void
  onSessionStatusChange: (state: SessionStatusId) => void
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
  isArchived = false,
  sharedUrl,
  hasMessages,
  hasUnreadMessages,
  currentSessionStatus,
  sessionStatuses,
  sessionLabels = [],
  labels = [],
  onLabelsChange,
  onRename,
  onFlag,
  onUnflag,
  onArchive,
  onUnarchive,
  onMarkUnread,
  onSessionStatusChange,
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
    if (result && 'success' in result && result.success) {
      toast.success('Share updated')
    } else {
      const errorMsg = result && 'error' in result ? result.error : undefined
      toast.error('Failed to update share', { description: errorMsg })
    }
  }

  const handleRevokeShare = async () => {
    const result = await window.electronAPI.sessionCommand(sessionId, { type: 'revokeShare' })
    if (result && 'success' in result && result.success) {
      toast.success('Sharing stopped')
    } else {
      const errorMsg = result && 'error' in result ? result.error : undefined
      toast.error('Failed to stop sharing', { description: errorMsg })
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

  // Set of currently applied label IDs (extracted from entries like "priority::3" → "priority")
  const appliedLabelIds = React.useMemo(
    () => new Set(sessionLabels.map(extractLabelId)),
    [sessionLabels]
  )

  // Toggle a label: add if not applied, remove if applied (by base ID)
  const handleLabelToggle = React.useCallback((labelId: string) => {
    if (!onLabelsChange) return
    const isApplied = appliedLabelIds.has(labelId)
    if (isApplied) {
      // Remove all entries matching this label ID (handles valued labels too)
      const updated = sessionLabels.filter(entry => extractLabelId(entry) !== labelId)
      onLabelsChange(updated)
    } else {
      // Add as a boolean label (just the ID, no value)
      onLabelsChange([...sessionLabels, labelId])
    }
  }, [sessionLabels, appliedLabelIds, onLabelsChange])

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
          <SubTrigger className="pr-2">
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
        <SubTrigger className="pr-2">
          <span style={{ color: getStateColor(currentSessionStatus, sessionStatuses) ?? 'var(--foreground)' }}>
            {(() => {
              const icon = getStateIcon(currentSessionStatus, sessionStatuses)
              return React.isValidElement(icon)
                ? React.cloneElement(icon as React.ReactElement<{ bare?: boolean }>, { bare: true })
                : icon
            })()}
          </span>
          <span className="flex-1">Status</span>
        </SubTrigger>
        <SubContent>
          <StatusMenuItems
            sessionStatuses={sessionStatuses}
            activeStateId={currentSessionStatus}
            onSelect={onSessionStatusChange}
            menu={{ MenuItem }}
          />
        </SubContent>
      </Sub>

      {/* Labels submenu - hierarchical label tree with nested sub-menus and toggle checkmarks */}
      {labels.length > 0 && (
        <Sub>
          <SubTrigger className="pr-2">
            <Tag className="h-3.5 w-3.5" />
            <span className="flex-1">Labels</span>
            {sessionLabels.length > 0 && (
              <span className="text-[10px] text-muted-foreground tabular-nums -mr-2.5">
                {sessionLabels.length}
              </span>
            )}
          </SubTrigger>
          <SubContent>
            <LabelMenuItems
              labels={labels}
              appliedLabelIds={appliedLabelIds}
              onToggle={handleLabelToggle}
              menu={{ MenuItem, Separator, Sub, SubTrigger, SubContent }}
            />
          </SubContent>
        </Sub>
      )}

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

      {/* Archive/Unarchive */}
      {!isArchived ? (
        <MenuItem onClick={onArchive}>
          <Archive className="h-3.5 w-3.5" />
          <span className="flex-1">Archive</span>
        </MenuItem>
      ) : (
        <MenuItem onClick={onUnarchive}>
          <ArchiveRestore className="h-3.5 w-3.5" />
          <span className="flex-1">Unarchive</span>
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

// LabelMenuItems now shared via SessionMenuParts
