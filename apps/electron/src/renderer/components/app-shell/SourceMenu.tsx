/**
 * SourceMenu - Shared menu content for source actions
 *
 * Used by:
 * - SourcesListPanel (dropdown via "..." button, context menu via right-click)
 * - SourceInfoPage (title dropdown menu)
 *
 * Uses MenuComponents context to render with either DropdownMenu or ContextMenu
 * primitives, allowing the same component to work in both scenarios.
 *
 * Provides consistent source actions:
 * - Open in New Window
 * - Show in file manager
 * - Delete
 */

import * as React from 'react'
import { useTranslation } from "react-i18next"
import {
  Trash2,
  FolderOpen,
  AppWindow,
  Send,
  Cloud,
  CloudOff,
  UploadCloud,
  KeyRound,
  RotateCcwKey,
} from 'lucide-react'
import { useMenuComponents } from '@/components/ui/menu-context'
import { getFileManagerName } from '@/lib/platform'

export interface SourceMenuProps {
  /** Source slug */
  sourceSlug: string
  /** Source name for display */
  sourceName: string
  /** Callbacks */
  onOpenInNewWindow: () => void
  onShowInFinder?: () => void
  onDelete: () => void
  /** Send to another workspace (omit to hide the option) */
  onSendToWorkspace?: () => void
  onActivateGlobal?: () => void
  onDeactivateGlobal?: () => void
  onPromoteToGlobal?: () => void
  onSetGlobalCredentials?: () => void
  onUseWorkspaceCredentials?: () => void
  onRevertGlobalCredentials?: () => void
  canDelete?: boolean
  deleteLabel?: string
}

/**
 * SourceMenu - Renders the menu items for source actions
 * This is the content only, not wrapped in a DropdownMenu or ContextMenu
 */
export function SourceMenu({
  sourceSlug,
  sourceName,
  onOpenInNewWindow,
  onShowInFinder,
  onDelete,
  onSendToWorkspace,
  onActivateGlobal,
  onDeactivateGlobal,
  onPromoteToGlobal,
  onSetGlobalCredentials,
  onUseWorkspaceCredentials,
  onRevertGlobalCredentials,
  canDelete = true,
  deleteLabel,
}: SourceMenuProps) {
  const { t } = useTranslation()

  // Get menu components from context (works with both DropdownMenu and ContextMenu)
  const { MenuItem, Separator } = useMenuComponents()

  return (
    <>
      {/* Open in New Window */}
      <MenuItem onClick={onOpenInNewWindow}>
        <AppWindow className="h-3.5 w-3.5" />
        <span className="flex-1">{t("sidebarMenu.openInNewWindow")}</span>
      </MenuItem>

      {/* Show in file manager */}
      {onShowInFinder && (
        <MenuItem onClick={onShowInFinder}>
          <FolderOpen className="h-3.5 w-3.5" />
          <span className="flex-1">{t("sessionMenu.showInFileManager", { fileManager: getFileManagerName() })}</span>
        </MenuItem>
      )}

      {/* Send to another workspace */}
      {onSendToWorkspace && (
        <MenuItem onClick={onSendToWorkspace}>
          <Send className="h-3.5 w-3.5" />
          <span className="flex-1">{t("sessionMenu.sendToWorkspace")}</span>
        </MenuItem>
      )}

      {onActivateGlobal && (
        <MenuItem onClick={onActivateGlobal}>
          <Cloud className="h-3.5 w-3.5" />
          <span className="flex-1">{t("sourcesList.activate")}</span>
        </MenuItem>
      )}

      {onDeactivateGlobal && (
        <MenuItem onClick={onDeactivateGlobal}>
          <CloudOff className="h-3.5 w-3.5" />
          <span className="flex-1">{t("sourcesList.deactivate")}</span>
        </MenuItem>
      )}

      {onPromoteToGlobal && (
        <MenuItem onClick={onPromoteToGlobal}>
          <UploadCloud className="h-3.5 w-3.5" />
          <span className="flex-1">{t("sourcesList.promote")}</span>
        </MenuItem>
      )}

      {onSetGlobalCredentials && (
        <MenuItem onClick={onSetGlobalCredentials}>
          <KeyRound className="h-3.5 w-3.5" />
          <span className="flex-1">{t("sourceInfo.setGlobalCredentials")}</span>
        </MenuItem>
      )}

      {onUseWorkspaceCredentials && (
        <MenuItem onClick={onUseWorkspaceCredentials}>
          <KeyRound className="h-3.5 w-3.5" />
          <span className="flex-1">{t("sourceInfo.useWorkspaceCredentials")}</span>
        </MenuItem>
      )}

      {onRevertGlobalCredentials && (
        <MenuItem onClick={onRevertGlobalCredentials}>
          <RotateCcwKey className="h-3.5 w-3.5" />
          <span className="flex-1">{t("sourceInfo.revertGlobalCredentials")}</span>
        </MenuItem>
      )}

      <Separator />

      {/* Delete */}
      <MenuItem onClick={onDelete} variant={canDelete ? "destructive" : undefined} disabled={!canDelete}>
        <Trash2 className="h-3.5 w-3.5" />
        <span className="flex-1">{deleteLabel ?? t("sidebarMenu.deleteSource")}</span>
      </MenuItem>
    </>
  )
}
