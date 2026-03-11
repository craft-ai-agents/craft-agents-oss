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
import type { NetworkProxySettings } from '@craft-agent/shared/config'

import {
  SettingsSection,
  SettingsCard,
  SettingsCardContent,
  SettingsCardFooter,
  SettingsRow,
  SettingsInput,
  SettingsToggle,
} from '@/components/settings'
import { useUpdateChecker } from '@/hooks/useUpdateChecker'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'app',
}

interface ProxyFormState {
  enabled: boolean
  httpProxy: string
  httpsProxy: string
  noProxy: string
}

function toProxyFormState(settings?: NetworkProxySettings): ProxyFormState {
  return {
    enabled: settings?.enabled ?? false,
    httpProxy: settings?.httpProxy ?? '',
    httpsProxy: settings?.httpsProxy ?? '',
    noProxy: settings?.noProxy ?? '',
  }
}

function toNetworkProxySettings(form: ProxyFormState): NetworkProxySettings {
  return {
    enabled: form.enabled,
    httpProxy: form.httpProxy.trim() || undefined,
    httpsProxy: form.httpsProxy.trim() || undefined,
    noProxy: form.noProxy.trim() || undefined,
  }
}

function validateProxyUrl(value: string, label: string): string | null {
  if (!value.trim()) return null

  try {
    const parsed = new URL(value.trim())
    if (!parsed.protocol || !parsed.hostname) {
      return `${label} must include a valid protocol and host`
    }
  } catch {
    return `${label} must be a valid URL`
  }

  return null
}

// ============================================
// Main Component
// ============================================

export default function AppSettingsPage() {
  // Notifications state
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)

  // Power state
  const [keepAwakeEnabled, setKeepAwakeEnabled] = useState(false)

  // Proxy state
  const [proxyForm, setProxyForm] = useState<ProxyFormState>(() => toProxyFormState())
  const [savedProxyForm, setSavedProxyForm] = useState<ProxyFormState>(() => toProxyFormState())
  const [proxyError, setProxyError] = useState<string | null>(null)
  const [isSavingProxy, setIsSavingProxy] = useState(false)

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
      const [notificationsOn, keepAwakeOn, proxySettings] = await Promise.all([
        window.electronAPI.getNotificationsEnabled(),
        window.electronAPI.getKeepAwakeWhileRunning(),
        window.electronAPI.getNetworkProxySettings(),
      ])
      setNotificationsEnabled(notificationsOn)
      setKeepAwakeEnabled(keepAwakeOn)
      const proxyState = toProxyFormState(proxySettings)
      setProxyForm(proxyState)
      setSavedProxyForm(proxyState)
    } catch (error) {
      console.error('Failed to load settings:', error)
    }
  }, [])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  const handleNotificationsEnabledChange = useCallback(async (enabled: boolean) => {
    setNotificationsEnabled(enabled)
    await window.electronAPI.setNotificationsEnabled(enabled)
  }, [])

  const handleKeepAwakeEnabledChange = useCallback(async (enabled: boolean) => {
    setKeepAwakeEnabled(enabled)
    await window.electronAPI.setKeepAwakeWhileRunning(enabled)
  }, [])

  const updateProxyField = useCallback(<K extends keyof ProxyFormState>(key: K, value: ProxyFormState[K]) => {
    setProxyError(null)
    setProxyForm(prev => ({ ...prev, [key]: value }))
  }, [])

  const handleResetProxy = useCallback(() => {
    setProxyError(null)
    setProxyForm(savedProxyForm)
  }, [savedProxyForm])

  const handleSaveProxy = useCallback(async () => {
    const httpError = validateProxyUrl(proxyForm.httpProxy, 'HTTP proxy')
    if (httpError) {
      setProxyError(httpError)
      return
    }

    const httpsError = validateProxyUrl(proxyForm.httpsProxy, 'HTTPS proxy')
    if (httpsError) {
      setProxyError(httpsError)
      return
    }

    if (proxyForm.enabled && !proxyForm.httpProxy.trim() && !proxyForm.httpsProxy.trim()) {
      setProxyError('Enter at least one proxy URL before enabling the proxy')
      return
    }

    setIsSavingProxy(true)
    setProxyError(null)

    try {
      const settings = toNetworkProxySettings(proxyForm)
      await window.electronAPI.setNetworkProxySettings(settings)
      const persisted = toProxyFormState(await window.electronAPI.getNetworkProxySettings())
      setProxyForm(persisted)
      setSavedProxyForm(persisted)
    } catch (error) {
      setProxyError(error instanceof Error ? error.message : 'Failed to save proxy settings')
    } finally {
      setIsSavingProxy(false)
    }
  }, [proxyForm])

  const proxyIsDirty =
    proxyForm.enabled !== savedProxyForm.enabled ||
    proxyForm.httpProxy !== savedProxyForm.httpProxy ||
    proxyForm.httpsProxy !== savedProxyForm.httpsProxy ||
    proxyForm.noProxy !== savedProxyForm.noProxy

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

              <SettingsSection
                title="Network"
                description="Configure an app-level proxy for Node requests and embedded browser sessions."
              >
                <SettingsCard divided={false}>
                  <SettingsToggle
                    label="Use proxy server"
                    description="Applies immediately after saving. Leave HTTPS proxy blank to reuse the HTTP proxy."
                    checked={proxyForm.enabled}
                    onCheckedChange={(enabled) => updateProxyField('enabled', enabled)}
                  />
                  <div className="h-px bg-border/50 mx-4" />
                  <SettingsCardContent className="space-y-4">
                    <SettingsInput
                      label="HTTP Proxy"
                      description="Used for HTTP requests. Example: http://127.0.0.1:7890"
                      value={proxyForm.httpProxy}
                      onChange={(value) => updateProxyField('httpProxy', value)}
                      placeholder="http://127.0.0.1:7890"
                      type="url"
                      disabled={isSavingProxy}
                    />
                    <SettingsInput
                      label="HTTPS Proxy"
                      description="Optional override for HTTPS requests. Defaults to the HTTP proxy when empty."
                      value={proxyForm.httpsProxy}
                      onChange={(value) => updateProxyField('httpsProxy', value)}
                      placeholder="http://127.0.0.1:7890"
                      type="url"
                      disabled={isSavingProxy}
                    />
                    <SettingsInput
                      label="Bypass Rules"
                      description="Comma-separated hosts to bypass the proxy, for example localhost,127.0.0.1,.internal.example.com"
                      value={proxyForm.noProxy}
                      onChange={(value) => updateProxyField('noProxy', value)}
                      placeholder="localhost,127.0.0.1,.internal.example.com"
                      disabled={isSavingProxy}
                    />
                  </SettingsCardContent>
                  <SettingsCardFooter className="justify-between">
                    <div className="text-sm text-muted-foreground">
                      {proxyError ? (
                        <span className="text-destructive">{proxyError}</span>
                      ) : (
                        'Saved settings apply to both app requests and embedded browser sessions.'
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleResetProxy}
                        disabled={!proxyIsDirty || isSavingProxy}
                      >
                        Reset
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleSaveProxy}
                        disabled={!proxyIsDirty || isSavingProxy}
                      >
                        {isSavingProxy ? 'Saving...' : 'Save Proxy'}
                      </Button>
                    </div>
                  </SettingsCardFooter>
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
