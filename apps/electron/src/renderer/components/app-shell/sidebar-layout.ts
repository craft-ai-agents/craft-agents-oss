import { isSessionsNavigation, type NavigationState } from '../../../shared/types'

interface ResolveSidebarLayoutInput {
  navState: NavigationState
  isSidebarAndNavigatorHidden: boolean
  isSidebarVisible: boolean
  sidebarWidth: number
}

interface SidebarLayout {
  sidebarWidth: number
  navigatorWidth: number
  showSidebarResizeHandle: boolean
  isRightSidebarVisible: boolean
}

/**
 * Resolves the left-panel widths, resize handles, and right-sidebar gate.
 */
export function resolveSidebarLayout({
  navState,
  isSidebarAndNavigatorHidden,
  isSidebarVisible,
  sidebarWidth,
}: ResolveSidebarLayoutInput): SidebarLayout {
  if (isSidebarAndNavigatorHidden) {
    return {
      sidebarWidth: 0,
      navigatorWidth: 0,
      showSidebarResizeHandle: false,
      isRightSidebarVisible: false,
    }
  }

  if (navState.navigator === 'skill-marketplace') {
    return {
      sidebarWidth: isSidebarVisible ? sidebarWidth : 0,
      navigatorWidth: 0,
      showSidebarResizeHandle: true,
      isRightSidebarVisible: false,
    }
  }

  return {
    sidebarWidth: isSidebarVisible ? sidebarWidth : 0,
    navigatorWidth: sidebarWidth,
    showSidebarResizeHandle: true,
    isRightSidebarVisible: isSessionsNavigation(navState),
  }
}
