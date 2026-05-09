import * as storage from '@/lib/local-storage'

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
