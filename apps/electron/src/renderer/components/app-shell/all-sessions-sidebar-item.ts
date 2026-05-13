import { Inbox } from "lucide-react"

import type { LinkItem, SidebarContextMenuConfig } from "./LeftSidebar"

interface CreateAllSessionsSidebarItemInput {
  title: string
  label: string
  isActive: boolean
  onClick: () => void
  contextMenu?: SidebarContextMenuConfig
}

/** Creates the flat All Sessions sidebar item that opens session drill-down mode. */
export function createAllSessionsSidebarItem({
  title,
  label,
  isActive,
  onClick,
  contextMenu,
}: CreateAllSessionsSidebarItemInput): LinkItem {
  return {
    id: "nav:allSessions",
    title,
    label,
    icon: Inbox,
    variant: isActive ? "default" : "ghost",
    onClick,
    contextMenu,
  }
}
