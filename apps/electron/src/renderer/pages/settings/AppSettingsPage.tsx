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
import { Spinner } from '@g4os/ui'
import type { DetailsPageMeta } from '@/lib/navigation-registry'

import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsToggle,
  SettingsMenuSelectRow,
} from '@/components/settings'
import { useUpdateChecker } from '@/hooks/useUpdateChecker'
import { useLocale } from '@/context/LocaleContext'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'app',
}

// ============================================
// Main Component
// ============================================

export default function AppSettingsPage() {
  const { t, locale, setLocale } = useLocale()

  // Notifications state
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)

  // Power state
  const [keepAwakeEnabled, setKeepAwakeEnabled] = useState(false)

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
      const [notificationsOn, keepAwakeOn] = await Promise.all([
        window.electronAPI.getNotificationsEnabled(),
        window.electronAPI.getKeepAwakeWhileRunning(),
      ])
      setNotificationsEnabled(notificationsOn)
      setKeepAwakeEnabled(keepAwakeOn)
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

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title={t('settings.app.title')} actions={<HeaderMenu route={routes.view.settings('app')} helpFeature="app-settings" />} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto">
            <div className="space-y-8">
              {/* Notifications */}
              <SettingsSection title={t('settings.app.section.notifications')}>
                <SettingsCard>
                  <SettingsToggle
                    label={t('settings.app.notifications.desktop.label')}
                    description={t('settings.app.notifications.desktop.description')}
                    checked={notificationsEnabled}
                    onCheckedChange={handleNotificationsEnabledChange}
                  />
                </SettingsCard>
              </SettingsSection>

              {/* Power */}
              <SettingsSection title={t('settings.app.section.power')}>
                <SettingsCard>
                  <SettingsToggle
                    label={t('settings.app.power.keepAwake.label')}
                    description={t('settings.app.power.keepAwake.description')}
                    checked={keepAwakeEnabled}
                    onCheckedChange={handleKeepAwakeEnabledChange}
                  />
                </SettingsCard>
              </SettingsSection>

              {/* Language */}
              <SettingsSection title={t('settings.app.section.language')}>
                <SettingsCard>
                  <SettingsMenuSelectRow
                    label={t('settings.app.language.label')}
                    description={t('settings.app.language.description')}
                    value={locale}
                    onValueChange={(value) => setLocale(value as 'pt-BR' | 'en-US')}
                    options={[
                      { value: 'pt-BR', label: t('settings.app.language.option.ptBR') },
                      { value: 'en-US', label: t('settings.app.language.option.enUS') },
                    ]}
                  />
                </SettingsCard>
              </SettingsSection>

              {/* About */}
              <SettingsSection title={t('settings.app.section.about')}>
                <SettingsCard>
                  <SettingsRow label={t('settings.app.about.version')}>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">
                        {updateChecker.updateInfo?.currentVersion ?? t('settings.app.about.loading')}
                      </span>
                      {updateChecker.updateAvailable && updateChecker.updateInfo?.latestVersion && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={updateChecker.installUpdate}
                        >
                          {t('settings.app.about.updateToVersion', { version: updateChecker.updateInfo.latestVersion })}
                        </Button>
                      )}
                    </div>
                  </SettingsRow>
                  <SettingsRow label={t('settings.app.about.checkUpdates')}>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCheckForUpdates}
                      disabled={isCheckingForUpdates}
                    >
                      {isCheckingForUpdates ? (
                        <>
                          <Spinner className="mr-1.5" />
                          {t('settings.app.about.checking')}
                        </>
                      ) : (
                        t('settings.app.about.checkNow')
                      )}
                    </Button>
                  </SettingsRow>
                  {updateChecker.isReadyToInstall && (
                    <SettingsRow label={t('settings.app.about.installUpdate')}>
                      <Button
                        size="sm"
                        onClick={updateChecker.installUpdate}
                      >
                        {t('settings.app.about.restartToUpdate')}
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
