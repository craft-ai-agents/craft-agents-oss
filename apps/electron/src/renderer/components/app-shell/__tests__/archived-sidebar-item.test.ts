import { describe, expect, test } from 'bun:test'
import {
  createArchivedSidebarItem,
  ARCHIVED_NAV_ID,
} from '../archived-sidebar-item'

describe('createArchivedSidebarItem', () => {
  test('builds a flat top-level archived sidebar item', () => {
    const onClick = () => {}

    const item = createArchivedSidebarItem({
      title: 'Archived',
      label: '3',
      isActive: true,
      onClick,
    })

    expect(item.id).toBe(ARCHIVED_NAV_ID)
    expect(item).toMatchObject({
      title: 'Archived',
      label: '3',
      variant: 'default',
      onClick,
    })
    expect(item).not.toHaveProperty('expandable')
    expect(item).not.toHaveProperty('items')
  })

  test('renders ghost variant when not active', () => {
    const item = createArchivedSidebarItem({
      title: 'Archived',
      isActive: false,
      onClick: () => {},
    })

    expect(item.variant).toBe('ghost')
  })

  test('omits label when not provided', () => {
    const item = createArchivedSidebarItem({
      title: 'Archived',
      isActive: false,
      onClick: () => {},
    })

    expect(item).not.toHaveProperty('label')
  })
})
