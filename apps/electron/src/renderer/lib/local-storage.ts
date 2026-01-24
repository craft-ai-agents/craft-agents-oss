/**
 * Centralized localStorage utility for the Electron renderer.
 * Provides type-safe access with consistent key prefixing.
 */

const PREFIX = 'craft-'

/**
 * All localStorage keys used in the app.
 * Centralized here to avoid magic strings and key collisions.
 */
export const KEYS = {
  // Chat sidebar
  sidebarVisible: 'sidebar-visible',
  sidebarWidth: 'sidebar-width',
  sessionListWidth: 'session-list-width',
  sidebarMode: 'sidebar-mode',
  listFilter: 'list-filter',
  labelFilter: 'label-filter',
  expandedFolders: 'expanded-folders',
  collapsedSidebarItems: 'collapsed-sidebar-items',

  // Right sidebar (chat page)
  rightSidebarVisible: 'right-sidebar-visible',
  rightSidebarWidth: 'right-sidebar-width',
  sessionInfoMetadataHeight: 'session-info-metadata-height', // Height of metadata section in session info panel
  sessionFilesExpandedFolders: 'session-files-expanded', // Expanded folders in session files tree (keyed by sessionId)

  // Theme
  theme: 'theme',

  // Panel layouts (dynamic key suffix)
  panelLayout: 'panel-layout', // Used as: panelLayout:${key}

  // Tabs (workspace-scoped)
  tabs: 'tabs', // Used as: tabs-${workspaceId}

  // Working directory
  recentWorkingDirs: 'recent-working-dirs',
} as const

export type StorageKey = typeof KEYS[keyof typeof KEYS]

/**
 * Build the full prefixed key.
 * Supports dynamic suffixes like 'panel-layout:chat' or 'tabs-workspace123'
 */
function buildKey(key: string, suffix?: string): string {
  const base = `${PREFIX}${key}`
  return suffix ? `${base}:${suffix}` : base
}

/**
 * Get a value from localStorage with JSON parsing.
 * Returns fallback if key doesn't exist or parsing fails.
 */
export function get<T>(key: StorageKey, fallback: T, suffix?: string): T {
  try {
    const item = localStorage.getItem(buildKey(key, suffix))
    if (item === null) return fallback
    return JSON.parse(item) as T
  } catch {
    return fallback
  }
}

/**
 * Set a value in localStorage with JSON stringification.
 */
export function set<T>(key: StorageKey, value: T, suffix?: string): void {
  try {
    localStorage.setItem(buildKey(key, suffix), JSON.stringify(value))
  } catch (error) {
    console.warn(`[localStorage] Failed to set ${key}:`, error)
  }
}

/**
 * Remove a key from localStorage.
 */
export function remove(key: StorageKey, suffix?: string): void {
  localStorage.removeItem(buildKey(key, suffix))
}

/**
 * Get raw string value (for non-JSON data like atomWithStorage compatibility).
 */
export function getRaw(key: StorageKey, suffix?: string): string | null {
  return localStorage.getItem(buildKey(key, suffix))
}

/**
 * Set raw string value (for non-JSON data like atomWithStorage compatibility).
 */
export function setRaw(key: StorageKey, value: string, suffix?: string): void {
  localStorage.setItem(buildKey(key, suffix), value)
}

/**
 * Build a full key string for use with atomWithStorage or other APIs
 * that need the raw key string.
 */
export function getKeyString(key: StorageKey, suffix?: string): string {
  return buildKey(key, suffix)
}
