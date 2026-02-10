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
 * - Show in Finder
 * - Delete
 */

import * as React from 'react'
import {
  Trash2,
  FolderOpen,
  AppWindow,
} from 'lucide-react'
import { useMenuComponents } from '@/components/ui/menu-context'
import { useTranslation } from 'react-i18next'
import { getSourceMenuLabels } from './source-menu-labels'

export interface SourceMenuProps {
  /** Source slug */
  sourceSlug: string
  /** Source name for display */
  sourceName: string
  /** Callbacks */
  onOpenInNewWindow: () => void
  onShowInFinder: () => void
  onDelete: () => void
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
}: SourceMenuProps) {
  const { t } = useTranslation(['common'])
  const labels = getSourceMenuLabels(t)
  void sourceSlug
  void sourceName

  // Get menu components from context (works with both DropdownMenu and ContextMenu)
  const { MenuItem, Separator } = useMenuComponents()

  return (
    <>
      {/* Open in New Window */}
      <MenuItem onClick={onOpenInNewWindow}>
        <AppWindow className="h-3.5 w-3.5" />
        <span className="flex-1">{labels.openInNewWindow}</span>
      </MenuItem>

      {/* Show in Finder */}
      <MenuItem onClick={onShowInFinder}>
        <FolderOpen className="h-3.5 w-3.5" />
        <span className="flex-1">{labels.showInFinder}</span>
      </MenuItem>

      <Separator />

      {/* Delete */}
      <MenuItem onClick={onDelete} variant="destructive">
        <Trash2 className="h-3.5 w-3.5" />
        <span className="flex-1">{labels.deleteSource}</span>
      </MenuItem>
    </>
  )
}
