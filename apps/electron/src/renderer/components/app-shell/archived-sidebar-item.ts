import { Archive } from 'lucide-react'
import type { LinkItem } from './LeftSidebar'

/** Sidebar item ID for the archived sessions entry. */
export const ARCHIVED_NAV_ID = 'nav:archived'

interface CreateArchivedSidebarItemInput {
  title: string
  label?: string
  isActive: boolean
  onClick: () => void
}

/** Creates the flat Archived sidebar item that opens the archived sessions view. */
export function createArchivedSidebarItem({
  title,
  label,
  isActive,
  onClick,
}: CreateArchivedSidebarItemInput): LinkItem {
  return {
    id: ARCHIVED_NAV_ID,
    title,
    ...(label !== undefined && { label }),
    icon: Archive,
    variant: isActive ? 'default' : 'ghost',
    onClick,
  }
}
