/**
 * SkillMenu - Shared dropdown menu content for skill actions
 *
 * Used by:
 * - SkillsListPanel (item context menu)
 * - SkillInfoPage (title dropdown menu)
 *
 * Provides consistent skill actions:
 * - View Details (list only)
 * - Edit SKILL.md
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
  Pencil,
} from 'lucide-react'
import {
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from '@/components/ui/styled-dropdown'

export interface SkillMenuProps {
  /** Skill slug */
  skillSlug: string
  /** Skill name for display */
  skillName: string
  /** Whether to show "View Details" option (for list context, not detail page) */
  showViewDetails?: boolean
  /** Callbacks */
  onViewDetails?: () => void
  onEdit: () => void
  onOpenInNewWindow: () => void
  onShowInFinder: () => void
  onDelete: () => void
}

/**
 * SkillMenu - Renders the menu items for skill actions
 * This is the content only, not wrapped in a DropdownMenu
 */
export function SkillMenu({
  skillSlug,
  skillName,
  showViewDetails = false,
  onViewDetails,
  onEdit,
  onOpenInNewWindow,
  onShowInFinder,
  onDelete,
}: SkillMenuProps) {
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

      {/* Edit SKILL.md */}
      <StyledDropdownMenuItem onClick={onEdit}>
        <Pencil className="h-3.5 w-3.5" />
        <span className="flex-1">Edit SKILL.md</span>
      </StyledDropdownMenuItem>

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
        <span className="flex-1">Delete Skill</span>
      </StyledDropdownMenuItem>
    </>
  )
}
