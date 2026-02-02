/**
 * AppearanceSettingsPage
 *
 * Visual customization settings: theme mode, color theme, font,
 * and an editable reference table of CLI tool icon mappings.
 */

import { useState, useEffect } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { EditPopover, EditButton, getEditConfig } from '@/components/ui/EditPopover'
import { useTheme } from '@/context/ThemeContext'
import { routes } from '@/lib/navigate'
import { Monitor, Sun, Moon } from 'lucide-react'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type { ToolIconMapping } from '../../../shared/types'
import { useI18n } from '@/i18n'

import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsSegmentedControl,
  SettingsMenuSelect,
} from '@/components/settings'
import { Info_DataTable, SortableHeader } from '@/components/info/Info_DataTable'
import { Info_Badge } from '@/components/info/Info_Badge'
import type { PresetTheme } from '@config/theme'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'appearance',
}

// ============================================
// Tool Icons Table
// ============================================

/**
 * Column definitions for the tool icon mappings table.
 * Shows a preview icon, tool name, and the CLI commands that trigger it.
 */
const createToolIconColumns = (t: (key: string) => string): ColumnDef<ToolIconMapping>[] => [
  {
    accessorKey: 'iconDataUrl',
    header: () => <span className="p-1.5 pl-2.5">{t('appearance.toolIcons.iconHeader')}</span>,
    cell: ({ row }) => (
      <div className="p-1.5 pl-2.5">
        <img
          src={row.original.iconDataUrl}
          alt={row.original.displayName}
          className="w-5 h-5 object-contain"
        />
      </div>
    ),
    size: 60,
    enableSorting: false,
  },
  {
    accessorKey: 'displayName',
    header: ({ column }) => <SortableHeader column={column} title={t('appearance.toolIcons.toolHeader')} />,
    cell: ({ row }) => (
      <div className="p-1.5 pl-2.5 font-medium">
        {row.original.displayName}
      </div>
    ),
    size: 150,
  },
  {
    accessorKey: 'commands',
    header: () => <span className="p-1.5 pl-2.5">{t('appearance.toolIcons.commandsHeader')}</span>,
    cell: ({ row }) => (
      <div className="p-1.5 pl-2.5 flex flex-wrap gap-1">
        {row.original.commands.map(cmd => (
          <Info_Badge key={cmd} color="muted" className="font-mono">
            {cmd}
          </Info_Badge>
        ))}
      </div>
    ),
    meta: { fillWidth: true },
    enableSorting: false,
  },
]

// ============================================
// Main Component
// ============================================

export default function AppearanceSettingsPage() {
  const { t } = useI18n('settings')
  const { mode, setMode, colorTheme, setColorTheme, font, setFont } = useTheme()
  // Preset themes for the color theme dropdown
  const [presetThemes, setPresetThemes] = useState<PresetTheme[]>([])

  // Tool icon mappings loaded from main process
  const [toolIcons, setToolIcons] = useState<ToolIconMapping[]>([])

  // Resolved path to tool-icons.json (needed for EditPopover and "Edit File" action)
  const [toolIconsJsonPath, setToolIconsJsonPath] = useState<string | null>(null)

  // Load preset themes on mount
  useEffect(() => {
    const loadThemes = async () => {
      if (!window.electronAPI) {
        setPresetThemes([])
        return
      }
      try {
        const themes = await window.electronAPI.loadPresetThemes()
        setPresetThemes(themes)
      } catch (error) {
        console.error('Failed to load preset themes:', error)
        setPresetThemes([])
      }
    }
    loadThemes()
  }, [])

  // Load tool icon mappings and resolve the config file path on mount
  useEffect(() => {
    const load = async () => {
      if (!window.electronAPI) return
      try {
        const [mappings, homeDir] = await Promise.all([
          window.electronAPI.getToolIconMappings(),
          window.electronAPI.getHomeDir(),
        ])
        setToolIcons(mappings)
        setToolIconsJsonPath(`${homeDir}/.craft-agent/tool-icons/tool-icons.json`)
      } catch (error) {
        console.error('Failed to load tool icon mappings:', error)
      }
    }
    load()
  }, [])

  return (
    <div className="h-full flex flex-col">
      <PanelHeader
        title={t('appearance.title')}
        actions={<HeaderMenu route={routes.view.settings('appearance')} helpFeature="appearance" />}
      />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto">
            <div className="space-y-8">

              {/* Theme & Font */}
              <SettingsSection title={t('appearance.theme.title')}>
                <SettingsCard>
                  <SettingsRow label={t('appearance.theme.mode')}>
                    <SettingsSegmentedControl
                      value={mode}
                      onValueChange={setMode}
                      options={[
                        { value: 'system', label: t('appearance.theme.system'), icon: <Monitor className="w-4 h-4" /> },
                        { value: 'light', label: t('appearance.theme.light'), icon: <Sun className="w-4 h-4" /> },
                        { value: 'dark', label: t('appearance.theme.dark'), icon: <Moon className="w-4 h-4" /> },
                      ]}
                    />
                  </SettingsRow>
                  <SettingsRow label={t('appearance.theme.colorTheme')}>
                    <SettingsMenuSelect
                      value={colorTheme}
                      onValueChange={setColorTheme}
                      options={[
                        { value: 'default', label: t('appearance.theme.default') },
                        ...presetThemes
                          .filter(t => t.id !== 'default')
                          .map(t => ({
                            value: t.id,
                            label: t.theme.name || t.id,
                          })),
                      ]}
                    />
                  </SettingsRow>
                  <SettingsRow label={t('appearance.theme.font')}>
                    <SettingsSegmentedControl
                      value={font}
                      onValueChange={setFont}
                      options={[
                        { value: 'inter', label: t('appearance.theme.inter') },
                        { value: 'system', label: t('appearance.theme.systemFont') },
                      ]}
                    />
                  </SettingsRow>
                </SettingsCard>
              </SettingsSection>

              {/* Tool Icons — shows the command → icon mapping used in turn cards */}
              <SettingsSection
                title={t('appearance.toolIcons.title')}
                description={t('appearance.toolIcons.description')}
                action={
                  toolIconsJsonPath ? (
                    <EditPopover
                      trigger={<EditButton />}
                      {...getEditConfig('edit-tool-icons', toolIconsJsonPath)}
                      secondaryAction={{
                        label: t('appearance.toolIcons.editFile'),
                        filePath: toolIconsJsonPath,
                      }}
                    />
                  ) : undefined
                }
              >
                <SettingsCard>
                  <Info_DataTable
                    columns={createToolIconColumns(t)}
                    data={toolIcons}
                    searchable={{ placeholder: t('appearance.toolIcons.searchPlaceholder') }}
                    maxHeight={480}
                    emptyContent={t('appearance.toolIcons.emptyContent')}
                  />
                </SettingsCard>
              </SettingsSection>

            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
