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
import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'motion/react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { useAppShellContext } from '@/context/AppShellContext'
import { cn } from '@/lib/utils'
import { routes } from '@/lib/navigate'
import { Spinner } from '@craft-agent/ui'
import { RenameDialog } from '@/components/ui/rename-dialog'
import type { PermissionMode, WorkspaceSettings, LoadedSource, TeamContextPreview, UserProfile } from '../../../shared/types'
import { useDirectoryPicker } from '@/hooks/useDirectoryPicker'
import { ServerDirectoryBrowser } from '@/components/ServerDirectoryBrowser'
import { PERMISSION_MODE_CONFIG } from '@craft-agent/shared/agent/mode-types'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { SourceAvatar } from '@/components/ui/source-avatar'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { RefreshCw } from 'lucide-react'

import {
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
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(true)

  // Team public knowledge state
  const [teamPublicKnowledgeEnabled, setTeamPublicKnowledgeEnabled] = useState(false)
  const [teamPublicKnowledgeDocumentsCount, setTeamPublicKnowledgeDocumentsCount] = useState(0)
  const [teamPublicKnowledgeRefreshing, setTeamPublicKnowledgeRefreshing] = useState(false)

  // Team context preview state
  const [teamContextPreview, setTeamContextPreview] = useState<TeamContextPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewSampleMessage, setPreviewSampleMessage] = useState('')
  const previewDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Default sources state
  const [availableSources, setAvailableSources] = useState<LoadedSource[]>([])
  const [enabledSourceSlugs, setEnabledSourceSlugs] = useState<string[]>([])

  // Mode cycling state
  const [enabledModes, setEnabledModes] = useState<PermissionMode[]>(['safe', 'ask', 'allow-all'])
  const [modeCyclingError, setModeCyclingError] = useState<string | null>(null)

  // User Profile state
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null)
  const [userProfileFetchedAt, setUserProfileFetchedAt] = useState<number | null>(null)
  const [userProfileRefreshing, setUserProfileRefreshing] = useState(false)

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
          // Load cyclable permission modes from workspace settings
          if (settings.cyclablePermissionModes && settings.cyclablePermissionModes.length >= 2) {
            setEnabledModes(settings.cyclablePermissionModes)
          }

          // Load default source slugs
          const savedSlugs = settings.enabledSourceSlugs ?? []

          // Load team public knowledge config
          setTeamPublicKnowledgeEnabled(settings.teamPublicKnowledgeEnabled ?? false)
          setTeamPublicKnowledgeDocumentsCount(settings.teamPublicKnowledgeDocumentsCount ?? 0)

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

        // Load user profile
        try {
          const profile = await window.electronAPI.getUserProfile()
          setUserProfile(profile)
          if (profile) {
            setUserProfileFetchedAt(Date.now())
          }
        } catch (error) {
          console.error('Failed to load user profile:', error)
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

  // Load team context preview when team knowledge state changes
  useEffect(() => {
    if (!window.electronAPI || !activeWorkspaceId) return

    const loadPreview = async () => {
      setPreviewLoading(true)
      try {
        const preview = await window.electronAPI.getTeamContextPreview(activeWorkspaceId, previewSampleMessage || undefined)
        setTeamContextPreview(preview)
      } catch (error) {
        console.error('Failed to load team context preview:', error)
      } finally {
        setPreviewLoading(false)
      }
    }

    // Debounce preview loading when sample message changes
    if (previewDebounceRef.current) {
      clearTimeout(previewDebounceRef.current)
    }
    const timer = setTimeout(loadPreview, previewSampleMessage ? 300 : 0)
    previewDebounceRef.current = timer

    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [activeWorkspaceId, teamPublicKnowledgeEnabled, previewSampleMessage])

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

  const handleLocalMcpEnabledChange = useCallback(
    async (enabled: boolean) => {
      setLocalMcpEnabled(enabled)
      await updateWorkspaceSetting('localMcpEnabled', enabled)
    },
    [updateWorkspaceSetting]
  )

  const handleTeamPublicKnowledgeEnabledChange = useCallback(
    async (enabled: boolean) => {
      setTeamPublicKnowledgeEnabled(enabled)
      await updateWorkspaceSetting('teamPublicKnowledgeEnabled', enabled)
    },
    [updateWorkspaceSetting]
  )

  const handleTeamPublicKnowledgeRefresh = useCallback(async () => {
    if (!window.electronAPI || !activeWorkspaceId) return
    setTeamPublicKnowledgeRefreshing(true)
    try {
      const summary = await window.electronAPI.refreshTeamPublicKnowledge(activeWorkspaceId)
      const settings = await window.electronAPI.getWorkspaceSettings(activeWorkspaceId)
      setTeamPublicKnowledgeDocumentsCount(settings?.teamPublicKnowledgeDocumentsCount ?? 0)
      const preview = await window.electronAPI.getTeamContextPreview(activeWorkspaceId, previewSampleMessage || undefined)
      setTeamContextPreview(preview)
      const description = summary?.manifestError
        ? summary.manifestError
        : `Added ${summary?.added ?? 0}, updated ${summary?.updated ?? 0}, removed ${summary?.removed ?? 0}, stale ${summary?.stale ?? 0}`
      toast.success('Team knowledge refreshed', { description })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      toast.error('Failed to refresh team knowledge', { description: message })
    } finally {
      setTeamPublicKnowledgeRefreshing(false)
    }
  }, [activeWorkspaceId, previewSampleMessage])

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
      const newModes = checked
        ? [...enabledModes, mode]
        : enabledModes.filter((m) => m !== mode)

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

  // User Profile refresh handler
  const handleRefreshUserProfile = useCallback(async () => {
    if (!window.electronAPI) return
    setUserProfileRefreshing(true)
    try {
      const result = await window.electronAPI.refreshUserProfile()
      if (result) {
        setUserProfile(result)
        setUserProfileFetchedAt(Date.now())
      }
    } catch (error) {
      console.error('Failed to refresh user profile:', error)
    } finally {
      setUserProfileRefreshing(false)
    }
  }, [])

  // Show empty state if no workspace is active
  if (!activeWorkspaceId) {
    return (
      <div className="h-full flex flex-col">
        <PanelHeader title={t("settings.workspace.workspaceSettings")} actions={<HeaderMenu route={routes.view.settings('workspace')} helpFeature="workspaces" />} />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">{t("settings.workspace.noWorkspaceSelected")}</p>
        </div>
      </div>
    )
  }

  // Show loading state
  if (isLoadingWorkspace) {
    return (
      <div className="h-full flex flex-col">
        <PanelHeader title={t("settings.workspace.workspaceSettings")} actions={<HeaderMenu route={routes.view.settings('workspace')} helpFeature="workspaces" />} />
        <div className="flex-1 flex items-center justify-center">
          <Spinner className="text-muted-foreground" />
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title={t("settings.workspace.workspaceSettings")} actions={<HeaderMenu route={routes.view.settings('workspace')} helpFeature="workspaces" />} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto">
          <div className="space-y-8">
            {/* Workspace Info */}
            <SettingsSection title={t("settings.workspace.workspaceInfo")}>
              <SettingsCard>
                <SettingsRow
                  label={t("common.name")}
                  description={wsName || t("settings.workspace.untitled")}
                  action={
                    <button
                      type="button"
                      onClick={() => {
                        setWsNameEditing(wsName)
                        setRenameDialogOpen(true)
                      }}
                      className="inline-flex items-center h-8 px-3 text-sm rounded-lg bg-background shadow-minimal hover:bg-foreground/[0.02] transition-colors"
                    >
                      {t("common.edit")}
                    </button>
                  }
                />
                <SettingsRow
                  label={t("settings.workspace.icon")}
                  action={
                    <label className="cursor-pointer">
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
                        onChange={handleIconUpload}
                        className="sr-only"
                        disabled={isUploadingIcon}
                      />
                      <span className="inline-flex items-center h-8 px-3 text-sm rounded-lg bg-background shadow-minimal hover:bg-foreground/[0.02] transition-colors">
                        {isUploadingIcon ? t("common.uploading") : t("common.change")}
                      </span>
                    </label>
                  }
                >
                  <div
                    className={cn(
                      'w-6 h-6 rounded-full overflow-hidden bg-foreground/5 flex items-center justify-center',
                      'ring-1 ring-border/50'
                    )}
                  >
                    {isUploadingIcon ? (
                      <Spinner className="text-muted-foreground text-[8px]" />
                    ) : wsIconUrl ? (
                      <img src={wsIconUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-sm font-medium text-muted-foreground">
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
                  options={[
                    { value: 'safe', label: t("mode.explore"), description: t("mode.exploreDesc") },
                    { value: 'ask', label: t("mode.ask"), description: t("mode.askDesc") },
                    { value: 'allow-all', label: t("mode.execute"), description: t("mode.executeDesc") },
                  ]}
                />
              </SettingsCard>
            </SettingsSection>

            {/* Mode Cycling */}
            <SettingsSection
              title={t("settings.workspace.modeCycling")}
              description={t("settings.workspace.modeCyclingDesc")}
            >
              <SettingsCard>
                {(['safe', 'ask', 'allow-all'] as const).map((m) => {
                  const modeTranslations: Record<string, { label: string; desc: string }> = {
                    'safe': { label: t("mode.explore"), desc: t("mode.exploreFullDesc") },
                    'ask': { label: t("mode.askToEdit"), desc: t("mode.askFullDesc") },
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
              <AnimatePresence>
                {modeCyclingError && (
                  <motion.p
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                    className="text-sm text-destructive mt-1 overflow-hidden"
                  >
                    {modeCyclingError}
                  </motion.p>
                )}
              </AnimatePresence>
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
                <p className="text-sm text-muted-foreground">{t("settings.workspace.noSourcesConfigured")}</p>
              )}
            </SettingsSection>

            {/* Team Public Knowledge */}
            <SettingsSection
              title={t("settings.workspace.teamPublicKnowledge")}
              description={t("settings.workspace.teamPublicKnowledgeDesc")}
            >
              <SettingsCard>
                <SettingsToggle
                  label={t("settings.workspace.teamPublicKnowledgeToggle")}
                  description={
                    teamPublicKnowledgeDocumentsCount > 0
                      ? t("settings.workspace.teamPublicKnowledgeDocsCount", { count: teamPublicKnowledgeDocumentsCount })
                      : t("settings.workspace.teamPublicKnowledgeNoDocs")
                  }
                  checked={teamPublicKnowledgeEnabled}
                  onCheckedChange={handleTeamPublicKnowledgeEnabledChange}
                />
                {teamPublicKnowledgeEnabled && (
                  <SettingsRow
                    label="Refresh"
                    description="Fetch the team knowledge manifest and update all documents."
                    action={
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-2"
                        disabled={teamPublicKnowledgeRefreshing}
                        onClick={handleTeamPublicKnowledgeRefresh}
                      >
                        {teamPublicKnowledgeRefreshing ? (
                          <Spinner className="h-4 w-4" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                        Refresh now
                      </Button>
                    }
                  />
                )}
              </SettingsCard>
            </SettingsSection>

            {/* Team Context Preview */}
            {teamPublicKnowledgeEnabled && teamContextPreview && (
              <SettingsSection
                title={t("settings.workspace.teamContextPreview")}
                description={t("settings.workspace.teamContextPreviewDesc")}
              >
                <SettingsCard>
                  {/* Trigger Terms */}
                  {teamContextPreview.triggerTerms.length > 0 && (
                    <div className="px-4 py-3">
                      <h4 className="text-sm font-medium mb-2">Trigger Terms</h4>
                      <div className="flex flex-wrap gap-1.5">
                        {teamContextPreview.triggerTerms.map((t, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center px-2 py-0.5 text-sm rounded-full bg-foreground/5 text-foreground/70 font-mono"
                          >
                            {t.term}
                            <span className="ml-1 text-foreground/40">({t.kind})</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Policy XML */}
                  <div className="border-t border-border/50 px-4 py-3">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-medium">Policy Block</h4>
                      <span className="text-sm text-muted-foreground">{teamContextPreview.documentsCount} document(s)</span>
                    </div>
                    {teamContextPreview.policyXml ? (
                      <pre className="text-sm font-mono text-foreground/70 bg-foreground/[0.03] rounded-lg p-3 overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">
                        {teamContextPreview.policyXml}
                      </pre>
                    ) : (
                      <p className="text-sm text-muted-foreground">No policy generated (no valid entries).</p>
                    )}
                  </div>

                  {/* Prefetch Preview */}
                  <div className="border-t border-border/50 px-4 py-3">
                    <h4 className="text-sm font-medium mb-2">Prefetch Test</h4>
                    <input
                      type="text"
                      value={previewSampleMessage}
                      onChange={(e) => setPreviewSampleMessage(e.target.value)}
                      placeholder="Type a message to test prefetch matching..."
                      className="w-full text-sm bg-background border border-border/50 rounded-lg px-3 py-2 mb-2 placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-foreground/20"
                    />
                    {previewLoading && (
                      <div className="flex items-center gap-2 py-2">
                        <Spinner className="text-muted-foreground text-[8px]" />
                        <span className="text-sm text-muted-foreground">Matching...</span>
                      </div>
                    )}
                    {!previewLoading && teamContextPreview.prefetchResults && teamContextPreview.prefetchResults.length > 0 && (
                      <div className="space-y-2 mt-1">
                        {teamContextPreview.prefetchResults.map((r, i) => (
                          <div key={i} className="text-sm bg-foreground/[0.03] rounded-lg p-3 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium">{r.kind}</span>
                              <span className={cn(
                                "px-1.5 py-0.5 rounded text-[10px] font-medium",
                                r.confidence >= 1
                                  ? "bg-green-500/10 text-green-600"
                                  : "bg-amber-500/10 text-amber-600"
                              )}>
                                {(r.confidence * 100).toFixed(0)}%
                              </span>
                              <span className="text-muted-foreground">{r.relevance}</span>
                            </div>
                            <p className="text-muted-foreground">{r.summary}</p>
                            <div className="flex gap-3 text-muted-foreground/60">
                              <span>Source: {r.source}</span>
                              <span>Updated: {new Date(r.updatedAt).toLocaleDateString()}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {!previewLoading && previewSampleMessage && (!teamContextPreview.prefetchResults || teamContextPreview.prefetchResults.length === 0) && (
                      <p className="text-sm text-muted-foreground">No matching entries found.</p>
                    )}
                  </div>
                </SettingsCard>
              </SettingsSection>
            )}

            {/* User Profile */}
            <SettingsSection
              title={t("settings.workspace.userProfile")}
              description={t("settings.workspace.userProfileDesc")}
            >
              <SettingsCard>
                {userProfile ? (
                  <>
                    <SettingsRow
                      label={t("settings.workspace.userProfileName")}
                      description={userProfile.userName || t("settings.workspace.userProfileNotConfigured")}
                    />
                    <SettingsRow
                      label={t("settings.workspace.userProfileYstId")}
                      description={userProfile.ystId || t("settings.workspace.userProfileNotConfigured")}
                    />
                    <SettingsRow
                      label={t("settings.workspace.userProfilePosition")}
                      description={userProfile.positon || t("settings.workspace.userProfileNotConfigured")}
                    />
                    <SettingsRow
                      label={t("settings.workspace.userProfileZuName")}
                      description={userProfile.zuName || t("settings.workspace.userProfileNotConfigured")}
                    />
                    <SettingsRow
                      label={t("settings.workspace.userProfileShiName")}
                      description={userProfile.shiName || t("settings.workspace.userProfileNotConfigured")}
                    />
                    <SettingsRow
                      label={t("settings.workspace.userProfileLeader")}
                      description={userProfile.leaderUserInfo || t("settings.workspace.userProfileNotConfigured")}
                    />
                    {userProfile.chargeModule && userProfile.chargeModule.length > 0 && (
                      <SettingsRow
                        label={t("settings.workspace.userProfileChargeModule")}
                        description={userProfile.chargeModule.map(module => module.appName || module.appCode).filter(Boolean).join(', ')}
                      />
                    )}
                  </>
                ) : (
                  <div className="px-4 py-3">
                    <p className="text-sm text-muted-foreground">{t("settings.workspace.userProfileNotConfigured")}</p>
                  </div>
                )}
                <div className="border-t border-border/50 px-4 py-3 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {userProfileFetchedAt
                      ? t("settings.workspace.userProfileLastRefresh", { time: new Date(userProfileFetchedAt).toLocaleString() })
                      : t("settings.workspace.userProfileNotConfigured")
                    }
                  </span>
                  <button
                    type="button"
                    onClick={handleRefreshUserProfile}
                    disabled={userProfileRefreshing}
                    className="inline-flex items-center h-8 px-3 text-sm rounded-lg bg-background shadow-minimal hover:bg-foreground/[0.02] transition-colors disabled:opacity-50"
                  >
                    {userProfileRefreshing ? t("settings.workspace.userProfileRefreshing") : t("settings.workspace.userProfileRefresh")}
                  </button>
                </div>
              </SettingsCard>
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
                        <button
                          type="button"
                          onClick={handleClearWorkingDirectory}
                          className="inline-flex items-center h-8 px-3 text-sm rounded-lg bg-background shadow-minimal hover:bg-foreground/[0.02] transition-colors text-foreground/60 hover:text-foreground"
                        >
                          {t("common.clear")}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleChangeWorkingDirectory}
                        className="inline-flex items-center h-8 px-3 text-sm rounded-lg bg-background shadow-minimal hover:bg-foreground/[0.02] transition-colors"
                      >
                        {t("common.change")}
                      </button>
                    </div>
                  }
                />
                <SettingsToggle
                  label={t("settings.workspace.localMcpServers")}
                  description={t("settings.workspace.localMcpServersDesc")}
                  checked={localMcpEnabled}
                  onCheckedChange={handleLocalMcpEnabledChange}
                />
              </SettingsCard>
            </SettingsSection>

          </div>
        </div>
        </ScrollArea>
      </div>
      <ServerDirectoryBrowser
        open={showWdBrowser}
        mode={wdBrowserMode}
        onSelect={confirmWdBrowser}
        onCancel={cancelWdBrowser}
        initialPath={workingDirectory || undefined}
      />
    </div>
  )
}
