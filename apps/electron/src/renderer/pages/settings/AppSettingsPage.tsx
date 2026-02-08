/**
 * AppSettingsPage
 *
 * Global app-level settings that apply across all workspaces.
 *
 * Settings:
 * - Notifications
 * - API Connection (opens OnboardingWizard for editing)
 * - About (version, updates)
 *
 * Note: Appearance settings (theme, font) have been moved to AppearanceSettingsPage.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { routes } from '@/lib/navigate'
import { X } from 'lucide-react'
import { Spinner, FullscreenOverlayBase } from '@craft-agent/ui'
import { useSetAtom } from 'jotai'
import { fullscreenOverlayOpenAtom } from '@/atoms/overlay'
import type { AuthType, ApiSetupInfo } from '../../../shared/types'
import type { DetailsPageMeta } from '@/lib/navigation-registry'

import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsToggle,
  SettingsSelectRow,
} from '@/components/settings'
import { useUpdateChecker } from '@/hooks/useUpdateChecker'
import { useOnboarding } from '@/hooks/useOnboarding'
import { OnboardingWizard } from '@/components/onboarding'
import { useAppShellContext } from '@/context/AppShellContext'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'app',
}

// ============================================
// Main Component
// ============================================

export default function AppSettingsPage() {
  const { refreshCustomModel } = useAppShellContext()

  // API Connection state (read-only display — editing is done via OnboardingWizard overlay)
  const [authType, setAuthType] = useState<AuthType>('api_key')
  const [hasCredential, setHasCredential] = useState(false)
  const [apiSetupInfo, setApiSetupInfo] = useState<ApiSetupInfo | null>(null)
  const [showApiSetup, setShowApiSetup] = useState(false)
  const setFullscreenOverlayOpen = useSetAtom(fullscreenOverlayOpenAtom)

  // Notifications state
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)

  // Auto new chat state
  const [autoNewChatEnabled, setAutoNewChatEnabled] = useState(false)
  const [autoNewChatTimeout, setAutoNewChatTimeout] = useState('10')

  // Global shortcut state
  const [globalShortcutEnabled, setGlobalShortcutEnabled] = useState(false)
  const [globalShortcut, setGlobalShortcut] = useState('CommandOrControl+Shift+Space')
  const [shortcutError, setShortcutError] = useState<string | null>(null)
  const [isRecordingShortcut, setIsRecordingShortcut] = useState(false)

  // Auto launch state
  const [autoLaunchEnabled, setAutoLaunchEnabled] = useState(false)

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
      const [billing, notificationsOn, prefsResult, shortcutSettings, autoLaunch] = await Promise.all([
        window.electronAPI.getApiSetup(),
        window.electronAPI.getNotificationsEnabled(),
        window.electronAPI.readPreferences(),
        window.electronAPI.getGlobalShortcut(),
        window.electronAPI.getAutoLaunch(),
      ])
      setApiSetupInfo(billing)
      setAuthType(billing.authType)
      setHasCredential(billing.hasCredential)
      setNotificationsEnabled(notificationsOn)
      setAutoLaunchEnabled(autoLaunch)

      // Load global shortcut settings
      setGlobalShortcutEnabled(shortcutSettings.enabled)
      setGlobalShortcut(shortcutSettings.shortcut)

      // Load auto new chat settings
      if (prefsResult.exists && prefsResult.content) {
        try {
          const prefs = JSON.parse(prefsResult.content)
          if (prefs.autoNewChat) {
            setAutoNewChatEnabled(prefs.autoNewChat.enabled ?? false)
            setAutoNewChatTimeout(String(prefs.autoNewChat.idleTimeoutMinutes ?? 10))
          }
        } catch {
          // Ignore parse errors
        }
      }
    } catch (error) {
      console.error('Failed to load settings:', error)
    }
  }, [])

  useEffect(() => {
    loadConnectionInfo()
  }, [loadConnectionInfo])

  // Helpers to open/close the fullscreen API setup overlay
  const openApiSetup = useCallback(async () => {
    await loadConnectionInfo()
    setShowApiSetup(true)
    setFullscreenOverlayOpen(true)
  }, [loadConnectionInfo, setFullscreenOverlayOpen])

  const closeApiSetup = useCallback(() => {
    setShowApiSetup(false)
    setFullscreenOverlayOpen(false)
  }, [setFullscreenOverlayOpen])

  const apiConnectionDescription = useMemo(() => {
    if (authType === 'oauth_token' && hasCredential) {
      return 'Claude Pro/Max — using your Claude subscription'
    }

    if (authType === 'api_key' && hasCredential) {
      const baseUrl = apiSetupInfo?.anthropicBaseUrl?.trim()
      const customModel = apiSetupInfo?.customModel?.trim()

      if (baseUrl && customModel) {
        return `API Key — ${baseUrl} · ${customModel}`
      }
      if (baseUrl) {
        return `API Key — ${baseUrl}`
      }
      return 'API Key — Anthropic, OpenRouter, Ollama, or compatible API'
    }

    return 'Not configured'
  }, [authType, hasCredential, apiSetupInfo?.anthropicBaseUrl, apiSetupInfo?.customModel])

  // OnboardingWizard hook for editing API connection (starts at api-setup step).
  // onConfigSaved fires immediately when billing is persisted, updating the model UI instantly.
  const apiSetupOnboarding = useOnboarding({
    initialStep: 'api-setup',
    initialApiSetupMethod: authType === 'oauth_token' ? 'claude_oauth' : 'api_key',
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

  const handleAutoLaunchEnabledChange = useCallback(async (enabled: boolean) => {
    setAutoLaunchEnabled(enabled)
    await window.electronAPI.setAutoLaunch(enabled)
  }, [])

  // Save auto new chat settings to preferences.json
  const saveAutoNewChatSettings = useCallback(async (enabled: boolean, timeoutMinutes: number) => {
    try {
      const prefsResult = await window.electronAPI.readPreferences()
      let prefs: Record<string, unknown> = {}
      if (prefsResult.exists && prefsResult.content) {
        try {
          prefs = JSON.parse(prefsResult.content)
        } catch {
          // Start fresh if parse fails
        }
      }
      prefs.autoNewChat = {
        enabled,
        idleTimeoutMinutes: timeoutMinutes,
      }
      prefs.updatedAt = Date.now()
      await window.electronAPI.writePreferences(JSON.stringify(prefs, null, 2))
    } catch (error) {
      console.error('Failed to save auto new chat settings:', error)
    }
  }, [])

  const handleAutoNewChatEnabledChange = useCallback(async (enabled: boolean) => {
    setAutoNewChatEnabled(enabled)
    await saveAutoNewChatSettings(enabled, parseInt(autoNewChatTimeout, 10))
  }, [autoNewChatTimeout, saveAutoNewChatSettings])

  const handleAutoNewChatTimeoutChange = useCallback(async (value: string) => {
    setAutoNewChatTimeout(value)
    await saveAutoNewChatSettings(autoNewChatEnabled, parseInt(value, 10))
  }, [autoNewChatEnabled, saveAutoNewChatSettings])

  // Handle global shortcut enable/disable
  const handleGlobalShortcutEnabledChange = useCallback(async (enabled: boolean) => {
    setShortcutError(null)
    const result = await window.electronAPI.setGlobalShortcut(enabled, globalShortcut)
    if (result.success) {
      setGlobalShortcutEnabled(enabled)
    } else {
      setShortcutError(result.error || 'Failed to set shortcut')
    }
  }, [globalShortcut])

  // Format accelerator for display
  const formatShortcutDisplay = useCallback((accelerator: string): string => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
    return accelerator
      .replace(/CommandOrControl|CmdOrCtrl/gi, isMac ? '⌘' : 'Ctrl')
      .replace(/Command|Cmd/gi, '⌘')
      .replace(/Control|Ctrl/gi, isMac ? '⌃' : 'Ctrl')
      .replace(/Alt|Option/gi, isMac ? '⌥' : 'Alt')
      .replace(/Shift/gi, isMac ? '⇧' : 'Shift')
      .replace(/\+/g, ' ')
  }, [])

  // Handle shortcut recording
  const handleRecordShortcut = useCallback(() => {
    setIsRecordingShortcut(true)
    setShortcutError(null)
  }, [])

  // Handle keydown during recording
  const handleKeyDown = useCallback(async (e: React.KeyboardEvent) => {
    if (!isRecordingShortcut) return

    e.preventDefault()
    e.stopPropagation()

    // Build accelerator from pressed keys
    const parts: string[] = []
    if (e.metaKey || e.ctrlKey) parts.push('CommandOrControl')
    if (e.altKey) parts.push('Alt')
    if (e.shiftKey) parts.push('Shift')

    // Get the main key (ignore modifier keys alone)
    const key = e.key
    if (!['Control', 'Alt', 'Shift', 'Meta', 'Command'].includes(key)) {
      // Map common keys to Electron accelerator format
      let mappedKey = key.length === 1 ? key.toUpperCase() : key
      if (key === ' ') mappedKey = 'Space'
      if (key === 'Escape') mappedKey = 'Escape'
      if (key === 'Enter') mappedKey = 'Enter'
      if (key === 'Backspace') mappedKey = 'Backspace'
      if (key === 'Tab') mappedKey = 'Tab'
      if (key === 'ArrowUp') mappedKey = 'Up'
      if (key === 'ArrowDown') mappedKey = 'Down'
      if (key === 'ArrowLeft') mappedKey = 'Left'
      if (key === 'ArrowRight') mappedKey = 'Right'

      parts.push(mappedKey)

      const newShortcut = parts.join('+')

      // Must have at least one modifier
      if (parts.length < 2) {
        setShortcutError('Shortcut must include a modifier key (Cmd/Ctrl, Alt, or Shift)')
        setIsRecordingShortcut(false)
        return
      }

      // Try to register the new shortcut
      const result = await window.electronAPI.setGlobalShortcut(globalShortcutEnabled, newShortcut)
      if (result.success) {
        setGlobalShortcut(newShortcut)
        setShortcutError(null)
      } else {
        setShortcutError(result.error || 'Failed to set shortcut')
      }
      setIsRecordingShortcut(false)
    }
  }, [isRecordingShortcut, globalShortcutEnabled])

  // Cancel recording on blur
  const handleBlur = useCallback(() => {
    setIsRecordingShortcut(false)
  }, [])

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title="App Settings" actions={<HeaderMenu route={routes.view.settings('app')} helpFeature="app-settings" />} />
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

            {/* Launch at Startup */}
            <SettingsSection title="Startup">
              <SettingsCard>
                <SettingsToggle
                  label="Launch at startup"
                  description="Automatically start the app when you log in to your computer."
                  checked={autoLaunchEnabled}
                  onCheckedChange={handleAutoLaunchEnabledChange}
                />
              </SettingsCard>
            </SettingsSection>

            {/* Global Shortcut */}
            <SettingsSection title="Global Shortcut" description="Toggle the app visibility from anywhere using a keyboard shortcut.">
              <SettingsCard>
                <SettingsToggle
                  label="Enable global shortcut"
                  description="Press the shortcut to show the app, or hide it if already in foreground."
                  checked={globalShortcutEnabled}
                  onCheckedChange={handleGlobalShortcutEnabledChange}
                />
                {globalShortcutEnabled && (
                  <SettingsRow
                    label="Shortcut"
                    description={shortcutError || "Click to record a new shortcut."}
                  >
                    <button
                      className={`px-3 py-1.5 text-sm font-medium rounded-md border transition-colors ${
                        isRecordingShortcut
                          ? 'border-accent bg-accent/10 text-accent animate-pulse'
                          : shortcutError
                            ? 'border-destructive text-destructive'
                            : 'border-border bg-muted hover:bg-muted/80'
                      }`}
                      onClick={handleRecordShortcut}
                      onKeyDown={handleKeyDown}
                      onBlur={handleBlur}
                    >
                      {isRecordingShortcut ? 'Press shortcut...' : formatShortcutDisplay(globalShortcut)}
                    </button>
                  </SettingsRow>
                )}
              </SettingsCard>
            </SettingsSection>

            {/* Auto New Chat */}
            <SettingsSection title="Auto New Chat" description="Start a fresh conversation when returning after being away.">
              <SettingsCard>
                <SettingsToggle
                  label="Auto new chat on focus"
                  description="Automatically start a new chat when the app regains focus after being idle."
                  checked={autoNewChatEnabled}
                  onCheckedChange={handleAutoNewChatEnabledChange}
                />
                {autoNewChatEnabled && (
                  <SettingsSelectRow
                    label="Idle timeout"
                    description="How long to wait before starting a new chat."
                    value={autoNewChatTimeout}
                    onValueChange={handleAutoNewChatTimeoutChange}
                    options={[
                      { value: '5', label: '5 minutes' },
                      { value: '10', label: '10 minutes' },
                      { value: '15', label: '15 minutes' },
                      { value: '20', label: '20 minutes' },
                      { value: '30', label: '30 minutes' },
                      { value: '60', label: '1 hour' },
                    ]}
                  />
                )}
              </SettingsCard>
            </SettingsSection>

            {/* API Connection */}
            <SettingsSection title="API Connection" description="How your AI agents connect to language models.">
              <SettingsCard>
                <SettingsRow
                  label="Connection type"
                  description={apiConnectionDescription}
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
                initialApiKey={apiSetupInfo?.apiKey}
                initialBaseUrl={apiSetupInfo?.anthropicBaseUrl}
                initialCustomModel={apiSetupInfo?.customModel}
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
                    {/* Show downloading indicator when update is being downloaded */}
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
