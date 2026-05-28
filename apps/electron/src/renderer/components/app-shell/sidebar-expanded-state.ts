/** Navigation item ID for the All Sessions sidebar row. */
export const ALL_SESSIONS_NAV_ITEM_ID = 'nav:allSessions'

/** Creates the collapsed sidebar item set from persisted storage. */
export function createCollapsedSidebarItems(savedItems: string[] | null): Set<string> {
  return new Set(savedItems ?? [])
}

/** Returns whether a sidebar item should render expanded. */
export function isSidebarItemExpanded(
  collapsedItems: ReadonlySet<string>,
  itemId: string,
): boolean {
  return !collapsedItems.has(itemId)
}

/** Toggles one sidebar item in the collapsed item set. */
export function toggleCollapsedSidebarItem(
  collapsedItems: ReadonlySet<string>,
  itemId: string,
): Set<string> {
  const next = new Set(collapsedItems)
  if (next.has(itemId)) {
    next.delete(itemId)
  } else {
    next.add(itemId)
  }
  return next
}
