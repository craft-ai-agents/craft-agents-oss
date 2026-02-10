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
import { X } from 'lucide-react'
import { Spinner, FullscreenOverlayBase } from '@craft-agent/ui'
import { useTranslation } from 'react-i18next'
import { useSetAtom } from 'jotai'
import { fullscreenOverlayOpenAtom } from '@/atoms/overlay'
import type { AuthType } from '../../../shared/types'
import type { DetailsPageMeta } from '@/lib/navigation-registry'

import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsToggle,
  SettingsMenuSelectRow,
} from '@/components/settings'
import { useUpdateChecker } from '@/hooks/useUpdateChecker'
import { useOnboarding } from '@/hooks/useOnboarding'
import { OnboardingWizard } from '@/components/onboarding'
import { useAppShellContext } from '@/context/AppShellContext'
import { changeRendererLanguage } from '../../i18n'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'app',
}

export function getSettingsLabels(t: (key: string) => string) {
  return {
    pageTitle: t('settings:pageTitle'),
    notificationsTitle: t('settings:sections.notifications.title'),
    notificationsLabel: t('settings:sections.notifications.label'),
    notificationsDescription: t('settings:sections.notifications.description'),
    languageTitle: t('settings:sections.language.title'),
    languageDescription: t('settings:sections.language.description'),
    languageLabel: t('settings:sections.language.label'),
    languageOptionEnglish: t('settings:sections.language.options.english'),
    languageOptionChinese: t('settings:sections.language.options.chinese'),
    apiConnectionTitle: t('settings:sections.apiConnection.title'),
    apiConnectionDescription: t('settings:sections.apiConnection.description'),
    connectionTypeLabel: t('settings:sections.apiConnection.connectionType'),
    connectionTypeOauth: t('settings:sections.apiConnection.connectionTypeOauth'),
    connectionTypeApiKey: t('settings:sections.apiConnection.connectionTypeApiKey'),
    connectionTypeNone: t('settings:sections.apiConnection.connectionTypeNone'),
    editButton: t('settings:sections.apiConnection.editButton'),
    closeButton: t('settings:sections.apiConnection.closeButton'),
    aboutTitle: t('settings:sections.about.title'),
    versionLabel: t('settings:sections.about.versionLabel'),
    loadingVersion: t('settings:sections.about.loadingVersion'),
    checkForUpdatesLabel: t('settings:sections.about.checkForUpdatesLabel'),
    checkingLabel: t('settings:sections.about.checkingLabel'),
    checkNowLabel: t('settings:sections.about.checkNowLabel'),
    updateReadyLabel: t('settings:sections.about.updateReadyLabel'),
    restartToUpdateLabel: t('settings:sections.about.restartToUpdateLabel'),
    downloadingLabel: t('settings:sections.about.downloadingLabel'),
    downloadingProgressLabel: t('settings:sections.about.downloadingProgressLabel'),
  }
}

// ============================================
// Main Component
// ============================================

