/**
 * AppSettingsPage
 *
 * Global app-level settings that apply across all workspaces.
 *
 * Settings:
 * - Appearance (Theme, Font)
 * - Notifications
 * - Billing (API Key, Claude Max)
 */

import * as React from 'react'
import { useState, useEffect, useCallback } from 'react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { useTheme } from '@/context/ThemeContext'
import { routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'
import {
  Monitor,
  Sun,
  Moon,
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
import { useUpdateChecker } from '@/hooks/useUpdateChecker'
import type { PresetTheme } from '@config/theme'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { SettingsSecretInput, SettingsInput } from '@/components/settings'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'app',
}

// ============================================
// Claude OAuth Dialog Content
// ============================================

interface ClaudeOAuthDialogBaseProps {
  existingToken: string | null
  isLoading: boolean
  onUseExisting: () => void
  onStartOAuth: () => void
  onCancel: () => void
  status: 'idle' | 'loading' | 'success' | 'error'
  errorMessage?: string
}

type ClaudeOAuthDialogProps = ClaudeOAuthDialogBaseProps & (
  | { isWaitingForCode: false }
  | { isWaitingForCode: true; authCode: string; onAuthCodeChange: (code: string) => void; onSubmitAuthCode: (code: string) => void }
)

function ClaudeOAuthDialogContent(props: ClaudeOAuthDialogProps) {
  const { existingToken, isLoading, onUseExisting, onStartOAuth, onCancel, status, errorMessage } = props

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

  // Waiting for authorization code entry
  if (props.isWaitingForCode) {
    const { authCode, onAuthCodeChange, onSubmitAuthCode } = props
    const trimmedCode = authCode.trim()

    const handleSubmit = () => {
      if (trimmedCode) {
        onSubmitAuthCode(trimmedCode)
      }
    }

    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Copy the authorization code from your browser and paste it below.
        </p>
        <div className="space-y-2">
          <Label htmlFor="auth-code">Authorization Code</Label>
          <div className="relative rounded-md shadow-minimal transition-colors bg-foreground-2 focus-within:bg-background">
            <Input
              id="auth-code"
              type="text"
              value={authCode}
              onChange={(e) => onAuthCodeChange(e.target.value)}
              placeholder="Paste your authorization code here"
              className="border-0 bg-transparent shadow-none font-mono text-sm"
              disabled={status === 'loading'}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSubmit()
                }
              }}
            />
          </div>
          {status === 'error' && errorMessage && (
            <p className="text-sm text-destructive">{errorMessage}</p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            variant="ghost"
            onClick={onCancel}
            disabled={status === 'loading'}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!trimmedCode || status === 'loading'}
          >
            {status === 'loading' ? (
              <>
                <Spinner className="mr-1.5" />
                Connecting...
              </>
            ) : (
              'Connect'
            )}
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
      <div className="flex items-center justify-end gap-2 pt-2">
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
                Starting...
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
      {existingToken && (
        <div className="text-center">
          <Button
            variant="link"
            onClick={onStartOAuth}
            disabled={isLoading}
            className="text-muted-foreground hover:text-foreground"
          >
            Or sign in with a different account
          </Button>
        </div>
      )}
      {errorMessage && (
        <p className="text-xs text-destructive">{errorMessage}</p>
      )}
    </div>
  )
}

// ============================================
// API Key Auto-Save Hook
// ============================================

const MIN_SAVE_DISPLAY_MS = 1500
const DEBOUNCE_MS = 500

