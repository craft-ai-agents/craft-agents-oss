/**
 * SessionMenu - Shared menu content for session actions
 *
 * Used by:
 * - SessionList (dropdown via "..." button, context menu via right-click)
 * - ChatPage (title dropdown menu, desktop only — compact mode uses
 *   `CompactSessionMenu` which renders these same actions in a Drawer)
 *
 * Renders menu items via `useMenuComponents()` so the same content works
 * inside DropdownMenu or ContextMenu primitives. Side-effect handlers and
 * optimistic label state come from `useSessionMenuActions`, shared with
 * the compact-mode drawer to keep behaviour in one place.
 */

import * as React from 'react'
import { useTranslation } from "react-i18next"
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
  AppWindow,
  Columns2,
  CloudUpload,
  RefreshCw,
  Tag,
  Send,
} from 'lucide-react'
import { useMenuComponents } from '@/components/ui/menu-context'
import { getStateColor, getStateIcon, type SessionStatusId } from '@/config/session-status-config'
import type { SessionStatus } from '@/config/session-status-config'
import type { LabelConfig } from '@craft-agent/shared/labels'
import { LabelMenuItems, StatusMenuItems, ShareMenuItems } from './SessionMenuParts'
import { getFileManagerName } from '@/lib/platform'
import type { SessionMeta } from '@/atoms/sessions'
import { getSessionStatus, hasUnreadMeta, hasMessagesMeta } from '@/utils/session'
import { MessagingSessionMenuItem } from '@/components/messaging/MessagingSessionMenuItem'
import { useSessionMenuActions } from '@/hooks/useSessionMenuActions'

export interface SessionMenuProps {
  /** Session data — display state is derived from this */
  item: SessionMeta
  /** Available todo states */
  sessionStatuses: SessionStatus[]
  /** All available label configs (tree structure) for the labels submenu */
  labels?: LabelConfig[]
  /** Callback when labels are toggled (receives full updated labels array) */
  onLabelsChange?: (labels: string[]) => void
  /** Whether multiple workspaces exist (enables "Send to Workspace" item) */
  hasRemoteWorkspaces?: boolean
  /** Callbacks */
  onRename: () => void
  onFlag: () => void
  onUnflag: () => void
  onArchive: () => void
  onUnarchive: () => void
  onMarkUnread: () => void
  onSessionStatusChange: (state: SessionStatusId) => void
  onOpenInNewWindow: () => void
  onSendToWorkspace?: () => void
  onDelete: () => void
}

/**
 * SessionMenu - Renders the menu items for session actions
 * This is the content only, not wrapped in a DropdownMenu
 */