export default function AppSettingsPage() {
  const { t } = useTranslation(['settings'])
  const { refreshCustomModel } = useAppShellContext()
  const labels = getSettingsLabels(t)

  // API Connection state (read-only display — editing is done via OnboardingWizard overlay)
  const [authType, setAuthType] = useState<AuthType>('api_key')
  const [hasCredential, setHasCredential] = useState(false)
  const [showApiSetup, setShowApiSetup] = useState(false)
  const setFullscreenOverlayOpen = useSetAtom(fullscreenOverlayOpenAtom)

  // Notifications state
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)

  // Language state
  const [appLanguage, setAppLanguageState] = useState('en')

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
      const [billing, notificationsOn, storedLanguage] = await Promise.all([
        window.electronAPI.getApiSetup(),
        window.electronAPI.getNotificationsEnabled(),
        window.electronAPI.getAppLanguage(),
      ])
      setNotificationsEnabled(notificationsOn)
      setAppLanguageState(storedLanguage ?? 'en')
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

  const handleLanguageChange = useCallback(async (value: string) => {
    setAppLanguageState(value)
    await window.electronAPI.setAppLanguage(value)
    await changeRendererLanguage(value)
  }, [])

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title={labels.pageTitle} actions={<HeaderMenu route={routes.view.settings('app')} helpFeature="app-settings" />} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto">
          <div className="space-y-8">
            {/* Notifications */}
            <SettingsSection title={labels.notificationsTitle}>
              <SettingsCard>
                <SettingsToggle
                  label={labels.notificationsLabel}
                  description={labels.notificationsDescription}
                  checked={notificationsEnabled}
                  onCheckedChange={handleNotificationsEnabledChange}
                />
              </SettingsCard>
            </SettingsSection>

            <SettingsSection title={labels.languageTitle} description={labels.languageDescription}>
              <SettingsCard>
                <SettingsMenuSelectRow
                  label={labels.languageLabel}
                  value={appLanguage}
                  onValueChange={handleLanguageChange}
                  options={[
                    { value: 'en', label: labels.languageOptionEnglish },
                    { value: 'zh-CN', label: labels.languageOptionChinese },
                  ]}
                />
              </SettingsCard>
            </SettingsSection>

            {/* API Connection */}
            <SettingsSection title={labels.apiConnectionTitle} description={labels.apiConnectionDescription}>
              <SettingsCard>
                <SettingsRow
                  label={labels.connectionTypeLabel}
                  description={
                    authType === 'oauth_token' && hasCredential
                      ? labels.connectionTypeOauth
                      : authType === 'api_key' && hasCredential
                        ? labels.connectionTypeApiKey
                        : labels.connectionTypeNone
                  }
                >
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={openApiSetup}
                  >
                    {labels.editButton}
                  </Button>
                </SettingsRow>
              </SettingsCard>
            </SettingsSection>

            {/* API Setup Fullscreen Overlay — reuses the OnboardingWizard starting at the api-setup step */}
            <FullscreenOverlayBase
              isOpen={showApiSetup}
              onClose={closeApiSetup}
              className="z-splash flex flex-col bg-foreground-2"
            >
              <OnboardingWizard
                state={apiSetupOnboarding.state}
                onContinue={apiSetupOnboarding.handleContinue}
                onBack={apiSetupOnboarding.handleBack}
                onSelectApiSetupMethod={apiSetupOnboarding.handleSelectApiSetupMethod}
                onSubmitCredential={apiSetupOnboarding.handleSubmitCredential}
                onStartOAuth={apiSetupOnboarding.handleStartOAuth}
                onFinish={handleApiSetupFinish}
                isWaitingForCode={apiSetupOnboarding.isWaitingForCode}
                onSubmitAuthCode={apiSetupOnboarding.handleSubmitAuthCode}
                onCancelOAuth={apiSetupOnboarding.handleCancelOAuth}
                className="h-full"
              />
              {/* Close button — rendered AFTER the wizard so it paints above its titlebar-drag-region */}
              <div
                className="fixed top-0 right-0 h-[50px] flex items-center pr-5 [-webkit-app-region:no-drag]"
                style={{ zIndex: 'var(--z-fullscreen, 350)' }}
              >
                <button
                  onClick={closeApiSetup}
                  className="p-1.5 rounded-[6px] transition-all bg-background shadow-minimal text-muted-foreground/50 hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  title={labels.closeButton}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </FullscreenOverlayBase>

            {/* About */}
            <SettingsSection title={labels.aboutTitle}>
              <SettingsCard>
                <SettingsRow label={labels.versionLabel}>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">
                      {updateChecker.updateInfo?.currentVersion ?? labels.loadingVersion}
                    </span>
                    {/* Show downloading indicator when update is being downloaded */}
                    {updateChecker.isDownloading && updateChecker.updateInfo?.latestVersion && (
                      <div className="flex items-center gap-2 text-muted-foreground text-sm">
                        <Spinner className="w-3 h-3" />
                        {updateChecker.isIndeterminate ? (
                          <span>{labels.downloadingLabel.replace('{{version}}', updateChecker.updateInfo.latestVersion)}</span>
                        ) : (
                          <span>{labels.downloadingProgressLabel.replace('{{version}}', updateChecker.updateInfo.latestVersion).replace('{{progress}}', String(updateChecker.downloadProgress))}</span>
                        )}
                      </div>
                    )}
                  </div>
                </SettingsRow>
                <SettingsRow label={labels.checkForUpdatesLabel}>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCheckForUpdates}
                    disabled={isCheckingForUpdates}
                  >
                    {isCheckingForUpdates ? (
                      <>
                        <Spinner className="mr-1.5" />
                        {labels.checkingLabel}
                      </>
                    ) : (
                      labels.checkNowLabel
                    )}
                  </Button>
                </SettingsRow>
                {updateChecker.isReadyToInstall && updateChecker.updateInfo?.latestVersion && (
                  <SettingsRow label={labels.updateReadyLabel}>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCheckForUpdates}
                      disabled={isCheckingForUpdates}
                    >
                      {labels.restartToUpdateLabel.replace('{{version}}', updateChecker.updateInfo.latestVersion)}
                    </Button>
                  </SettingsRow>
                  {updateChecker.isReadyToInstall && (
                    <SettingsRow label="Install update">
                      <Button
                        size="sm"
                        onClick={updateChecker.installUpdate}
                      >
                        Restart to Update
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
