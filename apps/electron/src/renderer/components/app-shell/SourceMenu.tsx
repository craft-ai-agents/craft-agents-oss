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
import {
  Trash2,
  FolderOpen,
  AppWindow,
  ChevronRight,
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
  shareDestinations?: Array<{ key: string; label: string; description: string }>
  onShare?: (targetKey: string) => void
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
  shareDestinations = [],
  onShare,
  onDelete,
}: SourceMenuProps) {
  // Get menu components from context (works with both DropdownMenu and ContextMenu)
  const { MenuItem, Separator, Sub, SubTrigger, SubContent } = useMenuComponents()

  return (
    <>
      {/* Open in New Window */}
      <MenuItem onClick={onOpenInNewWindow}>
        <AppWindow className="h-3.5 w-3.5" />
        <span className="flex-1">Open in New Window</span>
      </MenuItem>

      {/* Show in file manager */}
      {onShowInFinder && (
        <MenuItem onClick={onShowInFinder}>
          <FolderOpen className="h-3.5 w-3.5" />
          <span className="flex-1">{`Show in ${getFileManagerName()}`}</span>
        </MenuItem>
      )}

      {shareDestinations.length > 0 && onShare && (
        <Sub>
          <SubTrigger>
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="flex-1">Share to…</span>
          </SubTrigger>
          <SubContent>
            {shareDestinations.map((target) => (
              <MenuItem key={target.key} onClick={() => onShare(target.key)}>
                <div className="flex min-w-0 flex-col">
                  <span>{target.label}</span>
                  <span className="text-xs text-muted-foreground">{target.description}</span>
                </div>
              </MenuItem>
            ))}
          </SubContent>
        </Sub>
      )}

      <Separator />

      {/* Delete */}
      <MenuItem onClick={onDelete} variant="destructive">
        <Trash2 className="h-3.5 w-3.5" />
        <span className="flex-1">Delete Source</span>
      </MenuItem>
    </>
  )
}
