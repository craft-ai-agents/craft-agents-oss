/**
 * SidebarMenu - Shared menu content for sidebar navigation items
 *
 * Used by:
 * - LeftSidebar (context menu via right-click on nav items)
 * - AppShell (context menu for New Chat button)
 *
 * Uses MenuComponents context to render with either DropdownMenu or ContextMenu
 * primitives, allowing the same component to work in both scenarios.
 *
 * Provides actions based on the sidebar item type:
 * - "Configure Statuses" (for allChats/status/flagged items) - triggers EditPopover callback
 * - "Add Source" (for sources) - triggers EditPopover callback
 * - "Add Skill" (for skills) - triggers EditPopover callback
 * - "Open in New Window" (for newChat only) - uses deep link
 */

import * as React from 'react'
import {
  AppWindow,
  Settings2,
  Plus,
  ExternalLink,
} from 'lucide-react'
import { useMenuComponents } from '@/components/ui/menu-context'
import { getDocUrl, type DocFeature } from '@craft-agent/shared/docs/doc-links'

export type SidebarMenuType = 'allChats' | 'flagged' | 'status' | 'sources' | 'skills' | 'newChat'

export interface SidebarMenuProps {
  /** Type of sidebar item (determines available menu items) */
  type: SidebarMenuType
  /** Status ID for status items (e.g., 'todo', 'done') - not currently used but kept for future */
  statusId?: string
  /** Handler for "Configure Statuses" action - only for allChats/status/flagged types */
  onConfigureStatuses?: () => void
  /** Handler for "Add Source" action - only for sources type */
  onAddSource?: () => void
  /** Handler for "Add Skill" action - only for skills type */
  onAddSkill?: () => void
  /** Source type filter for "Learn More" link - determines which docs page to open */
  sourceType?: 'api' | 'mcp' | 'local'
}

/**
 * SidebarMenu - Renders the menu items for sidebar navigation actions
 * This is the content only, not wrapped in a DropdownMenu or ContextMenu
 */
export function SidebarMenu({
  type,
  statusId,
  onConfigureStatuses,
  onAddSource,
  onAddSkill,
  sourceType,
}: SidebarMenuProps) {
  // Get menu components from context (works with both DropdownMenu and ContextMenu)
  const { MenuItem, Separator } = useMenuComponents()

  // New Chat: only shows "Open in New Window"
  if (type === 'newChat') {
    return (
      <MenuItem onClick={() => window.electronAPI.openUrl('craftagents://action/new-chat?window=focused')}>
        <AppWindow className="h-3.5 w-3.5" />
        <span className="flex-1">Open in New Window</span>
      </MenuItem>
    )
  }

  // All Chats / Status / Flagged: show "Configure Statuses"
  if ((type === 'allChats' || type === 'status' || type === 'flagged') && onConfigureStatuses) {
    return (
      <MenuItem onClick={onConfigureStatuses}>
        <Settings2 className="h-3.5 w-3.5" />
        <span className="flex-1">Configure Statuses</span>
      </MenuItem>
    )
  }

  // Sources: show "Add Source" and "Learn More"
  if (type === 'sources') {
    // Determine which docs page to open based on source type filter
    const docFeature: DocFeature = sourceType
      ? `sources-${sourceType}` as DocFeature
      : 'sources'

    // Display label varies by source type
    const learnMoreLabel = sourceType === 'api'
      ? 'Learn More about APIs'
      : sourceType === 'mcp'
        ? 'Learn More about MCP'
        : sourceType === 'local'
          ? 'Learn More about Local Folders'
          : 'Learn More about Sources'

    return (
      <>
        {onAddSource && (
          <MenuItem onClick={onAddSource}>
            <Plus className="h-3.5 w-3.5" />
            <span className="flex-1">Add Source</span>
          </MenuItem>
        )}
        <Separator />
        <MenuItem onClick={() => window.electronAPI.openUrl(getDocUrl(docFeature))}>
          <ExternalLink className="h-3.5 w-3.5" />
          <span className="flex-1">{learnMoreLabel}</span>
        </MenuItem>
      </>
    )
  }

  // Skills: show "Add Skill"
  if (type === 'skills' && onAddSkill) {
    return (
      <MenuItem onClick={onAddSkill}>
        <Plus className="h-3.5 w-3.5" />
        <span className="flex-1">Add Skill</span>
      </MenuItem>
    )
  }

  // Fallback: return null if no handler provided (shouldn't happen)
  return null
}