export function SessionMenu({
  item,
  sessionStatuses,
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
  onSendToWorkspace,
  onDelete,
  hasRemoteWorkspaces,
}: SessionMenuProps) {
  const { t } = useTranslation()

  const sessionId = item.id
  const isFlagged = item.isFlagged ?? false
  const isArchived = item.isArchived ?? false
  const sharedUrl = item.sharedUrl
  const currentSessionStatus = getSessionStatus(item)
  const sessionLabels = item.labels ?? []
  const _hasMessages = hasMessagesMeta(item)
  const _hasUnread = hasUnreadMeta(item)

  const actions = useSessionMenuActions({ item, onLabelsChange })

  // Get menu components from context (works with both DropdownMenu and ContextMenu)
  const { MenuItem, Separator, Sub, SubTrigger, SubContent } = useMenuComponents()

  return (
    <>
      {/* Share/Shared based on shared state */}
      {!sharedUrl ? (
        <MenuItem onClick={actions.share}>
          <CloudUpload className="h-3.5 w-3.5" />
          <span className="flex-1">{t("sessionMenu.share")}</span>
        </MenuItem>
      ) : (
        <Sub>
          <SubTrigger className="pr-2">
            <CloudUpload className="h-3.5 w-3.5" />
            <span className="flex-1">{t("sessionMenu.shared")}</span>
          </SubTrigger>
          <SubContent>
            <ShareMenuItems
              onOpenInBrowser={actions.openSharedInBrowser}
              onCopyLink={actions.copySharedLink}
              onUpdateShare={actions.updateShare}
              onRevokeShare={actions.revokeShare}
              menu={{ MenuItem, Separator }}
            />
          </SubContent>
        </Sub>
      )}

      {/* Send to Workspace — visible when at least one other workspace exists */}
      {hasRemoteWorkspaces && onSendToWorkspace && (
        <MenuItem onClick={onSendToWorkspace}>
          <Send className="h-3.5 w-3.5" />
          <span className="flex-1">{t("sessionMenu.sendToWorkspace")}</span>
        </MenuItem>
      )}

      {/* Connect to Messaging — pairing code flow */}
      <MessagingSessionMenuItem sessionId={sessionId} />

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
          <span className="flex-1">{t("sessionMenu.status")}</span>
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
            <span className="flex-1">{t("sessionMenu.labels")}</span>
            {sessionLabels.length > 0 && (
              <span className="text-[10px] text-muted-foreground tabular-nums -mr-2.5">
                {sessionLabels.length}
              </span>
            )}
          </SubTrigger>
          <SubContent>
            <LabelMenuItems
              labels={labels}
              appliedLabelIds={actions.appliedLabelIds}
              onToggle={actions.toggleLabel}
              menu={{ MenuItem, Separator, Sub, SubTrigger, SubContent }}
            />
          </SubContent>
        </Sub>
      )}

      {/* Flag/Unflag */}
      {!isFlagged ? (
        <MenuItem onClick={onFlag}>
          <Flag className="h-3.5 w-3.5 text-info" />
          <span className="flex-1">{t("sessionMenu.flag")}</span>
        </MenuItem>
      ) : (
        <MenuItem onClick={onUnflag}>
          <FlagOff className="h-3.5 w-3.5" />
          <span className="flex-1">{t("sessionMenu.unflag")}</span>
        </MenuItem>
      )}

      {/* Archive/Unarchive */}
      {!isArchived ? (
        <MenuItem onClick={onArchive}>
          <Archive className="h-3.5 w-3.5" />
          <span className="flex-1">{t("sessionMenu.archive")}</span>
        </MenuItem>
      ) : (
        <MenuItem onClick={onUnarchive}>
          <ArchiveRestore className="h-3.5 w-3.5" />
          <span className="flex-1">{t("sessionMenu.unarchive")}</span>
        </MenuItem>
      )}

      {/* Mark as Unread - only show if session has been read */}
      {!_hasUnread && _hasMessages && (
        <MenuItem onClick={onMarkUnread}>
          <MailOpen className="h-3.5 w-3.5" />
          <span className="flex-1">{t("sessionMenu.markAsUnread")}</span>
        </MenuItem>
      )}

      <Separator />

      {/* Rename */}
      <MenuItem onClick={onRename}>
        <Pencil className="h-3.5 w-3.5" />
        <span className="flex-1">{t("common.rename")}</span>
      </MenuItem>

      {/* Regenerate Title - AI-generate based on recent messages */}
      <MenuItem onClick={actions.refreshTitle}>
        <RefreshCw className="h-3.5 w-3.5" />
        <span className="flex-1">{t("sessionMenu.regenerateTitle")}</span>
      </MenuItem>

      <Separator />

      {/* Open in New Panel */}
      <MenuItem onClick={actions.openInNewPanel}>
        <Columns2 className="h-3.5 w-3.5" />
        <span className="flex-1">{t("sessionMenu.openInNewPanel")}</span>
      </MenuItem>

      {/* Open in New Window */}
      <MenuItem onClick={onOpenInNewWindow}>
        <AppWindow className="h-3.5 w-3.5" />
        <span className="flex-1">{t("sessionMenu.openInNewWindow")}</span>
      </MenuItem>

      {/* Show in file manager */}
      <MenuItem onClick={actions.showInFinder}>
        <FolderOpen className="h-3.5 w-3.5" />
        <span className="flex-1">{t("sessionMenu.showInFileManager", { fileManager: getFileManagerName() })}</span>
      </MenuItem>

      {/* Copy Path */}
      <MenuItem onClick={actions.copyPath}>
        <Copy className="h-3.5 w-3.5" />
        <span className="flex-1">{t("sessionMenu.copyPath")}</span>
      </MenuItem>

      <Separator />

      {/* Delete */}
      <MenuItem onClick={onDelete} variant="destructive">
        <Trash2 className="h-3.5 w-3.5" />
        <span className="flex-1">{t("common.delete")}</span>
      </MenuItem>
    </>
  )
}
