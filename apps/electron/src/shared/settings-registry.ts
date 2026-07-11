/**
 * Settings Registry - Single Source of Truth
 *
 * This file defines all settings pages in one place. All other files that need
 * settings page information should import from here.
 *
 * To add a new settings page:
 * 1. Add an entry to SETTINGS_PAGES below
 * 2. Create the page component in renderer/pages/settings/
 * 3. Add to SETTINGS_PAGE_COMPONENTS in renderer/pages/settings/settings-pages.ts
 * 4. Add icon to SETTINGS_ICONS in renderer/components/icons/SettingsIcons.tsx
 *
 * That's it - types, routes, and validation are derived automatically.
 */

/**
 * Settings page definition
 */
export interface SettingsPageDefinition {
  /** Unique identifier used in routes and navigation */
  id: string
  /** Display label in settings navigator */
  label: string
  /** Short description shown in settings navigator */
  description: string
}

/**
 * The canonical list of all settings pages.
 * Order here determines display order in the settings navigator.
 *
 * ADD NEW PAGES HERE - everything else derives from this list.
 */
export const SETTINGS_PAGES = [
  { id: 'app', label: 'App', description: 'Notifications and updates' },
  { id: 'ai', label: 'AI', description: 'Model, thinking, connections' },
  { id: 'appearance', label: 'Appearance', description: 'Theme, font, tool icons' },
  { id: 'input', label: 'Input', description: 'Send key, spell check' },
  { id: 'workspace', label: 'Workspace', description: 'Name, icon, working directory' },
  { id: 'permissions', label: 'Permissions', description: 'Explore mode rules' },
  { id: 'labels', label: 'Labels', description: 'Manage session labels' },
  { id: 'server', label: 'Server', description: 'Remote server access' },
  { id: 'shortcuts', label: 'Shortcuts', description: 'Keyboard shortcuts' },
  { id: 'preferences', label: 'Preferences', description: 'User preferences' },
] as const satisfies readonly SettingsPageDefinition[]

/**
 * Settings subpage type - derived from SETTINGS_PAGES
 * This replaces the manual union type in types.ts
 */
export type SettingsSubpage = (typeof SETTINGS_PAGES)[number]['id']

/**
 * Array of valid settings subpage IDs - for runtime validation
 */
export const VALID_SETTINGS_SUBPAGES: readonly SettingsSubpage[] = SETTINGS_PAGES.map(p => p.id)

/**
 * Type guard to check if a string is a valid settings subpage
 */
export function isValidSettingsSubpage(value: string): value is SettingsSubpage {
  return VALID_SETTINGS_SUBPAGES.includes(value as SettingsSubpage)
}

/**
 * Get settings page definition by ID
 */
export function getSettingsPage(id: SettingsSubpage): SettingsPageDefinition {
  const page = SETTINGS_PAGES.find(p => p.id === id)
  if (!page) throw new Error(`Unknown settings page: ${id}`)
  return page
}
