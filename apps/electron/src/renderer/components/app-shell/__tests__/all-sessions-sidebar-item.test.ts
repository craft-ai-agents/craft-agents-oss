import { describe, expect, test } from 'bun:test'
import { createAllSessionsSidebarItem } from '../all-sessions-sidebar-item'
import {
  ALL_SESSIONS_NAV_ITEM_ID,
  createCollapsedSidebarItems,
  isSidebarItemExpanded,
  toggleCollapsedSidebarItem,
} from '../sidebar-expanded-state'

describe('createAllSessionsSidebarItem', () => {
  test('builds an expandable nav item that embeds the session list content', () => {
    const onClick = () => {}
    const onToggle = () => {}
    const expandedContent = 'embedded-session-list'

    const item = createAllSessionsSidebarItem({
      title: 'All Sessions',
      label: '3',
      isActive: true,
      onClick,
      isExpanded: true,
      onToggle,
      expandedContent,
      contextMenu: { type: 'allSessions' },
    })

    expect(item).toMatchObject({
      id: ALL_SESSIONS_NAV_ITEM_ID,
      title: 'All Sessions',
      label: '3',
      variant: 'default',
      onClick,
      expandable: true,
      expanded: true,
      onToggle,
      expandedContent,
      contextMenu: { type: 'allSessions' },
    })
    expect(item).not.toHaveProperty('items')
    expect(item).not.toHaveProperty('sortable')
  })

  test('defaults sidebar items to expanded when no collapsed preference exists', () => {
    const collapsedItems = createCollapsedSidebarItems(null)

    expect(isSidebarItemExpanded(collapsedItems, ALL_SESSIONS_NAV_ITEM_ID)).toBe(true)
  })

  test('restores persisted collapsed sidebar items', () => {
    const collapsedItems = createCollapsedSidebarItems([ALL_SESSIONS_NAV_ITEM_ID])

    expect(isSidebarItemExpanded(collapsedItems, ALL_SESSIONS_NAV_ITEM_ID)).toBe(false)
  })

  test('toggles collapsed sidebar items without mutating the previous set', () => {
    const collapsedItems = createCollapsedSidebarItems(null)
    const collapsed = toggleCollapsedSidebarItem(collapsedItems, ALL_SESSIONS_NAV_ITEM_ID)
    const expanded = toggleCollapsedSidebarItem(collapsed, ALL_SESSIONS_NAV_ITEM_ID)

    expect(isSidebarItemExpanded(collapsedItems, ALL_SESSIONS_NAV_ITEM_ID)).toBe(true)
    expect(isSidebarItemExpanded(collapsed, ALL_SESSIONS_NAV_ITEM_ID)).toBe(false)
    expect(isSidebarItemExpanded(expanded, ALL_SESSIONS_NAV_ITEM_ID)).toBe(true)
  })
})
