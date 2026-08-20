/**
 * Settings Page Components Registry
 *
 * Maps settings subpage IDs to their React components.
 * TypeScript enforces that all pages defined in settings-registry have a component here.
 *
 * To add a new settings page:
 * 1. Add to SETTINGS_PAGES in shared/settings-registry.ts
 * 2. Create the page component (e.g., NewSettingsPage.tsx)
 * 3. Add to SETTINGS_PAGE_COMPONENTS below
 * 4. Add icon to SETTINGS_ICONS in components/icons/SettingsIcons.tsx
 */

import type { ComponentType } from 'react'
import type { SettingsSubpage } from '../../../shared/settings-registry'

import RuntimeSettingsPage from './RuntimeSettingsPage'
import ContextSettingsPage from './ContextSettingsPage'
import KnowledgeSettingsPage from './KnowledgeSettingsPage'
import MarketplaceSettingsPage from './MarketplaceSettingsPage'
import ExtensionsSettingsPage from './ExtensionsSettingsPage'
import AppSettingsPage from './AppSettingsPage'
import AiSettingsPage from './AiSettingsPage'
import AppearanceSettingsPage from './AppearanceSettingsPage'
import InputSettingsPage from './InputSettingsPage'
import WorkspaceSettingsPage from './WorkspaceSettingsPage'
import AccountsSettingsPage from './AccountsSettingsPage'
import PermissionsSettingsPage from './PermissionsSettingsPage'
import LabelsSettingsPage from './LabelsSettingsPage'
import OrganizationsSettingsPage from './OrganizationsSettingsPage'
import MessagingSettingsPage from './MessagingSettingsPage'
import ServerSettingsPage from './ServerSettingsPage'
import CloudRunsSettingsPage from './CloudRunsSettingsPage'
import SecuritySettingsPage from './SecuritySettingsPage'
import ShortcutsPage from './ShortcutsPage'


/**
 * Map of settings subpage IDs to their page components.
 * TypeScript will error if a page from SETTINGS_PAGES is missing here.
 */
export const SETTINGS_PAGE_COMPONENTS: Record<SettingsSubpage, ComponentType> = {
  runtime: RuntimeSettingsPage,
  context: ContextSettingsPage,
  knowledge: KnowledgeSettingsPage,
  marketplace: MarketplaceSettingsPage,
  extensions: ExtensionsSettingsPage,
  app: AppSettingsPage,
  ai: AiSettingsPage,
  appearance: AppearanceSettingsPage,
  input: InputSettingsPage,
  workspace: WorkspaceSettingsPage,
  accounts: AccountsSettingsPage,
  permissions: PermissionsSettingsPage,
  labels: LabelsSettingsPage,
  organizations: OrganizationsSettingsPage,
  messaging: MessagingSettingsPage,
  server: ServerSettingsPage,
  security: SecuritySettingsPage,
  cloudRuns: CloudRunsSettingsPage,
  shortcuts: ShortcutsPage,
}

/**
 * Get the component for a settings subpage
 */
export function getSettingsPageComponent(subpage: SettingsSubpage): ComponentType {
  return SETTINGS_PAGE_COMPONENTS[subpage]
}
