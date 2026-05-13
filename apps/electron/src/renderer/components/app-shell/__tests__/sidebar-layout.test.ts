import { describe, expect, test } from 'bun:test'
import { createAllSessionsSidebarItem } from '../all-sessions-sidebar-item'
import { resolveSidebarLayout } from '../sidebar-layout'
import type { NavigationState } from '../../../../shared/types'

describe('resolveSidebarLayout', () => {
  test('hides the navigator in all sessions mode when the list is embedded in the sidebar', () => {
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
      isAllSessionsExpanded: true,
    })).toEqual({
      sidebarWidth: 300,
      navigatorWidth: 0,
      showSidebarResizeHandle: true,
    })
  })

  test('keeps the sessions navigator visible when all sessions is collapsed', () => {
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
      isAllSessionsExpanded: false,
    })).toEqual({
      sidebarWidth: 300,
      navigatorWidth: 300,
      showSidebarResizeHandle: true,
    })
  })

  test('keeps the existing sidebar and navigator widths outside sessions mode', () => {
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
    })
  })

  test('creates all sessions as an expanded sidebar item with embedded content', () => {
    const onToggle = () => {}
    const expandedContent = 'session-list'

    const item = createAllSessionsSidebarItem({
      title: 'All Sessions',
      label: '3',
      isActive: true,
      onClick: () => {},
      isExpanded: true,
      onToggle,
      expandedContent,
      contextMenu: { type: 'allSessions' },
    })

    expect(item).toMatchObject({
      id: 'nav:allSessions',
      title: 'All Sessions',
      label: '3',
      variant: 'default',
    })
    expect(item.expandable).toBe(true)
    expect(item.expanded).toBe(true)
    expect(item.onToggle).toBe(onToggle)
    expect(item.expandedContent).toBe(expandedContent)
    expect(item.sortable).toBeUndefined()
    expect(item.items).toBeUndefined()
  })
})
