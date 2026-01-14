/**
 * SourceMenu - Shared dropdown menu content for source actions
 *
 * Used by:
 * - SourcesListPanel (item context menu)
 * - SourceInfoPage (title dropdown menu)
 *
 * Provides consistent source actions:
 * - View Details (list only)
 * - Open in New Window
 * - Show in Finder
 * - Delete
 */

import * as React from 'react'
import {
  Trash2,
  FolderOpen,
  ExternalLink,
  AppWindow,
} from 'lucide-react'
import {
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from '@/components/ui/styled-dropdown'

export interface SourceMenuProps {
  /** Source slug */
  sourceSlug: string
  /** Source name for display */
  sourceName: string
  /** Whether to show "View Details" option (for list context, not detail page) */
  showViewDetails?: boolean
  /** Callbacks */
  onViewDetails?: () => void
  onOpenInNewWindow: () => void
  onShowInFinder: () => void
  onDelete: () => void
}

/**
 * SourceMenu - Renders the menu items for source actions
 * This is the content only, not wrapped in a DropdownMenu
 */
export function SourceMenu({
  sourceSlug,
  sourceName,
  showViewDetails = false,
  onViewDetails,
  onOpenInNewWindow,
  onShowInFinder,
  onDelete,
}: SourceMenuProps) {
  return (
    <>
      {/* View Details - only shown in list context */}
      {showViewDetails && onViewDetails && (
        <>
          <StyledDropdownMenuItem onClick={onViewDetails}>
            <ExternalLink className="h-3.5 w-3.5" />
            <span className="flex-1">View Details</span>
          </StyledDropdownMenuItem>
          <StyledDropdownMenuSeparator />
        </>
      )}

      {/* Open in New Window */}
      <StyledDropdownMenuItem onClick={onOpenInNewWindow}>
        <AppWindow className="h-3.5 w-3.5" />
        <span className="flex-1">Open in New Window</span>
      </StyledDropdownMenuItem>

      <StyledDropdownMenuSeparator />

      {/* Show in Finder */}
      <StyledDropdownMenuItem onClick={onShowInFinder}>
        <FolderOpen className="h-3.5 w-3.5" />
        <span className="flex-1">Show in Finder</span>
      </StyledDropdownMenuItem>

      <StyledDropdownMenuSeparator />

      {/* Delete */}
      <StyledDropdownMenuItem onClick={onDelete} variant="destructive">
        <Trash2 className="h-3.5 w-3.5" />
        <span className="flex-1">Delete Source</span>
      </StyledDropdownMenuItem>
    </>
  )
}
