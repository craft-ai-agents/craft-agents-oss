/**
 * PermissionsSettingsPage
 *
 * Displays permissions configuration for Explore mode.
 * Shows both default patterns (from ~/.craft-agent/permissions/default.json)
 * and custom workspace additions (from workspace permissions.json).
 *
 * Default patterns can be edited by the user in ~/.craft-agent/permissions/default.json.
 * Custom patterns can be edited via workspace permissions.json file.
 */

import { useState, useEffect, useMemo } from 'react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { Loader2 } from 'lucide-react'
import { useAppShellContext, useActiveWorkspace } from '@/context/AppShellContext'
import { type PermissionsConfigFile } from '@craft-agent/shared/agent/modes'
import {
  PermissionsDataTable,
  type PermissionRow,
} from '@/components/info'
import {
  SettingsSection,
  SettingsCard,
} from '@/components/settings'
import { EditPopover, EditButton, getEditConfig } from '@/components/ui/EditPopover'
import { getDocUrl } from '@craft-agent/shared/docs/doc-links'
import { routes } from '@/lib/navigate'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { useTranslation } from 'react-i18next'
import { getTableLabels } from '@/i18n/ui-labels'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'permissions',
}

export function getPermissionsLabels(t: (key: string) => string) {
  return {
    pageTitle: t('settings:permissions.pageTitle'),
    loading: t('settings:permissions.loading'),
    aboutTitle: t('settings:permissions.about.title'),
    aboutParagraph1: t('settings:permissions.about.paragraph1'),
    aboutParagraph2: t('settings:permissions.about.paragraph2'),
    learnMore: t('settings:permissions.about.learnMore'),
    defaultPermissionsTitle: t('settings:permissions.defaultPermissions.title'),
    defaultPermissionsDescription: t('settings:permissions.defaultPermissions.description'),
    defaultPermissionsFullscreenTitle: t('settings:permissions.defaultPermissions.fullscreenTitle'),
    defaultPermissionsEmptyTitle: t('settings:permissions.defaultPermissions.empty.title'),
    defaultPermissionsEmptyDescriptionPrefix: t('settings:permissions.defaultPermissions.empty.descriptionPrefix'),
    customPermissionsTitle: t('settings:permissions.customPermissions.title'),
    customPermissionsDescription: t('settings:permissions.customPermissions.description'),
    customPermissionsFullscreenTitle: t('settings:permissions.customPermissions.fullscreenTitle'),
    customPermissionsEmptyTitle: t('settings:permissions.customPermissions.empty.title'),
    customPermissionsEmptyDescriptionPrefix: t('settings:permissions.customPermissions.empty.descriptionPrefix'),
    customPermissionsEmptyDescriptionSuffix: t('settings:permissions.customPermissions.empty.descriptionSuffix'),
    editFileLabel: t('settings:permissions.actions.editFile'),
  }
}

/**
 * Build default permissions data from ~/.craft-agent/permissions/default.json.
 * These are the Explore mode patterns that can be customized by the user.
 * Patterns can include comments which are displayed in the table.
 *
 * Note: We only show allowed patterns here. Anything not on this list is implicitly denied.
 */
function buildDefaultPermissionsData(config: PermissionsConfigFile | null, tableLabels: ReturnType<typeof getTableLabels>): PermissionRow[] {
  if (!config) return []

  const rows: PermissionRow[] = []

  // Helper to extract pattern and comment from string or object format
  const extractPatternInfo = (item: string | { pattern: string; comment?: string }): { pattern: string; comment: string | null } => {
    if (typeof item === 'string') {
      return { pattern: item, comment: null }
    }
    return { pattern: item.pattern, comment: item.comment || null }
  }

  // Note: We don't show blockedTools here - anything not on the allowed list is implicitly denied

  // Allowed bash patterns
  config.allowedBashPatterns?.forEach((item) => {
    const { pattern, comment } = extractPatternInfo(item)
    rows.push({
      access: 'allowed',
      type: 'bash',
      pattern,
      comment,
    })
  })

  // Allowed MCP patterns
  config.allowedMcpPatterns?.forEach((item) => {
    const { pattern, comment } = extractPatternInfo(item)
    rows.push({
      access: 'allowed',
      type: 'mcp',
      pattern,
      comment,
    })
  })

  // API endpoints
  config.allowedApiEndpoints?.forEach((item) => {
    const pattern = `${item.method} ${item.path}`
    rows.push({
      access: 'allowed',
      type: 'api',
      pattern,
      comment: item.comment || null,
    })
  })

  // Write paths
  config.allowedWritePaths?.forEach((item) => {
    if (typeof item === 'string') {
      rows.push({ access: 'allowed', type: 'tool', pattern: item, comment: tableLabels.permissions.table.allowedWritePath })
    } else {
      const writePrefix = tableLabels.permissions.table.writeToPattern.split('{{pattern}}')[0].trim()
      rows.push({ access: 'allowed', type: 'tool', pattern: writePrefix + item.pattern, comment: item.comment || tableLabels.permissions.table.allowedWritePath })
    }
  })

  return rows
}

