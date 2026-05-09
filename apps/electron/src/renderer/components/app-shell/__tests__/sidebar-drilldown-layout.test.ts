import { describe, expect, test } from 'bun:test'
import { resolveSidebarDrilldownLayout } from '../sidebar-drilldown-layout'
import type { NavigationState } from '../../../../shared/types'

describe('resolveSidebarDrilldownLayout', () => {
  test('uses the session list width as the sidebar and hides the navigator in sessions mode', () => {
    const navState: NavigationState = {
      navigator: 'sessions',
      filter: { kind: 'allSessions' },
      details: null,
    }

    expect(resolveSidebarDrilldownLayout({
      navState,
      isAutoCompact: false,
      isSidebarAndNavigatorHidden: false,
      isSidebarVisible: true,
      sidebarWidth: 220,
      sessionListWidth: 300,
    })).toEqual({
      isDrilldown: true,
      sidebarWidth: 300,
      navigatorWidth: 0,
      showSidebarResizeHandle: true,
      showSessionListResizeHandle: false,
      isRightSidebarVisible: true,
    })
  })

  test('keeps the existing sidebar and navigator widths and hides the right sidebar outside sessions mode', () => {
    const navState: NavigationState = {
      navigator: 'sources',
      filter: undefined,
      details: null,
    }

    expect(resolveSidebarDrilldownLayout({
      navState,
      isAutoCompact: false,
      isSidebarAndNavigatorHidden: false,
      isSidebarVisible: true,
      sidebarWidth: 220,
      sessionListWidth: 300,
    })).toEqual({
      isDrilldown: false,
      sidebarWidth: 220,
      navigatorWidth: 300,
      showSidebarResizeHandle: true,
      showSessionListResizeHandle: true,
      isRightSidebarVisible: false,
    })
  })

  test('does not enter drilldown while compact mode has hidden the left panels', () => {
    const navState: NavigationState = {
      navigator: 'sessions',
      filter: { kind: 'allSessions' },
      details: null,
    }

    expect(resolveSidebarDrilldownLayout({
      navState,
      isAutoCompact: true,
      isSidebarAndNavigatorHidden: true,
      isSidebarVisible: true,
      sidebarWidth: 220,
      sessionListWidth: 300,
    })).toEqual({
      isDrilldown: false,
      sidebarWidth: 0,
      navigatorWidth: 0,
      showSidebarResizeHandle: false,
      showSessionListResizeHandle: false,
      isRightSidebarVisible: false,
    })
  })
})
