import { isSessionsNavigation, type NavigationState } from '../../../shared/types'

interface ResolveSidebarLayoutInput {
  navState: NavigationState
  isSidebarAndNavigatorHidden: boolean
  isSidebarVisible: boolean
  sidebarWidth: number
  isAllSessionsExpanded?: boolean
}

interface SidebarLayout {
  sidebarWidth: number
  navigatorWidth: number
  showSidebarResizeHandle: boolean
}

/**
 * Resolves the left-panel widths and resize handles.
 */
export function resolveSidebarLayout({
  navState,
  isSidebarAndNavigatorHidden,
  isSidebarVisible,
  sidebarWidth,
  isAllSessionsExpanded = false,
}: ResolveSidebarLayoutInput): SidebarLayout {
  if (isSidebarAndNavigatorHidden) {
    return {
      sidebarWidth: 0,
      navigatorWidth: 0,
      showSidebarResizeHandle: false,
    }
  }

  if (navState.navigator === 'skill-marketplace') {
    return {
      sidebarWidth: isSidebarVisible ? sidebarWidth : 0,
      navigatorWidth: 0,
      showSidebarResizeHandle: true,
    }
  }

  const embedsAllSessionsList =
    isSessionsNavigation(navState) &&
    navState.filter.kind === 'allSessions' &&
    isAllSessionsExpanded

  return {
    sidebarWidth: isSidebarVisible ? sidebarWidth : 0,
    navigatorWidth: embedsAllSessionsList ? 0 : sidebarWidth,
    showSidebarResizeHandle: true,
  }
}