/**
 * Build custom permissions data from workspace permissions.json.
 * These are user-added patterns that extend the defaults.
 */
function buildCustomPermissionsData(config: PermissionsConfigFile, tableLabels: ReturnType<typeof getTableLabels>): PermissionRow[] {
  const rows: PermissionRow[] = []

  // Additional blocked tools
  config.blockedTools?.forEach((item) => {
    const pattern = typeof item === 'string' ? item : item.pattern
    const comment = typeof item === 'string' ? tableLabels.permissions.table.customBlockedTool : (item.comment || tableLabels.permissions.table.customBlockedTool)
    rows.push({ access: 'blocked', type: 'tool', pattern, comment })
  })

  // Additional bash patterns
  config.allowedBashPatterns?.forEach((item) => {
    const pattern = typeof item === 'string' ? item : item.pattern
    const comment = typeof item === 'string' ? tableLabels.permissions.table.customBashPattern : (item.comment || tableLabels.permissions.table.customBashPattern)
    rows.push({ access: 'allowed', type: 'bash', pattern, comment })
  })

  // Additional MCP patterns
  config.allowedMcpPatterns?.forEach((item) => {
    const pattern = typeof item === 'string' ? item : item.pattern
    const comment = typeof item === 'string' ? tableLabels.permissions.table.customMcpPattern : (item.comment || tableLabels.permissions.table.customMcpPattern)
    rows.push({ access: 'allowed', type: 'mcp', pattern, comment })
  })

  // API endpoints
  config.allowedApiEndpoints?.forEach((item) => {
    const pattern = `${item.method} ${item.path}`
    rows.push({ access: 'allowed', type: 'api', pattern, comment: item.comment || tableLabels.permissions.table.customApiEndpoint })
  })

  // Write paths are shown as allowed paths
  config.allowedWritePaths?.forEach((item) => {
    const pattern = typeof item === 'string' ? item : item.pattern
    const comment = typeof item === 'string'
      ? tableLabels.permissions.table.allowedWritePath
      : (item.comment || tableLabels.permissions.table.allowedWritePath)
    // Show as a special "tool" type since it's about Write/Edit operations
    rows.push({
      access: 'allowed',
      type: 'tool',
      pattern: tableLabels.permissions.table.writeToPattern.replace('{{pattern}}', pattern),
      comment,
    })
  })

  return rows
}

