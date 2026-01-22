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
  Upload,
  Settings2,
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
import { SettingsSecretInput } from '@/components/settings'
import { CustomEndpointValidationDialog } from '@/components/settings/CustomEndpointValidationDialog'
import { ViewCustomEndpointConfigDialog } from '@/components/settings/ViewCustomEndpointConfigDialog'

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

    // Build custom model names object (only include non-empty values)
    const modelNames = {
      opus: customModelNames.opus.trim() || undefined,
      sonnet: customModelNames.sonnet.trim() || undefined,
      haiku: customModelNames.haiku.trim() || undefined,
    }
    const hasModelNames = modelNames.opus || modelNames.sonnet || modelNames.haiku

    saveStartTimeRef.current = Date.now()
    onSaveStart?.()
    try {
      await window.electronAPI.updateBillingMethod(
        'api_key',
        trimmedKey,  // Pass empty string to clear credential
        baseUrl.trim() || null,
        hasModelNames ? modelNames : null
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
  // paymentMethod is the UI-level concept: 'oauth_token', 'api_key', or 'custom_endpoint'
  // authType is the storage-level concept: 'api_key' or 'oauth_token' (custom_endpoint uses api_key)
  type PaymentMethod = 'oauth_token' | 'api_key' | 'custom_endpoint'
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('api_key')
  const [authType, setAuthType] = useState<AuthType>('api_key')
  const [expandedMethod, setExpandedMethod] = useState<AuthType | null>(null)
  const [hasCredential, setHasCredential] = useState(false)

  // API Key state (simple Anthropic API key, no advanced settings)
  const [apiKeyValue, setApiKeyValue] = useState('')
  const [apiKeyError, setApiKeyError] = useState<string | undefined>()

  // Custom endpoint state
  const [hasCustomEndpoint, setHasCustomEndpoint] = useState(false)
  const [showValidationDialog, setShowValidationDialog] = useState(false)
  const [showViewConfigDialog, setShowViewConfigDialog] = useState(false)
  const [pendingConfigJson, setPendingConfigJson] = useState('')

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

  // API Key auto-save hook (simplified - no base URL or model names)
  const { handleBlur } = useApiKeyAutoSave({
    apiKey: apiKeyValue,
    baseUrl: '',  // Not used for simple API key mode
    customModelNames: { opus: '', sonnet: '', haiku: '' },  // Not used for simple API key mode
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
        const [billing, customEndpoint, notificationsOn] = await Promise.all([
          window.electronAPI.getBillingMethod(),
          window.electronAPI.getCustomEndpointConfig(),
          window.electronAPI.getNotificationsEnabled(),
        ])
        setAuthType(billing.authType)
        setHasCredential(billing.hasCredential)
        setNotificationsEnabled(notificationsOn)

        // Determine payment method based on config
        // If custom endpoint is configured (has base URL), use custom_endpoint
        // Otherwise use the authType directly
        if (customEndpoint.hasConfig) {
          setPaymentMethod('custom_endpoint')
          setHasCustomEndpoint(true)
          // Don't set apiKeyValue for custom endpoint (it's managed separately)
        } else if (billing.authType === 'oauth_token') {
          setPaymentMethod('oauth_token')
        } else {
          setPaymentMethod('api_key')
          setApiKeyValue(billing.apiKey || '')
        }
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

  // Handle clicking on a payment method option
  // PaymentMethod is 'oauth_token', 'api_key', or 'custom_endpoint'
  const handleMethodClick = useCallback(async (method: PaymentMethod) => {
    // Switching to API Key mode (simple Anthropic API key)
    if (method === 'api_key') {
      // First clear any custom endpoint config if present
      if (hasCustomEndpoint) {
        try {
          await window.electronAPI.clearCustomEndpointConfig()
          setHasCustomEndpoint(false)
        } catch (error) {
          console.error('Failed to clear custom endpoint config:', error)
        }
      }

      // Switch to api_key mode
      if (authType !== 'api_key' || paymentMethod !== 'api_key') {
        try {
          const trimmedKey = apiKeyValue.trim() || undefined
          await window.electronAPI.updateBillingMethod('api_key', trimmedKey, null, null)
          setAuthType('api_key')
          setPaymentMethod('api_key')
          setHasCredential(!!trimmedKey)
        } catch (error) {
          console.error('Failed to switch to API key mode:', error)
        }
      }
      return
    }

    // Switching to Custom Endpoint mode
    if (method === 'custom_endpoint') {
      setPaymentMethod('custom_endpoint')
      // Don't change authType yet - it will be set when config is uploaded
      return
    }

    // OAuth token mode - show dialog
    if (method === 'oauth_token') {
      if (method === authType && hasCredential) {
        setExpandedMethod(null)
        return
      }
      setExpandedMethod('oauth_token')
      setApiKeyError(undefined)
      setClaudeOAuthStatus('idle')
      setClaudeOAuthError(undefined)
    }
  }, [authType, paymentMethod, hasCredential, apiKeyValue, hasCustomEndpoint])

  // Use existing Claude token
  const handleUseExistingClaudeToken = useCallback(async () => {
    if (!window.electronAPI || !existingClaudeToken) return

    setClaudeOAuthStatus('loading')
    setClaudeOAuthError(undefined)
    try {
      await window.electronAPI.updateBillingMethod('oauth_token', existingClaudeToken)
      setAuthType('oauth_token')
      setPaymentMethod('oauth_token')
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
        setPaymentMethod('oauth_token')
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

  // Handle file upload for custom endpoint config
  const handleUploadConfig = useCallback(async () => {
    // Open file picker for JSON files
    // openFileDialog returns string[] (array of file paths)
    const result = await window.electronAPI.openFileDialog()
    if (!result || result.length === 0) return

    const filePath = result[0]
    if (!filePath.endsWith('.json')) {
      console.error('Please select a JSON file')
      return
    }

    // Read the file content
    try {
      const content = await window.electronAPI.readFile(filePath)
      setPendingConfigJson(content)
      setShowValidationDialog(true)
    } catch (error) {
      console.error('Failed to read config file:', error)
    }
  }, [])

  // Handle successful config validation
  const handleConfigValidationSuccess = useCallback(() => {
    setHasCustomEndpoint(true)
    setAuthType('api_key')  // Custom endpoint uses api_key auth type internally
    setHasCredential(true)
    setPendingConfigJson('')
  }, [])

  // Handle config cleared
  const handleConfigCleared = useCallback(() => {
    setHasCustomEndpoint(false)
    setHasCredential(false)
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
                    paymentMethod === 'custom_endpoint' && hasCustomEndpoint
                      ? 'Custom endpoint configured'
                      : paymentMethod === 'api_key' && hasCredential
                        ? 'API key configured'
                        : paymentMethod === 'oauth_token' && hasCredential
                          ? 'Claude connected'
                          : 'Select a method'
                  }
                  value={paymentMethod}
                  onValueChange={(v) => handleMethodClick(v as PaymentMethod)}
                  options={[
                    { value: 'oauth_token', label: 'Claude Pro/Max', description: 'Use your Pro or Max subscription' },
                    { value: 'api_key', label: 'Anthropic API Key', description: 'Pay-as-you-go with your Anthropic key' },
                    { value: 'custom_endpoint', label: 'Custom Endpoint', description: 'OpenRouter, Ollama, or compatible APIs' },
                  ]}
                />
              </SettingsCard>

              {/* API Key Inline Config (simple - no advanced settings) */}
              {paymentMethod === 'api_key' && (
                <SettingsCard className="mt-2">
                  <SettingsSecretInput
                    label="API Key"
                    description="Your Anthropic API key for Claude"
                    value={apiKeyValue}
                    onChange={setApiKeyValue}
                    onBlur={handleBlur}
                    placeholder="sk-ant-..."
                    inCard
                    error={apiKeyError}
                  />
                </SettingsCard>
              )}

              {/* Custom Endpoint Config Card */}
              {paymentMethod === 'custom_endpoint' && (
                <SettingsCard className="mt-2">
                  <div className="px-4 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Settings2 className="size-4 text-muted-foreground" />
                          <span className="text-sm font-medium">
                            {hasCustomEndpoint ? 'Configuration' : 'Upload Configuration'}
                          </span>
                          {hasCustomEndpoint && (
                            <span className="text-xs bg-green-500/20 text-green-600 dark:text-green-400 px-1.5 py-0.5 rounded">
                              configured
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          Upload a JSON configuration file to connect to compatible APIs.{' '}
                          <a
                            href="#"
                            onClick={(e) => {
                              e.preventDefault()
                              window.electronAPI.openUrl('https://agents.craft.do/docs/reference/config/custom-endpoint')
                            }}
                            className="text-primary hover:underline"
                          >
                            Learn more →
                          </a>
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {hasCustomEndpoint && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setShowViewConfigDialog(true)}
                          >
                            View Config
                          </Button>
                        )}
                        <Button
                          variant={hasCustomEndpoint ? 'outline' : 'default'}
                          size="sm"
                          onClick={handleUploadConfig}
                        >
                          <Upload className="size-3.5 mr-1.5" />
                          {hasCustomEndpoint ? 'Replace' : 'Upload'}
                        </Button>
                      </div>
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

              {/* Custom Endpoint Validation Dialog */}
              <CustomEndpointValidationDialog
                open={showValidationDialog}
                onOpenChange={setShowValidationDialog}
                jsonContent={pendingConfigJson}
                onSuccess={handleConfigValidationSuccess}
                onCancel={() => setPendingConfigJson('')}
              />

              {/* View Custom Endpoint Config Dialog */}
              <ViewCustomEndpointConfigDialog
                open={showViewConfigDialog}
                onOpenChange={setShowViewConfigDialog}
                onClear={handleConfigCleared}
              />
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
