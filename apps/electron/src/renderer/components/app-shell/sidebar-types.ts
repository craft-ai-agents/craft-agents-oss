/**
 * Sidebar Mode Types
 *
 * Defines the different content modes for the 2nd sidebar.
 * The left sidebar navigation items control which mode is active.
 */

import type { TodoStateId } from '@/config/todo-states'

/**
 * Chat filter options for the chats sidebar mode
 */
export type ChatFilter =
  | { kind: 'inbox' }
  | { kind: 'archive' }
  | { kind: 'flagged' }
  | { kind: 'agent'; agentId: string }
  | { kind: 'state'; stateId: TodoStateId }

/**
 * Settings subpage options
 */
export type SettingsSubpage = 'general' | 'shortcuts' | 'preferences'

/**
 * Source category options for filtering sources
 */
export type SourceCategory = 'local-files' | 'online-sources' | 'local-mcp'

/**
 * Sidebar mode - determines what content is shown in the 2nd sidebar
 */
export type SidebarMode =
  | { type: 'chats'; filter: ChatFilter }
  | { type: 'sources'; category?: SourceCategory }
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
): mode is { type: 'sources'; category?: SourceCategory } => mode.type === 'sources'

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
  if (mode.type === 'sources') {
    return mode.category ? `sources:${mode.category}` : 'sources'
  }
  if (mode.type === 'settings') return `settings:${mode.subpage}`
  const f = mode.filter
  if (f.kind === 'agent') return `agent:${f.agentId}`
  if (f.kind === 'state') return `state:${f.stateId}`
  return f.kind
}

/**
 * Parse a persistence key back to a SidebarMode
 * Returns null if the key is invalid or requires validation (agent/state)
 */
export const parseSidebarModeKey = (key: string): SidebarMode | null => {
  if (key === 'sources') return { type: 'sources' }
  if (key.startsWith('sources:')) {
    const category = key.slice(8) as SourceCategory
    if (['local-files', 'online-sources', 'local-mcp'].includes(category)) {
      return { type: 'sources', category }
    }
  }
  if (key === 'inbox') return { type: 'chats', filter: { kind: 'inbox' } }
  if (key === 'archive') return { type: 'chats', filter: { kind: 'archive' } }
  if (key === 'flagged') return { type: 'chats', filter: { kind: 'flagged' } }
  if (key.startsWith('agent:')) {
    const agentId = key.slice(6)
    if (agentId) return { type: 'chats', filter: { kind: 'agent', agentId } }
  }
  if (key.startsWith('state:')) {
    const stateId = key.slice(6) as TodoStateId
    if (stateId) return { type: 'chats', filter: { kind: 'state', stateId } }
  }
  if (key.startsWith('settings:')) {
    const subpage = key.slice(9) as SettingsSubpage
    if (['general', 'shortcuts', 'preferences'].includes(subpage)) {
      return { type: 'settings', subpage }
    }
  }
  if (key === 'settings') return { type: 'settings', subpage: 'general' }
  return null
}

/**
 * Default sidebar mode - inbox view
 */
export const DEFAULT_SIDEBAR_MODE: SidebarMode = {
  type: 'chats',
  filter: { kind: 'inbox' },
}