export default function PermissionsSettingsPage() {
  const { t } = useTranslation(['settings'])
  const labels = getPermissionsLabels(t)
  const { activeWorkspaceId } = useAppShellContext()
  const activeWorkspace = useActiveWorkspace()

  // Loading and data state
  const [isLoading, setIsLoading] = useState(true)
  const [defaultConfig, setDefaultConfig] = useState<PermissionsConfigFile | null>(null)
  const [defaultPermissionsPath, setDefaultPermissionsPath] = useState<string | null>(null)
  const [customConfig, setCustomConfig] = useState<PermissionsConfigFile | null>(null)

  // Build default permissions data from ~/.craft-agent/permissions/default.json
  const tableLabels = useMemo(() => getTableLabels(t), [t])
  const defaultPermissionsData = useMemo(() => defaultConfig ? buildDefaultPermissionsData(defaultConfig, tableLabels) : [], [defaultConfig, tableLabels])

  // Build custom permissions data from workspace permissions.json
  const customPermissionsData = useMemo(() => {
    if (!customConfig) return []
    return buildCustomPermissionsData(customConfig, tableLabels)
  }, [customConfig, tableLabels])

  // Load both default and workspace permissions configs
  useEffect(() => {
    const loadPermissions = async () => {
      if (!window.electronAPI) {
        setIsLoading(false)
        return
      }

      setIsLoading(true)
      try {
        // Load default permissions (app-level) - returns both config and path
        const { config: defaults, path: defaultsPath } = await window.electronAPI.getDefaultPermissionsConfig()
        setDefaultConfig(defaults)
        setDefaultPermissionsPath(defaultsPath)

        // Load workspace permissions if we have an active workspace
        if (activeWorkspaceId) {
          const workspace = await window.electronAPI.getWorkspacePermissionsConfig(activeWorkspaceId)
          setCustomConfig(workspace)
        }
      } catch (error) {
        console.error('Failed to load permissions:', error)
      } finally {
        setIsLoading(false)
      }
    }

    loadPermissions()
  }, [activeWorkspaceId])

  // Listen for default permissions changes (file watcher)
  useEffect(() => {
    if (!window.electronAPI?.onDefaultPermissionsChanged) return

    const unsubscribe = window.electronAPI.onDefaultPermissionsChanged(async () => {
      // Reload default permissions when the file changes
      const { config: defaults } = await window.electronAPI.getDefaultPermissionsConfig()
      setDefaultConfig(defaults)
    })

    return unsubscribe
  }, [])

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title={labels.pageTitle} actions={<HeaderMenu route={routes.view.settings('permissions')} helpFeature="permissions" />} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto">
            <div className="space-y-8">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" aria-label={labels.loading} />
                </div>
              ) : (
                <>
                  {/* About Section */}
                  <SettingsSection title={labels.aboutTitle}>
                    <SettingsCard className="px-4 py-3.5">
                      <div className="text-sm text-muted-foreground leading-relaxed space-y-1.5">
                        <p>{labels.aboutParagraph1}</p>
                        <p>{labels.aboutParagraph2}</p>
                        <p>
                          <button
                            type="button"
                            onClick={() => window.electronAPI?.openUrl(getDocUrl('permissions'))}
                            className="text-foreground/70 hover:text-foreground underline underline-offset-2"
                          >
                            {labels.learnMore}
                          </button>
                        </p>
                      </div>
                    </SettingsCard>
                  </SettingsSection>

                  {/* Default Permissions Section */}
                  <SettingsSection
                    title={labels.defaultPermissionsTitle}
                    description={labels.defaultPermissionsDescription}
                    action={
                      // EditPopover for AI-assisted default permissions editing
                      defaultPermissionsPath ? (
                        <EditPopover
                          trigger={<EditButton />}
                          {...getEditConfig('default-permissions', defaultPermissionsPath)}
                          secondaryAction={{
                            label: labels.editFileLabel,
                            filePath: defaultPermissionsPath,
                          }}
                        />
                      ) : null
                    }
                  >
                    <SettingsCard className="p-0">
                      {defaultPermissionsData.length > 0 ? (
                        <PermissionsDataTable
                          data={defaultPermissionsData}
                          searchable
                          maxHeight={350}
                          fullscreen
                          fullscreenTitle={labels.defaultPermissionsFullscreenTitle}
                        />
                      ) : (
                        <div className="p-8 text-center text-muted-foreground">
                          <p className="text-sm">{labels.defaultPermissionsEmptyTitle}</p>
                          <p className="text-xs mt-1 text-foreground/40">
                            {labels.defaultPermissionsEmptyDescriptionPrefix} <code className="bg-foreground/5 px-1 rounded">~/.craft-agent/permissions/default.json</code>
                          </p>
                        </div>
                      )}
                    </SettingsCard>
                  </SettingsSection>

                  {/* Custom Permissions Section */}
                  <SettingsSection
                    title={labels.customPermissionsTitle}
                    description={labels.customPermissionsDescription}
                    action={
                      (() => {
                        // Get centralized edit config - all strings defined in EditPopover.tsx
                        const { context, example } = getEditConfig('workspace-permissions', activeWorkspace?.rootPath || '')
                        return (
                          <EditPopover
                            trigger={<EditButton />}
                            example={example}
                            context={context}
                            secondaryAction={activeWorkspace ? {
                              label: labels.editFileLabel,
                              filePath: `${activeWorkspace.rootPath}/permissions.json`,
                            } : undefined}
                          />
                        )
                      })()
                    }
                  >
                    <SettingsCard className="p-0">
                      {customPermissionsData.length > 0 ? (
                        <PermissionsDataTable
                          data={customPermissionsData}
                          searchable
                          maxHeight={350}
                          fullscreen
                          fullscreenTitle={labels.customPermissionsFullscreenTitle}
                        />
                      ) : (
                        <div className="p-8 text-center text-muted-foreground">
                          <p className="text-sm">{labels.customPermissionsEmptyTitle}</p>
                          <p className="text-xs mt-1 text-foreground/40">
                            {labels.customPermissionsEmptyDescriptionPrefix} <code className="bg-foreground/5 px-1 rounded">permissions.json</code> {labels.customPermissionsEmptyDescriptionSuffix}
                          </p>
                        </div>
                      )}
                    </SettingsCard>
                  </SettingsSection>
                </>
              )}
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
