/**
 * WorkspaceSettingsPage
 *
 * Workspace-level settings for the active workspace.
 *
 * Settings:
 * - Identity (Name, Icon)
 * - Permissions (Default mode, Mode cycling)
 * - Advanced (Working directory, Local MCP servers)
 *
 * Note: AI settings (model, thinking, connection) have been moved to AiSettingsPage.
 */

import * as React from 'react'
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatedCollapsibleContent } from '@craft-agent/ui'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { Button, buttonVariants } from '@/components/ui/button'
import { useAppShellContext } from '@/context/AppShellContext'
import { cn } from '@/lib/utils'
import { routes } from '@/lib/navigate'
import { Spinner } from '@craft-agent/ui'
import { RenameDialog } from '@/components/ui/rename-dialog'
import type { PermissionMode, WorkspaceSettings, LoadedSource } from '../../../shared/types'
import { useDirectoryPicker } from '@/hooks/useDirectoryPicker'
import { useAvailablePermissionModes } from '@/hooks/useAvailablePermissionModes'
import { ServerDirectoryBrowser } from '@/components/ServerDirectoryBrowser'
import { PERMISSION_MODE_CONFIG, PERMISSION_MODE_ORDER } from '@craft-agent/shared/agent/mode-types'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { SourceAvatar } from '@/components/ui/source-avatar'
import { toast } from 'sonner'

import {
  SettingsPage,
  SettingsPageState,
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsToggle,
  SettingsMenuSelectRow,
} from '@/components/settings'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'workspace',
}

// ============================================
// Main Component
// ============================================

