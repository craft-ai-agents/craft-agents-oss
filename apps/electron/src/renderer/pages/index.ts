/**
 * Pages Index
 *
 * Export all page components for use in MainContentPanel.
 */

export { default as ChatPage } from './ChatPage'
export { default as SourceInfoPage } from './SourceInfoPage'
export { default as DocumentViewerPage } from './DocumentViewerPage'

// Settings pages
export {
  SettingsNavigator,
  AppSettingsPage,
  WorkspaceSettingsPage,
  PermissionsSettingsPage,
  ShortcutsPage,
  PreferencesPage,
  ClaudeProfilesPage,
} from './settings'
