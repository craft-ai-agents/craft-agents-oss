import { Inbox } from "lucide-react"
import type { ReactNode } from "react"

import type { LinkItem, SidebarContextMenuConfig } from "./LeftSidebar"

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
    id: "nav:allSessions",
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
