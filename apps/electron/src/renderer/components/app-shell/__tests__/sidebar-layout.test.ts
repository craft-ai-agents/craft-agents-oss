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
    })).toEqual({
      sidebarWidth: 300,
      navigatorWidth: 0,
      showSidebarResizeHandle: true,
    })
  })

  test('keeps the sessions navigator hidden when all sessions is collapsed', () => {
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
      navigatorWidth: 0,
      showSidebarResizeHandle: true,
    })
  })

  test('keeps additive navigator slots beside the permanent sidebar for secondary workflows', () => {
    const navStates: NavigationState[] = [
      {
        navigator: 'sources',
        filter: undefined,
        details: null,
      },
      {
        navigator: 'local-skills',
        details: null,
      },
      {
        navigator: 'skill-marketplace',
      },
      {
        navigator: 'automations',
        filter: undefined,
        details: null,
      },
      {
        navigator: 'settings',
        subpage: null,
      },
      {
        navigator: 'archived',
        details: null,
      },
    ]

    for (const navState of navStates) {
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
    }
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
