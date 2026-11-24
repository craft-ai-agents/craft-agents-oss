/**
 * AppSettingsPage
 *
 * Global app-level settings that apply across all workspaces.
 *
 * Settings:
 * - Notifications
 * - Network (proxy)
 * - About (version, updates)
 *
 * Note: AI settings (connections, model, thinking) have been moved to AiSettingsPage.
 * Note: Appearance settings (theme, font) have been moved to AppearanceSettingsPage.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { routes } from '@/lib/navigate'
import { Spinner } from '@craft-agent/ui'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type { NetworkProxySettings } from '../../../shared/types'

import {
  SettingsPage,
  SettingsSection,
  SettingsCard,
  SettingsCardFooter,
  SettingsRow,
  SettingsToggle,
  SettingsInput,
} from '@/components/settings'
import { useUpdateChecker } from '@/hooks/useUpdateChecker'
import { CraftySettingsSection } from './CraftySettingsSection'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'app',
}

// ============================================
// Proxy form helpers
// ============================================

interface ProxyFormState {
  enabled: boolean
  httpProxy: string
  httpsProxy: string
  noProxy: string
}

const EMPTY_PROXY_FORM: ProxyFormState = {
  enabled: false,
  httpProxy: '',
  httpsProxy: '',
  noProxy: '',
}

function toProxyFormState(settings?: NetworkProxySettings): ProxyFormState {
  if (!settings) return EMPTY_PROXY_FORM
  return {
    enabled: settings.enabled,
    httpProxy: settings.httpProxy ?? '',
    httpsProxy: settings.httpsProxy ?? '',
    noProxy: settings.noProxy ?? '',
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

function validateProxyUrl(url: string): string | undefined {
  if (!url.trim()) return undefined
  try {
    const parsed = new URL(url.trim())
    if (!['http:', 'https:', 'socks4:', 'socks5:'].includes(parsed.protocol)) {
      return 'proxyErrorProtocol'
    }
    return undefined
  } catch {
    return 'proxyErrorFormat'
  }
}

// ============================================
// Main Component
// ============================================

export default function AppSettingsPage() {
  const { t } = useTranslation()

  // Notifications state
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)

  // Power state
  const [keepAwakeEnabled, setKeepAwakeEnabled] = useState(false)

  // Tools state
  const [browserToolEnabled, setBrowserToolEnabled] = useState(true)

  // Proxy state
  const [proxyForm, setProxyForm] = useState<ProxyFormState>(EMPTY_PROXY_FORM)
  const [savedProxyForm, setSavedProxyForm] = useState<ProxyFormState>(EMPTY_PROXY_FORM)
  const [proxyError, setProxyError] = useState<string | undefined>()
  const [isSavingProxy, setIsSavingProxy] = useState(false)

  // Auto-update state (Check Now / Update Ready only shown in Electron, not WebUI)
  const isElectron = window.electronAPI.getRuntimeEnvironment() === 'electron'
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
      const [notificationsOn, keepAwakeOn, browserToolOn, proxySettings] = await Promise.all([
        window.electronAPI.getNotificationsEnabled(),
        window.electronAPI.getKeepAwakeWhileRunning(),
        window.electronAPI.getBrowserToolEnabled(),
        window.electronAPI.getNetworkProxySettings(),
      ])
      setNotificationsEnabled(notificationsOn)
      setKeepAwakeEnabled(keepAwakeOn)
      setBrowserToolEnabled(browserToolOn)
      const form = toProxyFormState(proxySettings)
      setProxyForm(form)
      setSavedProxyForm(form)
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

  const handleBrowserToolEnabledChange = useCallback(async (enabled: boolean) => {
    setBrowserToolEnabled(enabled)
    await window.electronAPI.setBrowserToolEnabled(enabled)
  }, [])

  // Proxy handlers
  const isProxyDirty = useMemo(() => {
    return JSON.stringify(proxyForm) !== JSON.stringify(savedProxyForm)
  }, [proxyForm, savedProxyForm])

  const handleSaveProxy = useCallback(async () => {
    // Validate URLs
    const httpErr = validateProxyUrl(proxyForm.httpProxy)
    const httpsErr = validateProxyUrl(proxyForm.httpsProxy)
    if (httpErr || httpsErr) {
      setProxyError(httpErr || httpsErr)
      return
    }
    setProxyError(undefined)
    setIsSavingProxy(true)
    try {
      const settings = toNetworkProxySettings(proxyForm)
      await window.electronAPI.setNetworkProxySettings(settings)
      // Re-read persisted state to confirm
      const persisted = await window.electronAPI.getNetworkProxySettings()
      const form = toProxyFormState(persisted)
      setProxyForm(form)
      setSavedProxyForm(form)
    } catch (error) {
      setProxyError(error instanceof Error ? error.message : 'Failed to save')
    } finally {
      setIsSavingProxy(false)
    }
  }, [proxyForm])

  const handleResetProxy = useCallback(() => {
    setProxyForm(savedProxyForm)
    setProxyError(undefined)
  }, [savedProxyForm])

  return (
    <SettingsPage
      title={t("settings.app.title")}
      description={t("settings.app.description")}
      actions={<HeaderMenu route={routes.view.settings('app')} helpFeature="app-settings" />}
    >
      {/* Notifications · Power · Tools: one card. Each toggle names itself, so three one-row cards
          under three headings only added boxes (HIG Simplicity: group by layout, not containers). */}
      <SettingsCard>
        <SettingsToggle
          label={t("settings.notifications.desktopNotifications")}
          description={t("settings.notifications.desktopNotificationsDesc")}
          checked={notificationsEnabled}
          onCheckedChange={handleNotificationsEnabledChange}
        />
        <SettingsToggle
          label={t("settings.power.keepScreenAwake")}
          description={t("settings.power.keepScreenAwakeDesc")}
          checked={keepAwakeEnabled}
          onCheckedChange={handleKeepAwakeEnabledChange}
        />
        <SettingsToggle
          label={t("settings.tools.builtInBrowser")}
          description={t("settings.tools.builtInBrowserDesc")}
          checked={browserToolEnabled}
          onCheckedChange={handleBrowserToolEnabledChange}
        />
      </SettingsCard>

      {/* Crafty (spike): macOS desktop only, renders nothing elsewhere */}
      <CraftySettingsSection />

      {/* Network */}
      <SettingsSection title={t("settings.network.title")}>
        <SettingsCard>
          <SettingsToggle
            label={t("settings.network.httpProxy")}
            description={t("settings.network.httpProxyDesc")}
            checked={proxyForm.enabled}
            onCheckedChange={(enabled) => setProxyForm(prev => ({ ...prev, enabled }))}
          />
          {proxyForm.enabled && (
            <>
              <SettingsInput
                label={t("settings.network.httpProxyLabel")}
                value={proxyForm.httpProxy}
                onChange={(value) => setProxyForm(prev => ({ ...prev, httpProxy: value }))}
                placeholder={t("settings.network.proxyPlaceholder")}
                inCard
              />
              <SettingsInput
                label={t("settings.network.httpsProxyLabel")}
                value={proxyForm.httpsProxy}
                onChange={(value) => setProxyForm(prev => ({ ...prev, httpsProxy: value }))}
                placeholder={t("settings.network.proxyPlaceholder")}
                inCard
              />
              <SettingsInput
                label={t("settings.network.bypassRules")}
                value={proxyForm.noProxy}
                onChange={(value) => setProxyForm(prev => ({ ...prev, noProxy: value }))}
                placeholder={t("settings.network.bypassPlaceholder")}
                inCard
              />
            </>
          )}
          {(isProxyDirty || proxyError) && (
            <SettingsCardFooter>
              {proxyError && (
                <span className="mr-auto text-label-sm text-destructive">{proxyError === 'proxyErrorProtocol' ? t("settings.network.proxyErrorProtocol") : proxyError === 'proxyErrorFormat' ? t("settings.network.proxyErrorFormat") : proxyError}</span>
              )}
              <Button
                variant="ghost"
                size="md"
                onClick={handleResetProxy}
                disabled={!isProxyDirty || isSavingProxy}
              >
                {t("common.reset")}
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={handleSaveProxy}
                disabled={!isProxyDirty || isSavingProxy}
              >
                {isSavingProxy ? (
                  <>
                    <Spinner />
                    {t("common.saving")}
                  </>
                ) : (
                  t("common.save")
                )}
              </Button>
            </SettingsCardFooter>
          )}
        </SettingsCard>
      </SettingsSection>

      {/* About */}
      <SettingsSection title={t("settings.about.title")}>
        <SettingsCard>
          <SettingsRow label={t("settings.about.version")}>
            <div className="flex items-center gap-2">
              <span className="text-label text-secondary tabular-nums">
                {updateChecker.updateInfo?.currentVersion ?? t("common.loading")}
              </span>
              {isElectron && updateChecker.isDownloading && updateChecker.updateInfo?.latestVersion && (
                <div className="flex items-center gap-2 text-label-sm text-tertiary">
                  <Spinner />
                  <span>{t("settings.about.downloading", { version: updateChecker.updateInfo.latestVersion, percent: updateChecker.downloadProgress })}</span>
                </div>
              )}
            </div>
          </SettingsRow>
          {isElectron && (
            <SettingsRow label={t("settings.about.checkForUpdates")}>
              <Button
                variant="secondary"
                size="md"
                onClick={handleCheckForUpdates}
                disabled={isCheckingForUpdates}
              >
                {isCheckingForUpdates ? (
                  <>
                    <Spinner />
                    {t("common.checking")}
                  </>
                ) : (
                  t("settings.about.checkNow")
                )}
              </Button>
            </SettingsRow>
          )}
          {isElectron && updateChecker.isReadyToInstall && updateChecker.updateInfo?.latestVersion && (
            <SettingsRow label={t("settings.about.updateReady")}>
              <Button
                variant="primary"
                size="md"
                onClick={updateChecker.installUpdate}
              >
                {t("settings.about.restartToUpdate", { version: updateChecker.updateInfo.latestVersion })}
              </Button>
            </SettingsRow>
          )}
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  )
}
