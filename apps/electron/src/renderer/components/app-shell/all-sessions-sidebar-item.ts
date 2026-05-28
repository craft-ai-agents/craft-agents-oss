import { Inbox } from "lucide-react"
import type { ReactNode } from "react"

import type { LinkItem, SidebarContextMenuConfig } from "./LeftSidebar"
import { ALL_SESSIONS_NAV_ITEM_ID } from "./sidebar-expanded-state"

interface CreateAllSessionsSidebarItemInput {
  title: string
  label: string
  isActive: boolean
  onClick: () => void
  isExpanded: boolean
  onToggle: () => void
  expandedContent: ReactNode
  contextMenu?: SidebarContextMenuConfig
}

/** Creates the expandable All Sessions sidebar item. */
export function createAllSessionsSidebarItem({
  title,
  label,
  isActive,
  onClick,
  isExpanded,
  onToggle,
  expandedContent,
  contextMenu,
}: CreateAllSessionsSidebarItemInput): LinkItem {
  return {
    id: ALL_SESSIONS_NAV_ITEM_ID,
    title,
    label,
    icon: Inbox,
    variant: isActive ? "default" : "ghost",
    onClick,
    expandable: true,
    expanded: isExpanded,
    onToggle,
    expandedContent,
    contextMenu,
  }
}
