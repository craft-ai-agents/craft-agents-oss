/**
 * AppSettingsPage
 *
 * Global app-level settings that apply across all workspaces.
 *
 * Settings:
 * - Appearance (Theme, Font)
 * - Notifications
 * - Billing (Craft Credits, API Key, Claude Max)
 */

import * as React from 'react'
import { useState, useEffect, useCallback } from 'react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { useTheme } from '@/context/ThemeContext'
import { cn } from '@/lib/utils'
import { routes } from '@/lib/navigate'
import {
  Monitor,
  Sun,
  Moon,
  Eye,
  EyeOff,
  Check,
  ExternalLink,
  CheckCircle2,
} from 'lucide-react'
import { Spinner } from '@craft-agent/ui'
import type { AuthType } from '../../../shared/types'
import type { DetailsPageMeta } from '@/lib/navigation-registry'

import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsToggle,
  SettingsSegmentedControl,
  SettingsMenuSelectRow,
  SettingsMenuSelect,
} from '@/components/settings'
import type { PresetTheme } from '@config/theme'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'app',
}

// ============================================
// API Key Dialog Content
// ============================================

interface ApiKeyDialogProps {
  value: string
  onChange: (value: string) => void
  onSave: () => void
  onCancel: () => void
  isSaving: boolean
  hasExistingKey: boolean
  error?: string
}