function useApiKeyAutoSave({
  apiKey,
  baseUrl,
  customModelNames,
  authType,
  hasCredential,
  onSaveStart,
  onSaveSuccess,
  onSaveError,
}: {
  apiKey: string
  baseUrl: string
  customModelNames: { opus: string; sonnet: string; haiku: string }
  authType: AuthType
  hasCredential: boolean
  onSaveStart?: () => void
  onSaveSuccess?: () => void
  onSaveError?: (error: string) => void
}) {
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedRef = React.useRef<string | null>(null)
  const isInitialLoadRef = React.useRef(true)
  const saveStartTimeRef = React.useRef<number>(0)

  const serializeConfig = React.useCallback(() => {
    return JSON.stringify({ apiKey, baseUrl, customModelNames })
  }, [apiKey, baseUrl, customModelNames])

  const doSave = React.useCallback(async () => {
    if (authType !== 'api_key') return

    const currentConfig = serializeConfig()
    if (currentConfig === lastSavedRef.current) return

    const trimmedKey = apiKey.trim()

    saveStartTimeRef.current = Date.now()
    onSaveStart?.()
    try {
      const modelNames = (customModelNames.opus || customModelNames.sonnet || customModelNames.haiku)
        ? {
            opus: customModelNames.opus.trim() || undefined,
            sonnet: customModelNames.sonnet.trim() || undefined,
            haiku: customModelNames.haiku.trim() || undefined,
          }
        : null

      await window.electronAPI.updateBillingMethod(
        'api_key',
        trimmedKey,  // Pass empty string to clear credential
        baseUrl.trim() || null,
        modelNames
      )
      lastSavedRef.current = currentConfig

      // Ensure saving indicator shows for at least MIN_SAVE_DISPLAY_MS
      const elapsed = Date.now() - saveStartTimeRef.current
      const remaining = MIN_SAVE_DISPLAY_MS - elapsed
      if (remaining > 0) {
        setTimeout(() => onSaveSuccess?.(), remaining)
      } else {
        onSaveSuccess?.()
      }
    } catch (error) {
      const elapsed = Date.now() - saveStartTimeRef.current
      const remaining = MIN_SAVE_DISPLAY_MS - elapsed
      const errorMsg = error instanceof Error ? error.message : 'Failed to save'
      if (remaining > 0) {
        setTimeout(() => onSaveError?.(errorMsg), remaining)
      } else {
        onSaveError?.(errorMsg)
      }
    }
  }, [authType, apiKey, baseUrl, customModelNames, serializeConfig, onSaveStart, onSaveSuccess, onSaveError])

  const handleBlur = React.useCallback(() => {
    if (isInitialLoadRef.current) return
    doSave()
  }, [doSave])

  // Debounce auto-save on input change
  React.useEffect(() => {
    if (authType !== 'api_key') return
    if (isInitialLoadRef.current) return

    // Clear previous debounce timer
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    // Schedule save after debounce delay
    debounceRef.current = setTimeout(() => {
      doSave()
    }, DEBOUNCE_MS)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [authType, apiKey, baseUrl, customModelNames, doSave])

  // Initialize lastSavedRef when API key is first loaded from backend
  // This effect waits for hasCredential to be set (indicating data is loaded)
  // before setting the initial saved state and enabling auto-save
  React.useEffect(() => {
    if (authType === 'api_key' && isInitialLoadRef.current) {
      // Initialize after a short delay to ensure backend data has loaded
      // hasCredential indicates whether backend has a stored credential
      lastSavedRef.current = serializeConfig()
      setTimeout(() => {
        isInitialLoadRef.current = false
      }, 100)
    }
  }, [authType, hasCredential, serializeConfig])

  return { handleBlur }
}

// ============================================
// Main Component
// ============================================

export default function AppSettingsPage() {
  const { mode, setMode, colorTheme, setColorTheme, font, setFont } = useTheme()

  // Preset themes state
  const [presetThemes, setPresetThemes] = useState<PresetTheme[]>([])

  // Billing state
  const [authType, setAuthType] = useState<AuthType>('api_key')
  const [expandedMethod, setExpandedMethod] = useState<AuthType | null>(null)
  const [hasCredential, setHasCredential] = useState(false)

  // API Key state
  const [apiKeyValue, setApiKeyValue] = useState('')
  const [baseUrlValue, setBaseUrlValue] = useState('')
  const [customModelNames, setCustomModelNames] = useState({
    opus: '',
    sonnet: '',
    haiku: ''
  })
  const [apiKeyError, setApiKeyError] = useState<string | undefined>()
  // Test connection state
  const [isTestingConnection, setIsTestingConnection] = useState(false)
  const [testConnectionResult, setTestConnectionResult] = useState<{ success: boolean; error?: string; modelCount?: number } | null>(null)

  // Claude OAuth state
  const [existingClaudeToken, setExistingClaudeToken] = useState<string | null>(null)
  const [claudeOAuthStatus, setClaudeOAuthStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [claudeOAuthError, setClaudeOAuthError] = useState<string | undefined>()
  const [isWaitingForCode, setIsWaitingForCode] = useState(false)
  const [authCode, setAuthCode] = useState('')

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

  // API Key auto-save hook
  const { handleBlur } = useApiKeyAutoSave({
    apiKey: apiKeyValue,
    baseUrl: baseUrlValue,
    customModelNames,
    authType,
    hasCredential,
    onSaveSuccess: () => {
      // Could show a success indicator here if needed
    },
    onSaveError: (error) => {
      setApiKeyError(error)
    },
  })

  // Load current billing method, notifications setting, and preset themes on mount
  useEffect(() => {
    const loadSettings = async () => {
      if (!window.electronAPI) return
      try {
        const [billing, notificationsOn] = await Promise.all([
          window.electronAPI.getBillingMethod(),
          window.electronAPI.getNotificationsEnabled(),
        ])
        setAuthType(billing.authType)
        setHasCredential(billing.hasCredential)
        setApiKeyValue(billing.apiKey || '')
        setBaseUrlValue(billing.anthropicBaseUrl || '')
        if (billing.customModelNames) {
          setCustomModelNames({
            opus: billing.customModelNames.opus || '',
            sonnet: billing.customModelNames.sonnet || '',
            haiku: billing.customModelNames.haiku || '',
          })
        }
        setNotificationsEnabled(notificationsOn)
      } catch (error) {
        console.error('Failed to load settings:', error)
      }
    }
    loadSettings()
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

  // Check for existing Claude token when expanding oauth_token option
  useEffect(() => {
    if (expandedMethod !== 'oauth_token') return

    const checkExistingToken = async () => {
      if (!window.electronAPI) return
      try {
        const token = await window.electronAPI.getExistingClaudeToken()
        setExistingClaudeToken(token)
      } catch (error) {
        console.error('Failed to check existing Claude token:', error)
      }
    }
    checkExistingToken()
  }, [expandedMethod])

  // Handle clicking on a billing method option
  const handleMethodClick = useCallback(async (method: AuthType) => {
    if (method === 'api_key') {
      if (authType !== 'api_key') {
        try {
          // Switch to api_key mode using current frontend state (don't reload from backend)
          const trimmedKey = apiKeyValue.trim() || undefined
          const modelNames = (customModelNames.opus || customModelNames.sonnet || customModelNames.haiku)
            ? {
                opus: customModelNames.opus.trim() || undefined,
                sonnet: customModelNames.sonnet.trim() || undefined,
                haiku: customModelNames.haiku.trim() || undefined,
              }
            : null

          await window.electronAPI.updateBillingMethod(
            'api_key',
            trimmedKey,
            baseUrlValue.trim() || null,
            modelNames
          )
          setAuthType('api_key')
          setHasCredential(!!trimmedKey)
        } catch (error) {
          console.error('Failed to switch to API key mode:', error)
        }
      }
      return
    }

    if (method === authType && hasCredential) {
      setExpandedMethod(null)
      return
    }

    setExpandedMethod(method)
    setApiKeyError(undefined)
    setClaudeOAuthStatus('idle')
    setClaudeOAuthError(undefined)
  }, [authType, hasCredential, apiKeyValue])

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

  // Start Claude OAuth flow (native browser-based)
  const handleStartClaudeOAuth = useCallback(async () => {
    if (!window.electronAPI) return

    setClaudeOAuthStatus('loading')
    setClaudeOAuthError(undefined)

    try {
      // Start OAuth flow - this opens the browser
      const result = await window.electronAPI.startClaudeOAuth()

      if (result.success) {
        // Browser opened successfully, now waiting for user to copy the code
        setIsWaitingForCode(true)
        setClaudeOAuthStatus('idle')
      } else {
        setClaudeOAuthStatus('error')
        setClaudeOAuthError(result.error || 'Failed to start OAuth')
      }
    } catch (error) {
      setClaudeOAuthStatus('error')
      setClaudeOAuthError(error instanceof Error ? error.message : 'OAuth failed')
    }
  }, [])

  // Submit authorization code from browser
  const handleSubmitAuthCode = useCallback(async (code: string) => {
    if (!window.electronAPI || !code.trim()) {
      setClaudeOAuthError('Please enter the authorization code')
      return
    }

    setClaudeOAuthStatus('loading')
    setClaudeOAuthError(undefined)

    try {
      const result = await window.electronAPI.exchangeClaudeCode(code.trim())

      if (result.success && result.token) {
        await window.electronAPI.updateBillingMethod('oauth_token', result.token)
        setAuthType('oauth_token')
        setHasCredential(true)
        setClaudeOAuthStatus('success')
        setIsWaitingForCode(false)
        setAuthCode('')
        setExpandedMethod(null)
      } else {
        setClaudeOAuthStatus('error')
        setClaudeOAuthError(result.error || 'Failed to exchange code')
      }
    } catch (error) {
      setClaudeOAuthStatus('error')
      setClaudeOAuthError(error instanceof Error ? error.message : 'Failed to exchange code')
    }
  }, [])

  // Cancel OAuth flow and clear state
  const handleCancelOAuth = useCallback(async () => {
    setIsWaitingForCode(false)
    setAuthCode('')
    setClaudeOAuthStatus('idle')
    setClaudeOAuthError(undefined)
    setExpandedMethod(null)

    // Clear OAuth state on backend
    if (window.electronAPI) {
      try {
        await window.electronAPI.clearClaudeOAuthState()
      } catch (error) {
        // Non-critical: state cleanup failed, but UI is already reset
        console.error('Failed to clear OAuth state:', error)
      }
    }
  }, [])

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

            {/* Billing */}
            <SettingsSection title="Billing" description="Choose how you pay for AI usage">
              <SettingsCard>
                <SettingsMenuSelectRow
                  label="Payment method"
                  description={
                    authType === 'api_key' && hasCredential
                      ? 'API key configured'
                      : authType === 'oauth_token' && hasCredential
                        ? 'Claude connected'
                        : 'Select a method'
                  }
                  value={authType}
                  onValueChange={(v) => handleMethodClick(v as AuthType)}
                  options={[
                    { value: 'oauth_token', label: 'Claude Pro/Max', description: 'Use your Pro or Max subscription' },
                    { value: 'api_key', label: 'API Key', description: 'Pay-as-you-go with your Anthropic key' },
                  ]}
                />
              </SettingsCard>

              {/* API Key Inline Config */}
              {authType === 'api_key' && (
                <SettingsCard className="mt-2" divided>
                  <SettingsSecretInput
                    label="API Key"
                    description="Pay-as-you-go with your Anthropic key"
                    value={apiKeyValue}
                    onChange={setApiKeyValue}
                    onBlur={handleBlur}
                    placeholder="sk-ant-..."
                    inCard
                    error={apiKeyError}
                  />

                  <SettingsInput
                    label="Anthropic Base URL"
                    description="For third-party Claude-compatible APIs (optional)"
                    value={baseUrlValue}
                    onChange={setBaseUrlValue}
                    onBlur={handleBlur}
                    placeholder="https://api.anthropic.com"
                    inCard
                  />

                  <div className="px-4 py-3.5 space-y-3">
                    <div>
                      <Label className="text-sm font-medium">Custom Model Names</Label>
                      <p className="text-xs text-muted-foreground mt-1">
                        Override model IDs for third-party APIs (optional)
                      </p>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <Input
                        placeholder="Opus"
                        value={customModelNames.opus}
                        onChange={(e) => setCustomModelNames(prev => ({ ...prev, opus: e.target.value }))}
                        onBlur={handleBlur}
                      />
                      <Input
                        placeholder="Sonnet"
                        value={customModelNames.sonnet}
                        onChange={(e) => setCustomModelNames(prev => ({ ...prev, sonnet: e.target.value }))}
                        onBlur={handleBlur}
                      />
                      <Input
                        placeholder="Haiku"
                        value={customModelNames.haiku}
                        onChange={(e) => setCustomModelNames(prev => ({ ...prev, haiku: e.target.value }))}
                        onBlur={handleBlur}
                      />
                    </div>
                  </div>

                  {/* Test Connection Button */}
                  <div className="px-4 py-3 border-t border-border/50">
                    <div className="flex items-center gap-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          setIsTestingConnection(true)
                          setTestConnectionResult(null)
                          try {
                            const testModel = customModelNames.sonnet || customModelNames.opus || customModelNames.haiku || undefined
                            const result = await window.electronAPI.testApiConnection(
                              apiKeyValue,
                              baseUrlValue || undefined,
                              testModel
                            )
                            setTestConnectionResult(result)
                          } catch (error) {
                            setTestConnectionResult({
                              success: false,
                              error: error instanceof Error ? error.message : 'Connection failed'
                            })
                          } finally {
                            setIsTestingConnection(false)
                          }
                        }}
                        disabled={!apiKeyValue?.trim() || isTestingConnection}
                      >
                        {isTestingConnection ? (
                          <>
                            <Spinner className="size-3 mr-1.5" />
                            Testing...
                          </>
                        ) : (
                          'Test Connection'
                        )}
                      </Button>
                      {testConnectionResult && (
                        <span className={cn(
                          'text-sm',
                          testConnectionResult.success ? 'text-success' : 'text-destructive'
                        )}>
                          {testConnectionResult.success
                            ? testConnectionResult.modelCount
                              ? `✓ Connected (${testConnectionResult.modelCount} models)`
                              : '✓ Connected'
                            : `✗ ${testConnectionResult.error}`}
                        </span>
                      )}
                    </div>
                  </div>


                </SettingsCard>
              )}

              {/* Claude OAuth Dialog */}
              <Dialog open={expandedMethod === 'oauth_token'} onOpenChange={(open) => !open && handleCancelOAuth()}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Claude Max</DialogTitle>
                    <DialogDescription>
                      Connect your Claude subscription
                    </DialogDescription>
                  </DialogHeader>
                  {isWaitingForCode ? (
                    <ClaudeOAuthDialogContent
                      existingToken={existingClaudeToken}
                      isLoading={claudeOAuthStatus === 'loading'}
                      onUseExisting={handleUseExistingClaudeToken}
                      onStartOAuth={handleStartClaudeOAuth}
                      onCancel={handleCancelOAuth}
                      status={claudeOAuthStatus}
                      errorMessage={claudeOAuthError}
                      isWaitingForCode={true}
                      authCode={authCode}
                      onAuthCodeChange={setAuthCode}
                      onSubmitAuthCode={handleSubmitAuthCode}
                    />
                  ) : (
                    <ClaudeOAuthDialogContent
                      existingToken={existingClaudeToken}
                      isLoading={claudeOAuthStatus === 'loading'}
                      onUseExisting={handleUseExistingClaudeToken}
                      onStartOAuth={handleStartClaudeOAuth}
                      onCancel={handleCancelOAuth}
                      status={claudeOAuthStatus}
                      errorMessage={claudeOAuthError}
                      isWaitingForCode={false}
                    />
                  )}
                </DialogContent>
              </Dialog>
            </SettingsSection>

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
