import { isSidebarDrilldownMode, type NavigationState } from '../../../shared/types'

/**
 * Returns true when the right sidebar should be mounted (sessions navigation only).
 */
export function resolveRightSidebarVisibility(navState: NavigationState): boolean {
  return isSidebarDrilldownMode(navState)
}