function ApiKeyDialogContent({ value, onChange, onSave, onCancel, isSaving, hasExistingKey, error }: ApiKeyDialogProps) {
  const [showValue, setShowValue] = useState(false)

  return (
    <div className="space-y-4">
      {/* Description */}
      <p className="text-sm text-muted-foreground">
        Pay-as-you-go with your own API key.{' '}
        <a
          href="https://console.anthropic.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground hover:underline inline-flex items-center gap-0.5"
          onClick={(e) => {
            e.preventDefault()
            window.electronAPI?.openUrl('https://console.anthropic.com')
          }}
        >
          Get one from Anthropic
          <ExternalLink className="size-3" />
        </a>
      </p>

      {/* Input */}
      <div className="relative">
        <Input
          type={showValue ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={hasExistingKey ? '••••••••••••••••' : 'sk-ant-...'}
          className={cn("pr-10", error && "border-destructive")}
          disabled={isSaving}
        />
        <button
          type="button"
          onClick={() => setShowValue(!showValue)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          tabIndex={-1}
        >
          {showValue ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>

      {/* Error message */}
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2">
        <Button
          onClick={onSave}
          disabled={!value.trim() || isSaving}
        >
          {isSaving ? (
            <>
              <Spinner className="mr-1.5" />
              Validating...
            </>
          ) : (
            <>
              <Check className="size-3 mr-1.5" />
              {hasExistingKey ? 'Update Key' : 'Save'}
            </>
          )}
        </Button>
        <Button
          variant="ghost"
          onClick={onCancel}
          disabled={isSaving}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}

// ============================================
// Claude OAuth Dialog Content
// ============================================

interface ClaudeOAuthDialogProps {
  existingToken: string | null
  isCliInstalled: boolean
  isLoading: boolean
  onUseExisting: () => void
  onStartOAuth: () => void
  onCancel: () => void
  status: 'idle' | 'loading' | 'success' | 'error'
  errorMessage?: string
}

function ClaudeOAuthDialogContent({
  existingToken,
  isCliInstalled,
  isLoading,
  onUseExisting,
  onStartOAuth,
  onCancel,
  status,
  errorMessage,
}: ClaudeOAuthDialogProps) {
  if (status === 'success') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-success">
          <CheckCircle2 className="size-4" />
          Connected to Claude
        </div>
      </div>
    )
  }

  if (!isCliInstalled && !existingToken) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Use your Claude Pro or Max subscription. Requires Claude Code CLI.{' '}
          <a
            href="https://docs.anthropic.com/claude-code/getting-started"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground hover:underline inline-flex items-center gap-0.5"
            onClick={(e) => {
              e.preventDefault()
              window.electronAPI?.openUrl('https://docs.anthropic.com/claude-code/getting-started')
            }}
          >
            Install Claude Code
            <ExternalLink className="size-3" />
          </a>
        </p>
        <div className="flex items-center gap-2 pt-2">
          <Button
            variant="ghost"
            onClick={onCancel}
          >
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Use your Claude Pro or Max subscription for unlimited access.
      </p>
      <div className="flex items-center gap-2 pt-2">
        {existingToken ? (
          <Button
            onClick={onUseExisting}
            disabled={isLoading}
          >
            {status === 'loading' ? (
              <>
                <Spinner className="mr-1.5" />
                Connecting...
              </>
            ) : (
              <>
                <CheckCircle2 className="size-3 mr-1.5" />
                Use Existing Token
              </>
            )}
          </Button>
        ) : (
          <Button
            onClick={onStartOAuth}
            disabled={isLoading}
          >
            {status === 'loading' ? (
              <>
                <Spinner className="mr-1.5" />
                Connecting...
              </>
            ) : (
              <>
                <ExternalLink className="size-3 mr-1.5" />
                Sign in with Claude
              </>
            )}
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={onCancel}
          disabled={isLoading}
        >
          Cancel
        </Button>
      </div>
      {errorMessage && (
        <p className="text-xs text-destructive">{errorMessage}</p>
      )}
    </div>
  )
}

// ============================================
// Main Component
// ============================================

export default function AppSettingsPage() {
  const { mode, setMode, colorTheme, setColorTheme, font, setFont } = useTheme()

  // Preset themes state
  const [presetThemes, setPresetThemes] = useState<PresetTheme[]>([])

  // Billing state
  const [authType, setAuthType] = useState<AuthType>('craft_credits')
  const [expandedMethod, setExpandedMethod] = useState<AuthType | null>(null)
  const [hasCredential, setHasCredential] = useState(false)
  const [isLoadingBilling, setIsLoadingBilling] = useState(true)

  // API Key state
  const [apiKeyValue, setApiKeyValue] = useState('')
  const [isSavingApiKey, setIsSavingApiKey] = useState(false)
  const [apiKeyError, setApiKeyError] = useState<string | undefined>()

  // Claude OAuth state
  const [existingClaudeToken, setExistingClaudeToken] = useState<string | null>(null)
  const [isClaudeCliInstalled, setIsClaudeCliInstalled] = useState(false)
  const [claudeOAuthStatus, setClaudeOAuthStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [claudeOAuthError, setClaudeOAuthError] = useState<string | undefined>()

  // Notifications state
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)

  // Load current billing method, notifications setting, and preset themes on mount
  useEffect(() => {
    const loadSettings = async () => {
      if (!window.electronAPI) return
      try {
        const [billing, notificationsOn, themes] = await Promise.all([
          window.electronAPI.getBillingMethod(),
          window.electronAPI.getNotificationsEnabled(),
          window.electronAPI.loadPresetThemes?.() ?? [],
        ])
        setAuthType(billing.authType)
        setHasCredential(billing.hasCredential)
        setNotificationsEnabled(notificationsOn)
        setPresetThemes(themes)
      } catch (error) {
        console.error('Failed to load settings:', error)
      } finally {
        setIsLoadingBilling(false)
      }
    }
    loadSettings()
  }, [])

  // Check Claude OAuth availability when expanding oauth_token option
  useEffect(() => {
    if (expandedMethod !== 'oauth_token') return

    const checkClaudeAuth = async () => {
      if (!window.electronAPI) return
      try {
        const [token, cliInstalled] = await Promise.all([
          window.electronAPI.getExistingClaudeToken(),
          window.electronAPI.isClaudeCliInstalled(),
        ])
        setExistingClaudeToken(token)
        setIsClaudeCliInstalled(cliInstalled)
      } catch (error) {
        console.error('Failed to check Claude auth:', error)
      }
    }
    checkClaudeAuth()
  }, [expandedMethod])

  // Handle clicking on a billing method option
  const handleMethodClick = useCallback(async (method: AuthType) => {
    if (method === authType && hasCredential) {
      setExpandedMethod(null)
      return
    }

    if (method === 'craft_credits' && window.electronAPI) {
      try {
        await window.electronAPI.updateBillingMethod(method)
        setAuthType(method)
        setHasCredential(true)
        setExpandedMethod(null)
      } catch (error) {
        console.error('Failed to update billing method:', error)
      }
    } else {
      setExpandedMethod(method)
      setApiKeyError(undefined)
      setClaudeOAuthStatus('idle')
      setClaudeOAuthError(undefined)
    }
  }, [authType, hasCredential])

  // Cancel billing method expansion
  const handleCancel = useCallback(() => {
    setExpandedMethod(null)
    setApiKeyValue('')
    setApiKeyError(undefined)
    setClaudeOAuthStatus('idle')
    setClaudeOAuthError(undefined)
  }, [])

  // Save API key
  const handleSaveApiKey = useCallback(async () => {
    if (!window.electronAPI || !apiKeyValue.trim()) return

    setIsSavingApiKey(true)
    setApiKeyError(undefined)
    try {
      await window.electronAPI.updateBillingMethod('api_key', apiKeyValue.trim())
      setAuthType('api_key')
      setHasCredential(true)
      setApiKeyValue('')
      setExpandedMethod(null)
    } catch (error) {
      console.error('Failed to save API key:', error)
      setApiKeyError(error instanceof Error ? error.message : 'Invalid API key. Please check and try again.')
    } finally {
      setIsSavingApiKey(false)
    }
  }, [apiKeyValue])

  // Use existing Claude token
  const handleUseExistingClaudeToken = useCallback(async () => {
    if (!window.electronAPI || !existingClaudeToken) return

    setClaudeOAuthStatus('loading')
    setClaudeOAuthError(undefined)
    try {
      await window.electronAPI.updateBillingMethod('oauth_token', existingClaudeToken)
      setAuthType('oauth_token')
      setHasCredential(true)
      setClaudeOAuthStatus('success')
      setExpandedMethod(null)
    } catch (error) {
      setClaudeOAuthStatus('error')
      setClaudeOAuthError(error instanceof Error ? error.message : 'Failed to save token')
    }
  }, [existingClaudeToken])

  // Start Claude OAuth flow
  const handleStartClaudeOAuth = useCallback(async () => {
    if (!window.electronAPI) return

    setClaudeOAuthStatus('loading')
    setClaudeOAuthError(undefined)
    try {
      const result = await window.electronAPI.runClaudeSetupToken()
      if (result.success && result.token) {
        await window.electronAPI.updateBillingMethod('oauth_token', result.token)
        setAuthType('oauth_token')
        setHasCredential(true)
        setClaudeOAuthStatus('success')
        setExpandedMethod(null)
      } else {
        setClaudeOAuthStatus('error')
        setClaudeOAuthError(result.error || 'OAuth failed')
      }
    } catch (error) {
      setClaudeOAuthStatus('error')
      setClaudeOAuthError(error instanceof Error ? error.message : 'OAuth failed')
    }
  }, [])

  const handleNotificationsEnabledChange = useCallback(async (enabled: boolean) => {
    setNotificationsEnabled(enabled)
    await window.electronAPI.setNotificationsEnabled(enabled)
  }, [])

  return (
    <div className="h-full flex flex-col bg-surface-below">
      <PanelHeader title="App Settings" actions={<HeaderMenu route={routes.view.settings('app')} />} className="bg-surface-below" />
      <div className="relative flex-1 min-h-0">
        {/* Top fade gradient */}
        <div className="absolute top-0 left-0 right-2 h-8 z-10 bg-gradient-to-b from-surface-below to-transparent pointer-events-none" />
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto">
          <div className="space-y-6">
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
                      ...presetThemes.map(t => ({
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

            {/* Billing */}
            <SettingsSection title="Billing" description="Choose how you pay for AI usage">
              <SettingsCard>
                <SettingsMenuSelectRow
                  label="Payment method"
                  description={
                    authType === 'craft_credits'
                      ? 'Included with Craft'
                      : authType === 'api_key' && hasCredential
                        ? 'API key configured'
                        : authType === 'oauth_token' && hasCredential
                          ? 'Claude connected'
                          : 'Select a method'
                  }
                  value={authType}
                  onValueChange={(v) => handleMethodClick(v as AuthType)}
                  options={[
                    { value: 'craft_credits', label: 'Craft Credits', description: 'Included with Craft' },
                    { value: 'api_key', label: 'API Key', description: 'Pay-as-you-go with your Anthropic key' },
                    { value: 'oauth_token', label: 'Claude Max', description: 'Use your Pro or Max subscription' },
                  ]}
                />
              </SettingsCard>

              {/* API Key Dialog */}
              <Dialog open={expandedMethod === 'api_key'} onOpenChange={(open) => !open && handleCancel()}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>API Key</DialogTitle>
                    <DialogDescription>
                      Configure your Anthropic API key
                    </DialogDescription>
                  </DialogHeader>
                  <ApiKeyDialogContent
                    value={apiKeyValue}
                    onChange={setApiKeyValue}
                    onSave={handleSaveApiKey}
                    onCancel={handleCancel}
                    isSaving={isSavingApiKey}
                    hasExistingKey={authType === 'api_key' && hasCredential}
                    error={apiKeyError}
                  />
                </DialogContent>
              </Dialog>

              {/* Claude OAuth Dialog */}
              <Dialog open={expandedMethod === 'oauth_token'} onOpenChange={(open) => !open && handleCancel()}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Claude Max</DialogTitle>
                    <DialogDescription>
                      Connect your Claude subscription
                    </DialogDescription>
                  </DialogHeader>
                  <ClaudeOAuthDialogContent
                    existingToken={existingClaudeToken}
                    isCliInstalled={isClaudeCliInstalled}
                    isLoading={claudeOAuthStatus === 'loading'}
                    onUseExisting={handleUseExistingClaudeToken}
                    onStartOAuth={handleStartClaudeOAuth}
                    onCancel={handleCancel}
                    status={claudeOAuthStatus}
                    errorMessage={claudeOAuthError}
                  />
                </DialogContent>
              </Dialog>
            </SettingsSection>
          </div>
        </div>
        </ScrollArea>
        {/* Bottom fade gradient */}
        <div className="absolute bottom-0 left-0 right-2 h-8 z-10 bg-gradient-to-t from-surface-below to-transparent pointer-events-none" />
      </div>
    </div>
  )
}
