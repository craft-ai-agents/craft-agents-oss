/**
 * AppSettingsPage
 *
 * Global app-level settings that apply across all workspaces.
 *
 * Settings:
 * - Appearance (Theme, Font)
 * - Notifications
 * - API Connection (opens OnboardingWizard for editing)
 */

import { useState, useEffect, useCallback } from 'react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { useTheme } from '@/context/ThemeContext'
import { routes } from '@/lib/navigate'
import { Monitor, Sun, Moon, X } from 'lucide-react'
import { Spinner, FullscreenOverlayBase } from '@craft-agent/ui'
import { useSetAtom } from 'jotai'
import { fullscreenOverlayOpenAtom } from '@/atoms/overlay'
import type { AuthType } from '../../../shared/types'
import type { DetailsPageMeta } from '@/lib/navigation-registry'

import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsToggle,
  SettingsSegmentedControl,
  SettingsMenuSelect,
} from '@/components/settings'
import { useUpdateChecker } from '@/hooks/useUpdateChecker'
import { useOnboarding } from '@/hooks/useOnboarding'
import { OnboardingWizard } from '@/components/onboarding'
import { useAppShellContext } from '@/context/AppShellContext'
import type { PresetTheme } from '@config/theme'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'app',
}

// ============================================
// Main Component
// ============================================

export default function AppSettingsPage() {
  const { mode, setMode, colorTheme, setColorTheme, font, setFont } = useTheme()
  const { refreshCustomModel } = useAppShellContext()

  // Preset themes state
  const [presetThemes, setPresetThemes] = useState<PresetTheme[]>([])

  // API Connection state (read-only display — editing is done via OnboardingWizard overlay)
  const [authType, setAuthType] = useState<AuthType>('api_key')
  const [hasCredential, setHasCredential] = useState(false)
  const [showApiSetup, setShowApiSetup] = useState(false)
  const setFullscreenOverlayOpen = useSetAtom(fullscreenOverlayOpenAtom)

  // Notifications state
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)

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

  // Load current API connection info and notifications on mount
  const loadConnectionInfo = useCallback(async () => {
    if (!window.electronAPI) return
    try {
      const [billing, notificationsOn] = await Promise.all([
        window.electronAPI.getApiSetup(),
        window.electronAPI.getNotificationsEnabled(),
      ])
      setAuthType(billing.authType)
      setHasCredential(billing.hasCredential)
      setNotificationsEnabled(notificationsOn)
    } catch (error) {
      console.error('Failed to load settings:', error)
    }
  }, [])

  useEffect(() => {
    loadConnectionInfo()
  }, [])

  // Load preset themes when workspace changes (themes are workspace-scoped)
  // Load preset themes (app-level, no workspace dependency)
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

  // Helpers to open/close the fullscreen API setup overlay
  const openApiSetup = useCallback(() => {
    setShowApiSetup(true)
    setFullscreenOverlayOpen(true)
  }, [setFullscreenOverlayOpen])

  const closeApiSetup = useCallback(() => {
    setShowApiSetup(false)
    setFullscreenOverlayOpen(false)
  }, [setFullscreenOverlayOpen])

  // OnboardingWizard hook for editing API connection (starts at api-setup step).
  // onConfigSaved fires immediately when billing is persisted, updating the model UI instantly.
  const apiSetupOnboarding = useOnboarding({
    initialStep: 'api-setup',
    onConfigSaved: refreshCustomModel,
    onComplete: () => {
      closeApiSetup()
      loadConnectionInfo()
      apiSetupOnboarding.reset()
    },
    onDismiss: () => {
      closeApiSetup()
      apiSetupOnboarding.reset()
    },
  })

  // Called when user completes the wizard (clicks Finish on completion step)
  const handleApiSetupFinish = useCallback(() => {
    closeApiSetup()
    loadConnectionInfo()
    apiSetupOnboarding.reset()
  }, [closeApiSetup, loadConnectionInfo, apiSetupOnboarding])

  const handleNotificationsEnabledChange = useCallback(async (enabled: boolean) => {
    setNotificationsEnabled(enabled)
    await window.electronAPI.setNotificationsEnabled(enabled)
  }, [])

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title="App Settings" actions={<HeaderMenu route={routes.view.settings('app')} helpFeature="app-settings" />} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto">
          <div className="space-y-8">
            {/* Appearance */}
            <SettingsSection title="Appearance">
              <SettingsCard>
                <SettingsRow label="Mode">
                  <SettingsSegmentedControl
                    value={mode}
                    onValueChange={setMode}
                    options={[
                      { value: 'system', label: 'System', icon: <Monitor className="w-4 h-4" /> },
                      { value: 'light', label: 'Light', icon: <Sun className="w-4 h-4" /> },
                      { value: 'dark', label: 'Dark', icon: <Moon className="w-4 h-4" /> },
                    ]}
                  />
                </SettingsRow>
                <SettingsRow label="Color theme">
                  <SettingsMenuSelect
                    value={colorTheme}
                    onValueChange={setColorTheme}
                    options={[
                      { value: 'default', label: 'Default' },
                      ...presetThemes
                        .filter(t => t.id !== 'default')
                        .map(t => ({
                          value: t.id,
                          label: t.theme.name || t.id,
                        })),
                    ]}
                  />
                </SettingsRow>
                <SettingsRow label="Font">
                  <SettingsSegmentedControl
                    value={font}
                    onValueChange={setFont}
                    options={[
                      { value: 'inter', label: 'Inter' },
                      { value: 'system', label: 'System' },
                    ]}
                  />
                </SettingsRow>
              </SettingsCard>
            </SettingsSection>

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

            {/* API Connection */}
            <SettingsSection title="API Connection" description="How your AI agents connect to language models.">
              <SettingsCard>
                <SettingsRow
                  label="Connection type"
                  description={
                    authType === 'oauth_token' && hasCredential
                      ? 'Claude Pro/Max — using your Claude subscription'
                      : authType === 'api_key' && hasCredential
                        ? 'API Key — Anthropic, OpenRouter, or compatible API'
                        : 'Not configured'
                  }
                >
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={openApiSetup}
                  >
                    Edit
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
                  title="Close (Esc)"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </FullscreenOverlayBase>

            {/* About */}
            <SettingsSection title="About">
              <SettingsCard>
                <SettingsRow label="Version">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">
                      {updateChecker.updateInfo?.currentVersion ?? 'Loading...'}
                    </span>
                    {updateChecker.updateAvailable && updateChecker.updateInfo?.latestVersion && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={updateChecker.installUpdate}
                      >
                        Update to {updateChecker.updateInfo.latestVersion}
                      </Button>
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
