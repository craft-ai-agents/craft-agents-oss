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
import { motion, AnimatePresence } from 'motion/react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useAppShellContext } from '@/context/AppShellContext'
import { cn } from '@/lib/utils'
import { navigate, routes } from '@/lib/navigate'
import { Spinner } from '@craft-agent/ui'
import { RenameDialog } from '@/components/ui/rename-dialog'
import type { PermissionMode, WorkspaceSettings, LoadedSource } from '../../../shared/types'
import { useDirectoryPicker } from '@/hooks/useDirectoryPicker'
import { ServerDirectoryBrowser } from '@/components/ServerDirectoryBrowser'
import { PERMISSION_MODE_CONFIG } from '@craft-agent/shared/agent/mode-types'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { SourceAvatar } from '@/components/ui/source-avatar'
import { toast } from 'sonner'

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
  // Get active workspace from context
  const appShellContext = useAppShellContext()
  const activeWorkspaceId = appShellContext.activeWorkspaceId
  const activeWorkspace = appShellContext.workspaces.find(workspace => workspace.id === activeWorkspaceId) ?? null
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
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [isDeletingWorkspace, setIsDeletingWorkspace] = useState(false)
  const workspaceSettingsLoadRequestIdRef = React.useRef(0)

  // Default sources state
  const [availableSources, setAvailableSources] = useState<LoadedSource[]>([])
  const [enabledSourceSlugs, setEnabledSourceSlugs] = useState<string[]>([])

  // Mode cycling state
  const [enabledModes, setEnabledModes] = useState<PermissionMode[]>(['safe', 'ask', 'allow-all'])
  const [modeCyclingError, setModeCyclingError] = useState<string | null>(null)

  // Load workspace settings when active workspace changes
  useEffect(() => {
    const loadWorkspaceSettings = async () => {
      if (!window.electronAPI || !activeWorkspaceId) {
        setIsLoadingWorkspace(false)
        return
      }

      const requestId = ++workspaceSettingsLoadRequestIdRef.current
      setIsLoadingWorkspace(true)
      try {
        const settings = await window.electronAPI.getWorkspaceSettings(activeWorkspaceId)
        if (requestId !== workspaceSettingsLoadRequestIdRef.current) return
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

          // Load available sources and auto-heal stale slugs
          const sources = await window.electronAPI.getSources(activeWorkspaceId)
          if (requestId !== workspaceSettingsLoadRequestIdRef.current) return
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
            if (requestId !== workspaceSettingsLoadRequestIdRef.current) return
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
        if (requestId !== workspaceSettingsLoadRequestIdRef.current) return
        console.error('Failed to load workspace settings:', error)
      } finally {
        if (requestId !== workspaceSettingsLoadRequestIdRef.current) return
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
        toast.error(`Failed to save ${String(key)}`, {
          description: message,
        })
        return false
      }
    },
    [activeWorkspaceId]
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
        setModeCyclingError('At least 2 modes required')
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
    [enabledModes, updateWorkspaceSetting]
  )

  const handleDeleteWorkspace = useCallback(async () => {
    if (!window.electronAPI || !activeWorkspaceId || !activeWorkspace) return

    const remainingWorkspaces = appShellContext.workspaces.filter(workspace => workspace.id !== activeWorkspaceId)
    const fallbackWorkspace = remainingWorkspaces[0] ?? null

    if (!fallbackWorkspace) {
      toast.error('At least one workspace must remain')
      return
    }

    setIsDeletingWorkspace(true)
    try {
      const deleted = await window.electronAPI.deleteWorkspace(activeWorkspaceId)
      if (!deleted) {
        throw new Error('Workspace could not be deleted')
      }
      await appShellContext.onSelectWorkspace(fallbackWorkspace.id)
      onRefreshWorkspaces?.()
      navigate(routes.view.settings('workspace'))
      toast.success(`Deleted ${activeWorkspace.name}`)
      setDeleteDialogOpen(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      toast.error('Failed to delete workspace', {
        description: message,
      })
    } finally {
      setIsDeletingWorkspace(false)
    }
  }, [activeWorkspace, activeWorkspaceId, appShellContext.workspaces, onRefreshWorkspaces])

  // Show empty state if no workspace is active
  if (!activeWorkspaceId) {
    return (
      <div className="h-full flex flex-col">
        <PanelHeader title="Workspace Settings" actions={<HeaderMenu route={routes.view.settings('workspace')} helpFeature="workspaces" />} />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">No workspace selected</p>
        </div>
      </div>
    )
  }

  // Show loading state
  if (isLoadingWorkspace) {
    return (
      <div className="h-full flex flex-col">
        <PanelHeader title="Workspace Settings" actions={<HeaderMenu route={routes.view.settings('workspace')} helpFeature="workspaces" />} />
        <div className="flex-1 flex items-center justify-center">
          <Spinner className="text-muted-foreground" />
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title="Workspace Settings" actions={<HeaderMenu route={routes.view.settings('workspace')} helpFeature="workspaces" />} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto">
          <div className="space-y-8">
            {/* Workspace Info */}
            <SettingsSection title="Workspace Info">
              <SettingsCard>
                <SettingsRow
                  label="Name"
                  description={wsName || 'Untitled'}
                  action={
                    <button
                      type="button"
                      onClick={() => {
                        setWsNameEditing(wsName)
                        setRenameDialogOpen(true)
                      }}
                      className="inline-flex items-center h-8 px-3 text-sm rounded-lg bg-background shadow-minimal hover:bg-foreground/[0.02] transition-colors"
                    >
                      Edit
                    </button>
                  }
                />
                <SettingsRow
                  label="Icon"
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
                        {isUploadingIcon ? 'Uploading...' : 'Change'}
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
                      <span className="text-xs font-medium text-muted-foreground">
                        {wsName?.charAt(0)?.toUpperCase() || 'W'}
                      </span>
                    )}
                  </div>
                </SettingsRow>
              </SettingsCard>

              <RenameDialog
                open={renameDialogOpen}
                onOpenChange={setRenameDialogOpen}
                title="Rename workspace"
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
                placeholder="Enter workspace name..."
              />
            </SettingsSection>

            {/* Permissions */}
            <SettingsSection title="Permissions">
              <SettingsCard>
                <SettingsMenuSelectRow
                  label="Default mode"
                  description="Control what AI can do"
                  value={permissionMode}
                  onValueChange={(v) => handlePermissionModeChange(v as PermissionMode)}
                  options={[
                    { value: 'safe', label: PERMISSION_MODE_CONFIG['safe'].shortName, description: 'Read-only, no changes allowed' },
                    { value: 'ask', label: PERMISSION_MODE_CONFIG['ask'].shortName, description: 'Prompts before making edits' },
                    { value: 'allow-all', label: PERMISSION_MODE_CONFIG['allow-all'].shortName, description: 'Full autonomous execution' },
                  ]}
                />
              </SettingsCard>
            </SettingsSection>

            {/* Mode Cycling */}
            <SettingsSection
              title="Mode Cycling"
              description="Select which modes to cycle through with Shift+Tab"
            >
              <SettingsCard>
                {(['safe', 'ask', 'allow-all'] as const).map((m) => {
                  const config = PERMISSION_MODE_CONFIG[m]
                  const isEnabled = enabledModes.includes(m)
                  return (
                    <SettingsToggle
                      key={m}
                      label={config.displayName}
                      description={config.description}
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
                    className="text-xs text-destructive mt-1 overflow-hidden"
                  >
                    {modeCyclingError}
                  </motion.p>
                )}
              </AnimatePresence>
            </SettingsSection>

            {/* Default Sources */}
            <SettingsSection
              title="Default Sources"
              description="Sources auto-enabled for new sessions"
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
                <p className="text-sm text-muted-foreground">No sources configured in this workspace.</p>
              )}
            </SettingsSection>

            {/* Advanced */}
            <SettingsSection title="Advanced">
              <SettingsCard>
                <SettingsRow
                  label="Default Working Directory"
                  description={workingDirectory || 'Not set (uses session folder)'}
                  action={
                    <div className="flex items-center gap-2">
                      {workingDirectory && (
                        <button
                          type="button"
                          onClick={handleClearWorkingDirectory}
                          className="inline-flex items-center h-8 px-3 text-sm rounded-lg bg-background shadow-minimal hover:bg-foreground/[0.02] transition-colors text-foreground/60 hover:text-foreground"
                        >
                          Clear
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleChangeWorkingDirectory}
                        className="inline-flex items-center h-8 px-3 text-sm rounded-lg bg-background shadow-minimal hover:bg-foreground/[0.02] transition-colors"
                      >
                        Change...
                      </button>
                    </div>
                  }
                />
                <SettingsToggle
                  label="Local MCP Servers"
                  description="Enable stdio subprocess servers"
                  checked={localMcpEnabled}
                  onCheckedChange={handleLocalMcpEnabledChange}
                />
              </SettingsCard>
            </SettingsSection>

            <SettingsSection
              title="Delete Workspace"
              description={
                activeWorkspace?.isRemote
                  ? 'Deletes this workspace from the remote server. Managed Craft workspace folders are removed; external folders are left in place.'
                  : 'Deletes this workspace from Craft. Managed Craft workspace folders are removed; external folders are left in place.'
              }
              variant="danger"
            >
              <SettingsCard>
                <SettingsRow
                  label={activeWorkspace?.name || 'Current workspace'}
                  description={activeWorkspace?.rootPath || 'Workspace path unavailable'}
                  action={
                    <Button variant="destructive" size="sm" onClick={() => setDeleteDialogOpen(true)}>
                      Delete
                    </Button>
                  }
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
      <Dialog open={deleteDialogOpen} onOpenChange={(open) => { if (!isDeletingWorkspace) setDeleteDialogOpen(open) }}>
        <DialogContent showCloseButton={!isDeletingWorkspace}>
          <DialogHeader>
            <DialogTitle>Delete Workspace</DialogTitle>
            <DialogDescription>
              Delete <strong>{activeWorkspace?.name || 'this workspace'}</strong>? Sessions and Craft-managed workspace files will be removed. External folders are not deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={isDeletingWorkspace}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteWorkspace} disabled={isDeletingWorkspace}>
              {isDeletingWorkspace ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
