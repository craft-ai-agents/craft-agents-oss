import * as storage from '@/lib/local-storage'
import type { NavigationState } from '../../../shared/types'

/** Loads the workspace-scoped right sidebar open preference. */
export function loadRightSidebarOpenPreference(workspaceId?: string): boolean {
  return storage.get(storage.KEYS.rightSidebarVisible, true, workspaceId)
}

/** Persists the workspace-scoped right sidebar open preference. */
export function persistRightSidebarOpenPreference(isOpen: boolean, workspaceId?: string): void {
  storage.set(storage.KEYS.rightSidebarVisible, isOpen, workspaceId)
}

/** Resolves whether the panel stack should reserve the right edge for the sidebar. */
export function resolvePanelStackRightSidebarVisible(
  isContextuallyAvailable: boolean,
  isOpen: boolean,
): boolean {
  return isContextuallyAvailable && isOpen
}

/** Resolves whether active-session contextual panels are available. */
export function resolveRightSidebarContextualAvailability({
  activeSessionId,
  navState,
}: {
  activeSessionId?: string | null
  navState: NavigationState
}): boolean {
  return Boolean(activeSessionId) && !shouldSuppressRightSidebarForNavState(navState)
}

/** Returns true when the right sidebar must be suppressed for the given navigation state. */
export function shouldSuppressRightSidebarForNavState(navState: NavigationState): boolean {
  return navState.navigator === 'archived'
}