export default function WorkspaceSettingsPage() {
  const { t } = useTranslation()

  // Get active workspace from context
  const appShellContext = useAppShellContext()
  const activeWorkspaceId = appShellContext.activeWorkspaceId
  const onRefreshWorkspaces = appShellContext.onRefreshWorkspaces

  // Workspace settings state
  const [wsName, setWsName] = useState('')
  const [wsNameEditing, setWsNameEditing] = useState('')
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [wsIconUrl, setWsIconUrl] = useState<string | null>(null)
  const [isUploadingIcon, setIsUploadingIcon] = useState(false)
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('ask')
  const [workingDirectory, setWorkingDirectory] = useState('')
  const [localMcpEnabled, setLocalMcpEnabled] = useState(true)
  const [codingModeDefault, setCodingModeDefault] = useState(false)
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(true)

  // Default sources state
  const [availableSources, setAvailableSources] = useState<LoadedSource[]>([])
  const [enabledSourceSlugs, setEnabledSourceSlugs] = useState<string[]>([])

  // Mode cycling state
  const [enabledModes, setEnabledModes] = useState<PermissionMode[]>(['safe', 'ask', 'allow-all'])
  const [modeCyclingError, setModeCyclingError] = useState<string | null>(null)
  // Guarded is offered only while its decision-model feature is on (or already chosen here)
  const defaultModeOptions = useAvailablePermissionModes(permissionMode)
  const cyclingModeOptions = useAvailablePermissionModes(enabledModes.includes('guarded') ? 'guarded' : undefined)

  // Load workspace settings when active workspace changes
  useEffect(() => {
    const loadWorkspaceSettings = async () => {
      if (!window.electronAPI || !activeWorkspaceId) {
        setIsLoadingWorkspace(false)
        return
      }

      setIsLoadingWorkspace(true)
      try {
        const settings = await window.electronAPI.getWorkspaceSettings(activeWorkspaceId)
        if (settings) {
          setWsName(settings.name || '')
          setWsNameEditing(settings.name || '')
          setPermissionMode(settings.permissionMode || 'ask')
          setWorkingDirectory(settings.workingDirectory || '')
          setLocalMcpEnabled(settings.localMcpEnabled ?? true)
          setCodingModeDefault(settings.codingMode === true)
          // Load cyclable permission modes from workspace settings
          if (settings.cyclablePermissionModes && settings.cyclablePermissionModes.length >= 2) {
            setEnabledModes(settings.cyclablePermissionModes)
          }

          // Load default source slugs
          const savedSlugs = settings.enabledSourceSlugs ?? []

          // Load available sources and auto-heal stale slugs
          const sources = await window.electronAPI.getSources(activeWorkspaceId)
          setAvailableSources(sources)
          const validSlugs = new Set(sources.map(s => s.config.slug))
          const healedSlugs = savedSlugs.filter(s => validSlugs.has(s))
          setEnabledSourceSlugs(healedSlugs)

          // Persist cleaned list if stale slugs were removed
          if (healedSlugs.length !== savedSlugs.length) {
            window.electronAPI.updateWorkspaceSetting(activeWorkspaceId, 'enabledSourceSlugs', healedSlugs)
          }
        }

        // Try to load workspace icon (check common extensions)
        const ICON_EXTENSIONS = ['png', 'jpg', 'jpeg', 'svg', 'webp', 'gif']
        let iconFound = false
        for (const ext of ICON_EXTENSIONS) {
          try {
            const iconData = await window.electronAPI.readWorkspaceImage(activeWorkspaceId, `./icon.${ext}`)
            // IPC returns null for missing files - continue to next extension
            if (!iconData) {
              continue
            }
            // For SVG, wrap in data URL
            if (ext === 'svg' && !iconData.startsWith('data:')) {
              setWsIconUrl(`data:image/svg+xml;base64,${btoa(iconData)}`)
            } else {
              setWsIconUrl(iconData)
            }
            iconFound = true
            break
          } catch {
            // Icon not found with this extension, try next
          }
        }
        if (!iconFound) {
          setWsIconUrl(null)
        }
      } catch (error) {
        console.error('Failed to load workspace settings:', error)
      } finally {
        setIsLoadingWorkspace(false)
      }
    }

    loadWorkspaceSettings()
  }, [activeWorkspaceId])

  // Subscribe to live source changes (additions/removals)
  useEffect(() => {
    if (!window.electronAPI) return
    const cleanup = window.electronAPI.onSourcesChanged((workspaceId: string, sources: LoadedSource[]) => {
      if (workspaceId !== activeWorkspaceId) return
      setAvailableSources(sources)
      // Auto-heal: remove slugs for sources that no longer exist
      const validSlugs = new Set(sources.map(s => s.config.slug))
      setEnabledSourceSlugs(prev => {
        const healed = prev.filter(s => validSlugs.has(s))
        if (healed.length !== prev.length && activeWorkspaceId) {
          window.electronAPI.updateWorkspaceSetting(activeWorkspaceId, 'enabledSourceSlugs', healed)
        }
        return healed
      })
    })
    return cleanup
  }, [activeWorkspaceId])

  // Save workspace setting
  const updateWorkspaceSetting = useCallback(
    async <K extends keyof WorkspaceSettings>(key: K, value: WorkspaceSettings[K]) => {
      if (!window.electronAPI || !activeWorkspaceId) return false

      try {
        await window.electronAPI.updateWorkspaceSetting(activeWorkspaceId, key, value)
        return true
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        console.error(`Failed to save ${String(key)}:`, error)
        toast.error(t("settings.workspace.failedToSave", { setting: String(key) }), {
          description: message,
        })
        return false
      }
    },
    [activeWorkspaceId, t]
  )

  // Workspace icon upload handler
  const handleIconUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !activeWorkspaceId || !window.electronAPI) return

    // Validate file type
    const validTypes = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp', 'image/gif']
    if (!validTypes.includes(file.type)) {
      console.error('Invalid file type:', file.type)
      return
    }

    setIsUploadingIcon(true)
    try {
      // Read file as base64
      const buffer = await file.arrayBuffer()
      const base64 = btoa(
        new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
      )

      // Determine extension from mime type
      const extMap: Record<string, string> = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/svg+xml': 'svg',
        'image/webp': 'webp',
        'image/gif': 'gif',
      }
      const ext = extMap[file.type] || 'png'

      // Upload to workspace
      await window.electronAPI.writeWorkspaceImage(activeWorkspaceId, `./icon.${ext}`, base64, file.type)

      // Reload the icon locally for settings display
      const iconData = await window.electronAPI.readWorkspaceImage(activeWorkspaceId, `./icon.${ext}`)
      if (iconData) {
        if (ext === 'svg' && !iconData.startsWith('data:')) {
          setWsIconUrl(`data:image/svg+xml;base64,${btoa(iconData)}`)
        } else {
          setWsIconUrl(iconData)
        }
      }

      // Refresh workspaces to update sidebar icon
      onRefreshWorkspaces?.()
    } catch (error) {
      console.error('Failed to upload icon:', error)
    } finally {
      setIsUploadingIcon(false)
      // Reset the input so the same file can be selected again
      e.target.value = ''
    }
  }, [activeWorkspaceId, onRefreshWorkspaces])

  // Workspace settings handlers
  const handlePermissionModeChange = useCallback(
    async (newMode: PermissionMode) => {
      setPermissionMode(newMode)
      await updateWorkspaceSetting('permissionMode', newMode)
    },
    [updateWorkspaceSetting]
  )

  const handleWorkingDirectorySelected = useCallback(async (selectedPath: string) => {
    const saved = await updateWorkspaceSetting('workingDirectory', selectedPath)
    if (saved) {
      setWorkingDirectory(selectedPath)
    }
  }, [updateWorkspaceSetting])

  const {
    pickDirectory: handleChangeWorkingDirectory,
    showServerBrowser: showWdBrowser,
    serverBrowserMode: wdBrowserMode,
    cancelServerBrowser: cancelWdBrowser,
    confirmServerBrowser: confirmWdBrowser,
  } = useDirectoryPicker(handleWorkingDirectorySelected)

  const handleClearWorkingDirectory = useCallback(async () => {
    if (!window.electronAPI) return

    const saved = await updateWorkspaceSetting('workingDirectory', undefined)
    if (saved) {
      setWorkingDirectory('')
    }
  }, [updateWorkspaceSetting])

  const handleCodingModeDefaultChange = useCallback(
    async (enabled: boolean) => {
      setCodingModeDefault(enabled)
      await updateWorkspaceSetting('codingMode', enabled)
    },
    [updateWorkspaceSetting]
  )

  const handleLocalMcpEnabledChange = useCallback(
    async (enabled: boolean) => {
      setLocalMcpEnabled(enabled)
      await updateWorkspaceSetting('localMcpEnabled', enabled)
    },
    [updateWorkspaceSetting]
  )

  const handleSourceToggle = useCallback(
    async (slug: string, checked: boolean) => {
      const newSlugs = checked
        ? [...enabledSourceSlugs, slug]
        : enabledSourceSlugs.filter(s => s !== slug)
      setEnabledSourceSlugs(newSlugs)
      await updateWorkspaceSetting('enabledSourceSlugs', newSlugs)
    },
    [enabledSourceSlugs, updateWorkspaceSetting]
  )

  const handleModeToggle = useCallback(
    async (mode: PermissionMode, checked: boolean) => {
      if (!window.electronAPI) return

      // Calculate what the new modes would be
      // Keep the cycle in strictness order (Explore → Ask → Guarded → Execute)
      const newModes = PERMISSION_MODE_ORDER.filter((m) => (m === mode ? checked : enabledModes.includes(m)))

      // Validate: at least 2 modes required
      if (newModes.length < 2) {
        setModeCyclingError(t('settings.workspace.atLeast2Modes'))
        // Auto-dismiss after 2 seconds
        setTimeout(() => {
          setModeCyclingError(null)
        }, 2000)
        return
      }

      // Update state and persist
      setEnabledModes(newModes)
      setModeCyclingError(null)
      try {
        await updateWorkspaceSetting('cyclablePermissionModes', newModes)
      } catch (error) {
        console.error('Failed to save mode cycling settings:', error)
      }
    },
    [enabledModes, updateWorkspaceSetting, t]
  )

  const headerActions = <HeaderMenu route={routes.view.settings('workspace')} helpFeature="workspaces" />

  // Show empty state if no workspace is active
  if (!activeWorkspaceId) {
    return (
      <SettingsPageState actions={headerActions}>
        <p>{t("settings.workspace.noWorkspaceSelected")}</p>
      </SettingsPageState>
    )
  }

  // Show loading state
  if (isLoadingWorkspace) {
    return (
      <SettingsPageState actions={headerActions}>
        <Spinner className="text-tertiary" />
      </SettingsPageState>
    )
  }

  return (
    <SettingsPage
      title={t("settings.workspace.workspaceSettings")}
      description={t("settings.workspace.description")}
      actions={headerActions}
    >
      {/* Workspace Info */}
      <SettingsSection title={t("settings.workspace.workspaceInfo")}>
        <SettingsCard>
          <SettingsRow
            label={t("common.name")}
            description={wsName || t("settings.workspace.untitled")}
            action={
              <Button
                variant="secondary"
                size="md"
                onClick={() => {
                  setWsNameEditing(wsName)
                  setRenameDialogOpen(true)
                }}
              >
                {t("common.edit")}
              </Button>
            }
          />
          <SettingsRow
            label={t("settings.workspace.icon")}
            action={
              <label className="cursor-pointer rounded-md has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
                  onChange={handleIconUpload}
                  className="sr-only"
                  disabled={isUploadingIcon}
                />
                <span className={buttonVariants({ variant: 'secondary', size: 'md' })}>
                  {isUploadingIcon ? t("common.uploading") : t("common.change")}
                </span>
              </label>
            }
          >
            <div
              className={cn(
                'size-6 rounded-full overflow-hidden bg-fill-hover flex items-center justify-center',
                'ring-1 ring-border'
              )}
            >
              {isUploadingIcon ? (
                <Spinner className="text-caption text-tertiary" />
              ) : wsIconUrl ? (
                <img src={wsIconUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-caption text-secondary">
                  {wsName?.charAt(0)?.toUpperCase() || 'W'}
                </span>
              )}
            </div>
          </SettingsRow>
        </SettingsCard>

        <RenameDialog
          open={renameDialogOpen}
          onOpenChange={setRenameDialogOpen}
          title={t("settings.workspace.renameWorkspace")}
          value={wsNameEditing}
          onValueChange={setWsNameEditing}
          onSubmit={() => {
            const newName = wsNameEditing.trim()
            if (newName && newName !== wsName) {
              setWsName(newName)
              updateWorkspaceSetting('name', newName)
              onRefreshWorkspaces?.()
            }
            setRenameDialogOpen(false)
          }}
          placeholder={t("settings.workspace.enterWorkspaceName")}
        />
      </SettingsSection>

      {/* Permissions */}
      <SettingsSection title={t("settings.workspace.permissionsSection")}>
        <SettingsCard>
          <SettingsMenuSelectRow
            label={t("settings.workspace.defaultMode")}
            description={t("settings.workspace.defaultModeDesc")}
            value={permissionMode}
            onValueChange={(v) => handlePermissionModeChange(v as PermissionMode)}
            options={defaultModeOptions.map((m) => {
              const option: Record<PermissionMode, { label: string; description: string }> = {
                'safe': { label: t("mode.explore"), description: t("mode.exploreDesc") },
                'ask': { label: t("mode.ask"), description: t("mode.askDesc") },
                'guarded': { label: t("mode.guarded"), description: t("mode.guardedDesc") },
                'allow-all': { label: t("mode.execute"), description: t("mode.executeDesc") },
              }
              return { value: m, ...option[m] }
            })}
          />
        </SettingsCard>
      </SettingsSection>

      {/* Mode Cycling */}
      <SettingsSection
        title={t("settings.workspace.modeCycling")}
        description={t("settings.workspace.modeCyclingDesc")}
      >
        <SettingsCard>
          {cyclingModeOptions.map((m) => {
            const modeTranslations: Record<PermissionMode, { label: string; desc: string }> = {
              'safe': { label: t("mode.explore"), desc: t("mode.exploreFullDesc") },
              'ask': { label: t("mode.askToEdit"), desc: t("mode.askFullDesc") },
              'guarded': { label: t("mode.guarded"), desc: t("mode.guardedFullDesc") },
              'allow-all': { label: t("mode.execute"), desc: t("mode.executeFullDesc") },
            }
            const isEnabled = enabledModes.includes(m)
            return (
              <SettingsToggle
                key={m}
                label={modeTranslations[m].label}
                description={modeTranslations[m].desc}
                checked={isEnabled}
                onCheckedChange={(checked) => handleModeToggle(m, checked)}
              />
            )
          })}
        </SettingsCard>
        {/* Appears in place (fade + 4px drop, no height animation) */}
        <AnimatedCollapsibleContent isOpen={!!modeCyclingError}>
          <p role="status" className="mt-1 text-label-sm text-destructive">
            {modeCyclingError}
          </p>
        </AnimatedCollapsibleContent>
      </SettingsSection>

      {/* Default Sources */}
      <SettingsSection
        title={t("settings.workspace.defaultSources")}
        description={t("settings.workspace.defaultSourcesDesc")}
      >
        {availableSources.length > 0 ? (
          <SettingsCard>
            {availableSources.map((source) => (
              <SettingsToggle
                key={source.config.slug}
                label={
                  <span className="inline-flex items-center gap-2">
                    <SourceAvatar source={source} size="xs" />
                    {source.config.name}
                  </span>
                }
                description={source.config.tagline}
                checked={enabledSourceSlugs.includes(source.config.slug)}
                onCheckedChange={(checked) => handleSourceToggle(source.config.slug, checked)}
              />
            ))}
          </SettingsCard>
        ) : (
          <p className="text-label text-tertiary">{t("settings.workspace.noSourcesConfigured")}</p>
        )}
      </SettingsSection>

      {/* Advanced */}
      <SettingsSection title={t("settings.workspace.advanced")}>
        <SettingsCard>
          <SettingsRow
            label={t("settings.workspace.defaultWorkingDir")}
            description={workingDirectory || t("settings.workspace.defaultWorkingDirDesc")}
            action={
              <div className="flex items-center gap-2">
                {workingDirectory && (
                  <Button variant="ghost" size="md" onClick={handleClearWorkingDirectory}>
                    {t("common.clear")}
                  </Button>
                )}
                <Button variant="secondary" size="md" onClick={handleChangeWorkingDirectory}>
                  {t("common.change")}
                </Button>
              </div>
            }
          />
          <SettingsToggle
            label={t("settings.workspace.codingModeDefault")}
            description={t("settings.workspace.codingModeDefaultDesc")}
            checked={codingModeDefault}
            onCheckedChange={handleCodingModeDefaultChange}
          />
          <SettingsToggle
            label={t("settings.workspace.localMcpServers")}
            description={t("settings.workspace.localMcpServersDesc")}
            checked={localMcpEnabled}
            onCheckedChange={handleLocalMcpEnabledChange}
          />
        </SettingsCard>
      </SettingsSection>

      <ServerDirectoryBrowser
        open={showWdBrowser}
        mode={wdBrowserMode}
        onSelect={confirmWdBrowser}
        onCancel={cancelWdBrowser}
        initialPath={workingDirectory || undefined}
      />
    </SettingsPage>
  )
}
