/**
 * WorkflowMenu - Shared menu content for workflow actions
 *
 * Used by:
 * - WorkflowsListPanel (dropdown via "..." button, context menu via right-click)
 * - WorkflowInfoPage (title dropdown menu)
 *
 * Uses MenuComponents context to render with either DropdownMenu or ContextMenu
 * primitives, allowing the same component to work in both scenarios.
 */

import * as React from 'react'
import {
  Trash2,
  FolderOpen,
  AppWindow,
} from 'lucide-react'
import { useMenuComponents } from '@/components/ui/menu-context'

export interface WorkflowMenuProps {
  /** Workflow slug */
  workflowSlug: string
  /** Workflow name for display */
  workflowName: string
  /** Callbacks */
  onOpenInNewWindow: () => void
  onShowInFinder: () => void
  onDelete: () => void
}

/**
 * WorkflowMenu - Renders the menu items for workflow actions
 * This is the content only, not wrapped in a DropdownMenu or ContextMenu
 */
export function WorkflowMenu({
  workflowSlug,
  workflowName,
  onOpenInNewWindow,
  onShowInFinder,
  onDelete,
}: WorkflowMenuProps) {
  const { MenuItem, Separator } = useMenuComponents()

  return (
    <>
      {/* Open in New Window */}
      <MenuItem onClick={onOpenInNewWindow}>
        <AppWindow className="h-3.5 w-3.5" />
        <span className="flex-1">Open in New Window</span>
      </MenuItem>

      {/* Show in Finder */}
      <MenuItem onClick={onShowInFinder}>
        <FolderOpen className="h-3.5 w-3.5" />
        <span className="flex-1">Show in Finder</span>
      </MenuItem>

      <Separator />

      {/* Delete */}
      <MenuItem onClick={onDelete} variant="destructive">
        <Trash2 className="h-3.5 w-3.5" />
        <span className="flex-1">Delete Workflow</span>
      </MenuItem>
    </>
  )
}
