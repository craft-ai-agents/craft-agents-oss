/**
 * Pages Index
 *
 * Export all page components for use in MainContentPanel.
 */

export { default as ChatPage } from './ChatPage'
export { default as SourceInfoPage } from './SourceInfoPage'

// Settings pages (new structure)
export {
  SettingsNavigator,
  SettingsGeneralPage,
  ShortcutsPage,
  PreferencesPage,
} from './settings'

// SettingsPage export (used by MainContentPanel)
export { default as SettingsPage } from './SettingsPage'
