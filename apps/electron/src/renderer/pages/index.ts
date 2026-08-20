/**
 * Pages Index
 *
 * Export all page components for use in MainContentPanel.
 */

export { default as ChatPage } from './ChatPage'
export { default as SourceInfoPage } from './SourceInfoPage'
export { default as BrowserPanelPage } from './BrowserPanelPage'
export { default as KnowledgeSurfacePage } from './KnowledgeSurfacePage'
export { default as ExtensionSurfacePage } from './ExtensionSurfacePage'
export { default as ConnectionsPage } from './ConnectionsPage'
// Settings pages
export {
  SettingsNavigator,
  AppSettingsPage,
  AiSettingsPage,
  AppearanceSettingsPage,
  InputSettingsPage,
  WorkspaceSettingsPage,
  PermissionsSettingsPage,
  LabelsSettingsPage,
  ShortcutsPage,
} from './settings'
