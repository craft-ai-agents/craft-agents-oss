/**
 * AppSettingsPage
 *
 * Global app-level settings that apply across all workspaces.
 *
 * Settings:
 * - Notifications
 * - About (version, updates)
 *
 * Note: AI settings (connections, model, thinking) have been moved to AiSettingsPage.
 * Note: Appearance settings (theme, font) have been moved to AppearanceSettingsPage.
 */

import { useState, useEffect, useCallback } from 'react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { routes } from '@/lib/navigate'
import { Spinner } from '@craft-agent/ui'
import type { DetailsPageMeta } from '@/lib/navigation-registry'

import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsToggle,
  SettingsMenuSelectRow,
} from '@/components/settings'
import { useUpdateChecker } from '@/hooks/useUpdateChecker'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'app',
}

// ============================================
// Main Component
// ============================================

export default function AppSettingsPage() {
  // Notifications state
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)

  // Power state
  const [keepAwakeEnabled, setKeepAwakeEnabled] = useState(false)

  // Editor state
  const [defaultEditor, setDefaultEditor] = useState('vscode')

  // Auto-update state
  const updateChecker = useUpdateChecker()
  const [isCheckingForUpdates, setIsCheckingForUpdates] = useState(false)

  const handleCheckForUpdates = useCallback(async () => {
    setIsCheckingForUpdates(true)
    try {
      await updateChecker.checkForUpdates()
    } finally {
      setIsCheckingForUpdates(false)
    }
  }, [updateChecker])

  // Load settings on mount
  const loadSettings = useCallback(async () => {
    if (!window.electronAPI) return
    try {
      const [notificationsOn, keepAwakeOn, editorValue] = await Promise.all([
        window.electronAPI.getNotificationsEnabled(),
        window.electronAPI.getKeepAwakeWhileRunning(),
        window.electronAPI.getDefaultEditor(),
      ])
      setNotificationsEnabled(notificationsOn)
      setKeepAwakeEnabled(keepAwakeOn)
      setDefaultEditor(editorValue)
    } catch (error) {
      console.error('Failed to load settings:', error)
    }
  }, [])

  useEffect(() => {
    loadSettings()
  }, [])

  const handleNotificationsEnabledChange = useCallback(async (enabled: boolean) => {
    setNotificationsEnabled(enabled)
    await window.electronAPI.setNotificationsEnabled(enabled)
  }, [])

  const handleKeepAwakeEnabledChange = useCallback(async (enabled: boolean) => {
    setKeepAwakeEnabled(enabled)
    await window.electronAPI.setKeepAwakeWhileRunning(enabled)
  }, [])

  const handleDefaultEditorChange = useCallback((value: string) => {
    setDefaultEditor(value)
    window.electronAPI.setDefaultEditor(value)
  }, [])

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title="App" actions={<HeaderMenu route={routes.view.settings('app')} helpFeature="app-settings" />} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto">
            <div className="space-y-8">
              {/* Notifications */}
              <SettingsSection title="Notifications">
                <SettingsCard>
                  <SettingsToggle
                    label="Desktop notifications"
                    description="Get notified when AI finishes working in a chat."
                    checked={notificationsEnabled}
                    onCheckedChange={handleNotificationsEnabledChange}
                  />
                </SettingsCard>
              </SettingsSection>

              {/* Power */}
              <SettingsSection title="Power">
                <SettingsCard>
                  <SettingsToggle
                    label="Keep screen awake"
                    description="Prevent the screen from turning off while sessions are running."
                    checked={keepAwakeEnabled}
                    onCheckedChange={handleKeepAwakeEnabledChange}
                  />
                </SettingsCard>
              </SettingsSection>

              {/* Editor */}
              <SettingsSection title="Editor" description="Default editor for opening working directories.">
                <SettingsCard>
                  <SettingsMenuSelectRow
                    label="Default editor"
                    description="Editor used when opening directories from the working directory menu"
                    value={defaultEditor}
                    onValueChange={handleDefaultEditorChange}
                    options={[
                      { value: 'vscode', label: 'VS Code', description: 'Visual Studio Code' },
                      { value: 'cursor', label: 'Cursor', description: 'Cursor AI Editor' },
                      { value: 'windsurf', label: 'Windsurf', description: 'Windsurf Editor' },
                    ]}
                  />
                </SettingsCard>
              </SettingsSection>

              {/* About */}
              <SettingsSection title="About">
                <SettingsCard>
                  <SettingsRow label="Version">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">
                        {updateChecker.updateInfo?.currentVersion ?? 'Loading...'}
                      </span>
                      {updateChecker.isDownloading && updateChecker.updateInfo?.latestVersion && (
                        <div className="flex items-center gap-2 text-muted-foreground text-sm">
                          <Spinner className="w-3 h-3" />
                          <span>Downloading v{updateChecker.updateInfo.latestVersion} ({updateChecker.downloadProgress}%)</span>
                        </div>
                      )}
                    </div>
                  </SettingsRow>
                  <SettingsRow label="Check for updates">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCheckForUpdates}
                      disabled={isCheckingForUpdates}
                    >
                      {isCheckingForUpdates ? (
                        <>
                          <Spinner className="mr-1.5" />
                          Checking...
                        </>
                      ) : (
                        'Check Now'
                      )}
                    </Button>
                  </SettingsRow>
                  {updateChecker.isReadyToInstall && updateChecker.updateInfo?.latestVersion && (
                    <SettingsRow label="Update ready">
                      <Button
                        size="sm"
                        onClick={updateChecker.installUpdate}
                      >
                        Restart to Update to v{updateChecker.updateInfo.latestVersion}
                      </Button>
                    </SettingsRow>
                  )}
                </SettingsCard>
              </SettingsSection>
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
