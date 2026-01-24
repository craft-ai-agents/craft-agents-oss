/**
 * Pages Index
 *
 * Export all page components for use in MainContentPanel.
 */

export { default as ChatPage } from './ChatPage'
export { default as SourceInfoPage } from './SourceInfoPage'
export { default as TerminalPage } from './TerminalPage'

// Settings pages
export {
  SettingsNavigator,
  AppSettingsPage,
  WorkspaceSettingsPage,
  PermissionsSettingsPage,
  ShortcutsPage,
  PreferencesPage,
} from './settings'
