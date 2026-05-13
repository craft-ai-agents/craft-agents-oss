import { isSessionsNavigation, type NavigationState } from '../../../shared/types'

interface ResolveSidebarDrilldownLayoutInput {
  navState: NavigationState
  isAutoCompact: boolean
  isSidebarAndNavigatorHidden: boolean
  isSidebarVisible: boolean
  sidebarWidth: number
}

interface SidebarDrilldownLayout {
  isDrilldown: boolean
  sidebarWidth: number
  navigatorWidth: number
  showSidebarResizeHandle: boolean
  isRightSidebarVisible: boolean
}

/**
 * Resolves the left-panel widths, resize handles, and right-sidebar gate.
 */
export function resolveSidebarDrilldownLayout({
  navState,
  isSidebarAndNavigatorHidden,
  isSidebarVisible,
  sidebarWidth,
}: ResolveSidebarDrilldownLayoutInput): SidebarDrilldownLayout {
  const isDrilldown = false

  if (isSidebarAndNavigatorHidden) {
    return {
      isDrilldown,
      sidebarWidth: 0,
      navigatorWidth: 0,
      showSidebarResizeHandle: false,
      isRightSidebarVisible: false,
    }
  }

  if (navState.navigator === 'skill-marketplace') {
    return {
      isDrilldown,
      sidebarWidth: isSidebarVisible ? sidebarWidth : 0,
      navigatorWidth: 0,
      showSidebarResizeHandle: true,
      isRightSidebarVisible: false,
    }
  }

  return {
    isDrilldown,
    sidebarWidth: isSidebarVisible ? sidebarWidth : 0,
    navigatorWidth: sidebarWidth,
    showSidebarResizeHandle: true,
    isRightSidebarVisible: isSessionsNavigation(navState),
  }
}
