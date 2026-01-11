/**
 * Settings Pages
 *
 * All pages that appear under the settings navigator.
 */

export { default as SettingsNavigator } from './SettingsNavigator'
export { default as SettingsGeneralPage, meta as SettingsGeneralMeta } from './SettingsGeneralPage'
export { default as ShortcutsPage, meta as ShortcutsMeta } from './ShortcutsPage'
export { default as PreferencesPage, meta as PreferencesMeta } from './PreferencesPage'

// Re-export types
export type { DetailsPageMeta } from '@/lib/navigation-registry'
