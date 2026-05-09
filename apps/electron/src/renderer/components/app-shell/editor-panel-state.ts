import * as storage from '@/lib/local-storage'

/** Loads the workspace-scoped editor panel open preference. */
export function loadEditorPanelOpenPreference(workspaceId?: string): boolean {
  return storage.get(storage.KEYS.editorPanelVisible, true, workspaceId)
}

/** Persists the workspace-scoped editor panel open preference. */
export function persistEditorPanelOpenPreference(isOpen: boolean, workspaceId?: string): void {
  storage.set(storage.KEYS.editorPanelVisible, isOpen, workspaceId)
}
