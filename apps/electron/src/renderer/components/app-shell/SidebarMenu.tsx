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
  Trash2,
  ExternalLink,
} from 'lucide-react'
import { useMenuComponents } from '@/components/ui/menu-context'
import { getDocUrl, type DocFeature } from '@craft-agent/shared/docs/doc-links'

export type SidebarMenuType = 'allChats' | 'flagged' | 'status' | 'sources' | 'skills' | 'labels' | 'views' | 'newChat'

export interface SidebarMenuProps {
  /** Type of sidebar item (determines available menu items) */
  type: SidebarMenuType
  /** Status ID for status items (e.g., 'todo', 'done') - not currently used but kept for future */
  statusId?: string
  /** Label ID — when set, this is an individual label item (enables Delete Label) */
  labelId?: string
  /** Handler for "Configure Statuses" action - only for allChats/status/flagged types */
  onConfigureStatuses?: () => void
  /** Handler for "Configure Labels" action - receives labelId when triggered from a specific label */
  onConfigureLabels?: (labelId?: string) => void
  /** Handler for "Add New Label" action - creates a label (parentId = labelId if set) */
  onAddLabel?: (parentId?: string) => void
  /** Handler for "Delete Label" action - deletes the label identified by labelId */
  onDeleteLabel?: (labelId: string) => void
  /** Handler for "Add Source" action - only for sources type */
  onAddSource?: () => void
  /** Handler for "Add Skill" action - only for skills type */
  onAddSkill?: () => void
  /** Source type filter for "Learn More" link - determines which docs page to open */
  sourceType?: 'api' | 'mcp' | 'local'
  /** Handler for "Edit Views" action - for views type */
  onConfigureViews?: () => void
  /** View ID — when set, this is an individual view (enables Delete) */
  viewId?: string
  /** Handler for "Delete View" action */
  onDeleteView?: (id: string) => void
}

/**
 * SidebarMenu - Renders the menu items for sidebar navigation actions
 * This is the content only, not wrapped in a DropdownMenu or ContextMenu
 */
export function SidebarMenu({
  type,
  statusId,
  labelId,
  onConfigureStatuses,
  onConfigureLabels,
  onAddLabel,
  onDeleteLabel,
  onAddSource,
  onAddSkill,
  sourceType,
  onConfigureViews,
  viewId,
  onDeleteView,
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

  // Labels: show context-appropriate actions
  // - Header ("Labels" parent): Configure Labels + Add New Label
  // - Individual label items: Add New Label (as child) + Delete Label
  if (type === 'labels') {
    return (
      <>
        {onAddLabel && (
          <MenuItem onClick={() => onAddLabel(labelId)}>
            <Plus className="h-3.5 w-3.5" />
            <span className="flex-1">Add New Label</span>
          </MenuItem>
        )}
        {onConfigureLabels && (
          <MenuItem onClick={() => onConfigureLabels(labelId)}>
            <Settings2 className="h-3.5 w-3.5" />
            <span className="flex-1">Edit Labels</span>
          </MenuItem>
        )}
        {labelId && onDeleteLabel && (
          <>
            <Separator />
            <MenuItem onClick={() => onDeleteLabel(labelId)}>
              <Trash2 className="h-3.5 w-3.5" />
              <span className="flex-1">Delete Label</span>
            </MenuItem>
          </>
        )}
      </>
    )
  }

  // Views: show "Edit Views" and optionally "Delete View"
  if (type === 'views') {
    return (
      <>
        {onConfigureViews && (
          <MenuItem onClick={onConfigureViews}>
            <Settings2 className="h-3.5 w-3.5" />
            <span className="flex-1">Edit Views</span>
          </MenuItem>
        )}
        {viewId && onDeleteView && (
          <>
            <Separator />
            <MenuItem onClick={() => onDeleteView(viewId)}>
              <Trash2 className="h-3.5 w-3.5" />
              <span className="flex-1">Delete View</span>
            </MenuItem>
          </>
        )}
      </>
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
