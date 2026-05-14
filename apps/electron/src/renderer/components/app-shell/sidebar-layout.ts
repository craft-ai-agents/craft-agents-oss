import {
  isSessionsNavigation,
  isSkillMarketplaceNavigation,
  type NavigationState,
} from '../../../shared/types'

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
}

/**
 * Resolves the left-panel widths and resize handles.
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
    }
  }

  const hidesNavigator =
    isSkillMarketplaceNavigation(navState) ||
    (isSessionsNavigation(navState) &&
      navState.filter.kind === 'allSessions')

  return {
    sidebarWidth: isSidebarVisible ? sidebarWidth : 0,
    navigatorWidth: hidesNavigator ? 0 : sidebarWidth,
    showSidebarResizeHandle: true,
  }
}
