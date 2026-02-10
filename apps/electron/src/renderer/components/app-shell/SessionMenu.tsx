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
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
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
import { getStateColor, getStateIcon, type TodoStateId } from '@/config/todo-states'
import type { TodoState } from '@/config/todo-states'
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
  currentTodoState: TodoStateId
  /** Available todo states */
  todoStates: TodoState[]
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
  onTodoStateChange: (state: TodoStateId) => void
  onOpenInNewWindow: () => void
  onDelete: () => void
}

export function getSessionMenuLabels(t: TFunction) {
  return {
    menu: {
      share: t('common:menu.share'),
      shared: t('common:menu.shared'),
      openInBrowser: t('common:sessionList.share.openInBrowser'),
      copyLink: t('common:sessionList.share.copyLink'),
      updateShare: t('common:sessionList.share.updateShare'),
      stopSharing: t('common:sessionList.share.stopSharing'),
      status: t('common:menu.status'),
      labels: t('common:menu.labels'),
      flag: t('common:menu.flag'),
      unflag: t('common:menu.unflag'),
      markAsUnread: t('common:menu.markAsUnread'),
      rename: t('common:menu.rename'),
      regenerateTitle: t('common:menu.regenerateTitle'),
      openInNewWindow: t('common:menu.openInNewWindow'),
      showInFinder: t('common:menu.showInFinder'),
      copyPath: t('common:menu.copyPath'),
      delete: t('common:menu.delete'),
    },
    toast: {
      linkCopied: t('common:sessionList.share.linkCopied'),
      shareFailed: t('common:sessionMenu.shareFailed'),
      shareUpdated: t('common:sessionList.share.updated'),
      updateShareFailed: t('common:sessionList.share.updateFailed'),
      sharingStopped: t('common:sessionList.share.stopped'),
      stopSharingFailed: t('common:sessionList.share.stopFailed'),
      pathCopied: t('common:pathCopied'),
      titleRefreshed: t('common:sessionMenu.titleRefresh.success'),
      titleRefreshFailed: t('common:sessionMenu.titleRefresh.failed'),
      open: t('common:open'),
      unknownError: t('common:unknownError'),
    },
  }
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
  currentTodoState,
  todoStates,
  sessionLabels = [],
  labels = [],
  onLabelsChange,
  onRename,
  onFlag,
  onUnflag,
  onArchive,
  onUnarchive,
  onMarkUnread,
  onTodoStateChange,
  onOpenInNewWindow,
  onDelete,
}: SessionMenuProps) {
  const { t } = useTranslation(['common'])
  const i18nLabels = getSessionMenuLabels(t)
  void sessionName

  // Share handlers
  const handleShare = async () => {
    const result = await window.electronAPI.sessionCommand(sessionId, { type: 'shareToViewer' }) as { success: boolean; url?: string; error?: string } | undefined
    if (result?.success && result.url) {
      await navigator.clipboard.writeText(result.url)
      toast.success(i18nLabels.toast.linkCopied, {
        description: result.url,
        action: {
          label: i18nLabels.toast.open,
          onClick: () => window.electronAPI.openUrl(result.url!),
        },
      })
    } else {
      toast.error(i18nLabels.toast.shareFailed, { description: result?.error || i18nLabels.toast.unknownError })
    }
  }

  const handleOpenInBrowser = () => {
    if (sharedUrl) window.electronAPI.openUrl(sharedUrl)
  }

  const handleCopyLink = async () => {
    if (sharedUrl) {
      await navigator.clipboard.writeText(sharedUrl)
      toast.success(i18nLabels.toast.linkCopied)
    }
  }

  const handleUpdateShare = async () => {
    const result = await window.electronAPI.sessionCommand(sessionId, { type: 'updateShare' })
    if (result?.success) {
      toast.success(i18nLabels.toast.shareUpdated)
    } else {
      toast.error(i18nLabels.toast.updateShareFailed, { description: result?.error })
    }
  }

  const handleRevokeShare = async () => {
    const result = await window.electronAPI.sessionCommand(sessionId, { type: 'revokeShare' })
    if (result?.success) {
      toast.success(i18nLabels.toast.sharingStopped)
    } else {
      toast.error(i18nLabels.toast.stopSharingFailed, { description: result?.error })
    }
  }

  const handleShowInFinder = () => {
    window.electronAPI.sessionCommand(sessionId, { type: 'showInFinder' })
  }

  const handleCopyPath = async () => {
    const result = await window.electronAPI.sessionCommand(sessionId, { type: 'copyPath' }) as { success: boolean; path?: string } | undefined
    if (result?.success && result.path) {
      await navigator.clipboard.writeText(result.path)
      toast.success(i18nLabels.toast.pathCopied)
    }
  }

  const handleRefreshTitle = async () => {
    const result = await window.electronAPI.sessionCommand(sessionId, { type: 'refreshTitle' }) as { success: boolean; title?: string; error?: string } | undefined
    if (result?.success) {
      toast.success(i18nLabels.toast.titleRefreshed, { description: result.title })
    } else {
      toast.error(i18nLabels.toast.titleRefreshFailed, { description: result?.error || i18nLabels.toast.unknownError })
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
          <span className="flex-1">{i18nLabels.menu.share}</span>
        </MenuItem>
      ) : (
        <Sub>
          <SubTrigger className="pr-2">
            <CloudUpload className="h-3.5 w-3.5" />
            <span className="flex-1">{i18nLabels.menu.shared}</span>
          </SubTrigger>
          <SubContent>
            <MenuItem onClick={handleOpenInBrowser}>
              <Globe className="h-3.5 w-3.5" />
              <span className="flex-1">{i18nLabels.menu.openInBrowser}</span>
            </MenuItem>
            <MenuItem onClick={handleCopyLink}>
              <Copy className="h-3.5 w-3.5" />
              <span className="flex-1">{i18nLabels.menu.copyLink}</span>
            </MenuItem>
            <MenuItem onClick={handleUpdateShare}>
              <RefreshCw className="h-3.5 w-3.5" />
              <span className="flex-1">{i18nLabels.menu.updateShare}</span>
            </MenuItem>
            <MenuItem onClick={handleRevokeShare} variant="destructive">
              <Link2Off className="h-3.5 w-3.5" />
              <span className="flex-1">{i18nLabels.menu.stopSharing}</span>
            </MenuItem>
          </SubContent>
        </Sub>
      )}
      <Separator />

      {/* Status submenu - includes all statuses plus Flag/Unflag at the bottom */}
      <Sub>
        <SubTrigger className="pr-2">
          <span style={{ color: getStateColor(currentTodoState, todoStates) ?? 'var(--foreground)' }}>
            {(() => {
              const icon = getStateIcon(currentTodoState, todoStates)
              return React.isValidElement(icon)
                ? React.cloneElement(icon as React.ReactElement<{ bare?: boolean }>, { bare: true })
                : icon
            })()}
          </span>
          <span className="flex-1">{i18nLabels.menu.status}</span>
        </SubTrigger>
        <SubContent>
          <StatusMenuItems
            todoStates={todoStates}
            activeStateId={currentTodoState}
            onSelect={onTodoStateChange}
            menu={{ MenuItem }}
          />
        </SubContent>
      </Sub>

      {/* Labels submenu - hierarchical label tree with nested sub-menus and toggle checkmarks */}
      {labels.length > 0 && (
        <Sub>
          <SubTrigger className="pr-2">
            <Tag className="h-3.5 w-3.5" />
            <span className="flex-1">{i18nLabels.menu.labels}</span>
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
          <span className="flex-1">{i18nLabels.menu.flag}</span>
        </MenuItem>
      ) : (
        <MenuItem onClick={onUnflag}>
          <FlagOff className="h-3.5 w-3.5" />
          <span className="flex-1">{i18nLabels.menu.unflag}</span>
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
          <span className="flex-1">{i18nLabels.menu.markAsUnread}</span>
        </MenuItem>
      )}

      <Separator />

      {/* Rename */}
      <MenuItem onClick={onRename}>
        <Pencil className="h-3.5 w-3.5" />
        <span className="flex-1">{i18nLabels.menu.rename}</span>
      </MenuItem>

      {/* Regenerate Title - AI-generate based on recent messages */}
      <MenuItem onClick={handleRefreshTitle}>
        <RefreshCw className="h-3.5 w-3.5" />
        <span className="flex-1">{i18nLabels.menu.regenerateTitle}</span>
      </MenuItem>

      <Separator />

      {/* Open in New Window */}
      <MenuItem onClick={onOpenInNewWindow}>
        <AppWindow className="h-3.5 w-3.5" />
        <span className="flex-1">{i18nLabels.menu.openInNewWindow}</span>
      </MenuItem>

      {/* View in Finder */}
      <MenuItem onClick={handleShowInFinder}>
        <FolderOpen className="h-3.5 w-3.5" />
        <span className="flex-1">{i18nLabels.menu.showInFinder}</span>
      </MenuItem>

      {/* Copy Path */}
      <MenuItem onClick={handleCopyPath}>
        <Copy className="h-3.5 w-3.5" />
        <span className="flex-1">{i18nLabels.menu.copyPath}</span>
      </MenuItem>

      <Separator />

      {/* Delete */}
      <MenuItem onClick={onDelete} variant="destructive">
        <Trash2 className="h-3.5 w-3.5" />
        <span className="flex-1">{i18nLabels.menu.delete}</span>
      </MenuItem>
    </>
  )
}

// LabelMenuItems now shared via SessionMenuParts
