import { isSidebarDrilldownMode, type NavigationState } from '../../../shared/types'

interface ResolveSidebarDrilldownLayoutInput {
  navState: NavigationState
  isAutoCompact: boolean
  isSidebarAndNavigatorHidden: boolean
  isSidebarVisible: boolean
  sidebarWidth: number
  sessionListWidth: number
}

interface SidebarDrilldownLayout {
  isDrilldown: boolean
  sidebarWidth: number
  navigatorWidth: number
  showSidebarResizeHandle: boolean
  showSessionListResizeHandle: boolean
}

export function resolveSidebarDrilldownLayout({
  navState,
  isAutoCompact,
  isSidebarAndNavigatorHidden,
  isSidebarVisible,
  sidebarWidth,
  sessionListWidth,
}: ResolveSidebarDrilldownLayoutInput): SidebarDrilldownLayout {
  const isDrilldown = isSidebarDrilldownMode(navState) && !isAutoCompact

  if (isSidebarAndNavigatorHidden) {
    return {
      isDrilldown,
      sidebarWidth: 0,
      navigatorWidth: 0,
      showSidebarResizeHandle: false,
      showSessionListResizeHandle: false,
    }
  }

  if (isDrilldown) {
    return {
      isDrilldown,
      sidebarWidth: isSidebarVisible ? sessionListWidth : 0,
      navigatorWidth: 0,
      showSidebarResizeHandle: true,
      showSessionListResizeHandle: false,
    }
  }

  return {
    isDrilldown,
    sidebarWidth: isSidebarVisible ? sidebarWidth : 0,
    navigatorWidth: sessionListWidth,
    showSidebarResizeHandle: true,
    showSessionListResizeHandle: true,
  }
}
