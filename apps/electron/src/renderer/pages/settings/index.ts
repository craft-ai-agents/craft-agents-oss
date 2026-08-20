/**
 * Settings Pages
 *
 * All pages that appear under the settings navigator.
 */

export { default as SettingsNavigator } from './SettingsNavigator'
export { default as RuntimeSettingsPage, meta as RuntimeMeta } from './RuntimeSettingsPage'
export { default as ContextSettingsPage, meta as ContextMeta } from './ContextSettingsPage'
export { default as MarketplaceSettingsPage, meta as MarketplaceMeta } from './MarketplaceSettingsPage'
export { default as AppSettingsPage, meta as AppSettingsMeta } from './AppSettingsPage'
export { default as AiSettingsPage, meta as AiSettingsMeta } from './AiSettingsPage'
export { default as AppearanceSettingsPage, meta as AppearanceMeta } from './AppearanceSettingsPage'
export { default as InputSettingsPage, meta as InputMeta } from './InputSettingsPage'
export { default as WorkspaceSettingsPage, meta as WorkspaceSettingsMeta } from './WorkspaceSettingsPage'
export { default as PermissionsSettingsPage, meta as PermissionsMeta } from './PermissionsSettingsPage'
export { default as SecuritySettingsPage, meta as SecuritySettingsMeta } from './SecuritySettingsPage'
export { default as LabelsSettingsPage, meta as LabelsMeta } from './LabelsSettingsPage'
export { default as OrganizationsSettingsPage, meta as OrganizationsMeta } from './OrganizationsSettingsPage'
export { default as ShortcutsPage, meta as ShortcutsMeta } from './ShortcutsPage'
export { PreferencesForm } from './PreferencesPage'

// Re-export types
export type { DetailsPageMeta } from '@/lib/navigation-registry'
