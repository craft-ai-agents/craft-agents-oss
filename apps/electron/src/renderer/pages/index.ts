/**
 * Pages Index
 *
 * Export all page components for use in MainContentPanel.
 */

export { default as ChatPage } from './ChatPage'
export { default as SourceInfoPage } from './SourceInfoPage'
export { default as AgentInfoPage } from './AgentInfoPage'

// Settings pages (new structure)
export {
  SettingsNavigator,
  SettingsGeneralPage,
  ShortcutsPage,
  PreferencesPage,
} from './settings'

// Legacy exports for backwards compatibility during transition
// These redirect to the new settings pages
export { default as SettingsPage } from './SettingsPage'
