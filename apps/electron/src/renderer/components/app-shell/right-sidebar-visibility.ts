import { isSidebarDrilldownMode, type NavigationState } from '../../../shared/types'

export function resolveRightSidebarVisibility(navState: NavigationState): boolean {
  return isSidebarDrilldownMode(navState)
}
