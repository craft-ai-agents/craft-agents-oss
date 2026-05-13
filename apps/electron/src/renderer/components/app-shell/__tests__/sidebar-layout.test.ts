import { describe, expect, test } from 'bun:test'
import { createAllSessionsSidebarItem } from '../all-sessions-sidebar-item'
import { resolveSidebarLayout } from '../sidebar-layout'
import type { NavigationState } from '../../../../shared/types'

describe('resolveSidebarLayout', () => {
  test('keeps the wide sidebar and navigator visible in sessions mode', () => {
    const navState: NavigationState = {
      navigator: 'sessions',
      filter: { kind: 'allSessions' },
      details: null,
    }

    expect(resolveSidebarLayout({
      navState,
      isSidebarAndNavigatorHidden: false,
      isSidebarVisible: true,
      sidebarWidth: 300,
    })).toEqual({
      sidebarWidth: 300,
      navigatorWidth: 300,
      showSidebarResizeHandle: true,
      isRightSidebarVisible: true,
    })
  })

  test('keeps the existing sidebar and navigator widths and hides the right sidebar outside sessions mode', () => {
    const navState: NavigationState = {
      navigator: 'sources',
      filter: undefined,
      details: null,
    }

    expect(resolveSidebarLayout({
      navState,
      isSidebarAndNavigatorHidden: false,
      isSidebarVisible: true,
      sidebarWidth: 300,
    })).toEqual({
      sidebarWidth: 300,
      navigatorWidth: 300,
      showSidebarResizeHandle: true,
      isRightSidebarVisible: false,
    })
  })

  test('hides the left panels when compact mode has hidden them', () => {
    const navState: NavigationState = {
      navigator: 'sessions',
      filter: { kind: 'allSessions' },
      details: null,
    }

    expect(resolveSidebarLayout({
      navState,
      isSidebarAndNavigatorHidden: true,
      isSidebarVisible: true,
      sidebarWidth: 300,
    })).toEqual({
      sidebarWidth: 0,
      navigatorWidth: 0,
      showSidebarResizeHandle: false,
      isRightSidebarVisible: false,
    })
  })

  test('hides the middle navigator panel for skill marketplace navigation', () => {
    const navState: NavigationState = {
      navigator: 'skill-marketplace',
    }

    expect(resolveSidebarLayout({
      navState,
      isSidebarAndNavigatorHidden: false,
      isSidebarVisible: true,
      sidebarWidth: 300,
    })).toEqual({
      sidebarWidth: 300,
      navigatorWidth: 0,
      showSidebarResizeHandle: true,
      isRightSidebarVisible: false,
    })
  })

  test('creates all sessions as a flat sidebar item without expandable children', () => {
    const item = createAllSessionsSidebarItem({
      title: 'All Sessions',
      label: '3',
      isActive: true,
      onClick: () => {},
      contextMenu: { type: 'allSessions' },
    })

    expect(item).toMatchObject({
      id: 'nav:allSessions',
      title: 'All Sessions',
      label: '3',
      variant: 'default',
    })
    expect(item.expandable).toBeUndefined()
    expect(item.expanded).toBeUndefined()
    expect(item.onToggle).toBeUndefined()
    expect(item.sortable).toBeUndefined()
    expect(item.items).toBeUndefined()
  })
})
