/**
 * Sidebar Mode Types
 *
 * Defines the different content modes for the 2nd sidebar.
 * The left sidebar navigation items control which mode is active.
 */

// Import shared types - single source of truth
import type { ChatFilter, SettingsSubpage } from '../../../shared/types'
export type { ChatFilter, SettingsSubpage }

/**
 * Sidebar mode - determines what content is shown in the 2nd sidebar
 */
export type SidebarMode =
  | { type: 'chats'; filter: ChatFilter }
  | { type: 'sources' }
  | { type: 'settings'; subpage: SettingsSubpage }

/**
 * Type guard to check if mode is chats mode
 */
export const isChatsMode = (
  mode: SidebarMode
): mode is { type: 'chats'; filter: ChatFilter } => mode.type === 'chats'

/**
 * Type guard to check if mode is sources mode
 */
export const isSourcesMode = (
  mode: SidebarMode
): mode is { type: 'sources' } => mode.type === 'sources'

/**
 * Type guard to check if mode is settings mode
 */
export const isSettingsMode = (
  mode: SidebarMode
): mode is { type: 'settings'; subpage: SettingsSubpage } => mode.type === 'settings'

/**
 * Get a persistence key for localStorage
 * Used to save/restore the last selected sidebar mode
 */
export const getSidebarModeKey = (mode: SidebarMode): string => {
  if (mode.type === 'sources') return 'sources'
  if (mode.type === 'settings') return `settings:${mode.subpage}`
  const f = mode.filter
  if (f.kind === 'state') return `state:${f.stateId}`
  return f.kind
}

/**
 * Parse a persistence key back to a SidebarMode
 * Returns null if the key is invalid or requires validation (state)
 */
export const parseSidebarModeKey = (key: string): SidebarMode | null => {
  if (key === 'sources') return { type: 'sources' }
  if (key === 'allChats') return { type: 'chats', filter: { kind: 'allChats' } }
  if (key === 'flagged') return { type: 'chats', filter: { kind: 'flagged' } }
  if (key.startsWith('state:')) {
    const stateId = key.slice(6)
    if (stateId) return { type: 'chats', filter: { kind: 'state', stateId } }
  }
  if (key.startsWith('settings:')) {
    const subpage = key.slice(9) as SettingsSubpage
    if (['app', 'appearance', 'workspace', 'permissions', 'labels', 'shortcuts', 'preferences'].includes(subpage)) {
      return { type: 'settings', subpage }
    }
  }
  if (key === 'settings') return { type: 'settings', subpage: 'app' }
  return null
}

/**
 * Default sidebar mode - all chats view
 */
export const DEFAULT_SIDEBAR_MODE: SidebarMode = {
  type: 'chats',
  filter: { kind: 'allChats' },
}
