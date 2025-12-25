/**
 * SettingsTabPanel
 *
 * Settings page for app configuration.
 * Theme uses horizontal buttons, other settings use vertical radio lists.
 * Billing section includes inline credential entry for API Key and Claude OAuth.
 */

import * as React from 'react'
import { useState, useEffect, useCallback } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useTheme, type FontFamily } from '@/context/ThemeContext'
import { useChatContext } from '@/context/ChatContext'
import { cn } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'
import { Monitor, Sun, Moon, Eye, EyeOff, Check, ExternalLink, CheckCircle2, Folder } from 'lucide-react'
import { Spinner } from '@/components/ui/loading-indicator'
import type { Tab } from '../types'
import type { AuthType } from '../../../shared/types'

interface SettingsTabPanelProps {
  tab: Tab
  authType?: AuthType
  model?: string
  onAuthTypeChange?: (type: AuthType) => void
  onModelChange?: (model: string) => void
}

// ============================================
// Section Header
// ============================================

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
      {children}
    </h3>
  )
}

// ============================================
// Setting Row - for horizontal controls (theme)
// ============================================

interface SettingRowProps {
  label: string
  children: React.ReactNode
}

function SettingRow({ label, children }: SettingRowProps) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm">{label}</span>
      <div className="flex items-center gap-1 ml-4 shrink-0">
        {children}
      </div>
    </div>
  )
}

// ============================================
// Toggle Row - setting with switch toggle
// ============================================

interface ToggleRowProps {
  label: string
  description?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

function ToggleRow({ label, description, checked, onCheckedChange }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex-1 min-w-0">
        <span className="text-sm">{label}</span>
        {description && (
          <span className="text-sm text-muted-foreground ml-1.5">{description}</span>
        )}
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="ml-4 shrink-0"
      />
    </div>
  )
}

// ============================================
// Radio Option - vertical list item with radio on right
// ============================================

interface RadioOptionProps {
  selected: boolean
  onClick: () => void
  label: string
  description?: string
}

function RadioOption({ selected, onClick, label, description }: RadioOptionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-center justify-between py-1.5 text-left transition-colors rounded',
        'hover:bg-foreground/[0.02]'
      )}
    >
      <div className="flex-1 min-w-0">
        <span className="text-sm">{label}</span>
        {description && (
          <span className="text-sm text-muted-foreground ml-1.5">{description}</span>
        )}
      </div>
      <div
        className={cn(
          'w-[14px] h-[14px] rounded-full border-[1.5px] grid place-items-center transition-colors shrink-0 ml-4',
          selected ? 'border-primary bg-primary' : 'border-muted-foreground/30'
        )}
      >
        {selected && <div className="w-[6px] h-[6px] rounded-full bg-primary-foreground" />}
      </div>
    </button>
  )
}

// ============================================
// Theme Button (icon-based, horizontal)
// ============================================

interface ThemeButtonProps {
  selected: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}

function ThemeButton({ selected, onClick, icon, label }: ThemeButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors',
        'hover:bg-foreground/5',
        selected && 'bg-foreground/5'
      )}
      title={label}
    >
      <div className={cn('w-4 h-4', selected ? 'text-foreground' : 'text-muted-foreground')}>
        {icon}
      </div>
      <span className={cn(selected ? 'text-foreground' : 'text-muted-foreground')}>
        {label}
      </span>
    </button>
  )
}

// ============================================
// Craft Credits Option (with Check Credits link)
// ============================================

interface CraftCreditsOptionProps {
  selected: boolean
  onClick: () => void
}

function CraftCreditsOption({ selected, onClick }: CraftCreditsOptionProps) {
  const [isLoadingUrl, setIsLoadingUrl] = useState(false)

  const handleCheckCredits = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation() // Don't trigger the parent onClick
    if (!window.electronAPI) return

    setIsLoadingUrl(true)
    try {
      const url = await window.electronAPI.getCreditsUrl()
      if (url) {
        await window.electronAPI.openUrl(url)
      }
    } catch (error) {
      console.error('Failed to get credits URL:', error)
    } finally {
      setIsLoadingUrl(false)
    }
  }, [])

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'w-full flex items-center justify-between py-1.5 text-left transition-colors rounded',
          'hover:bg-foreground/[0.02]'
        )}
      >
        <div className="flex-1 min-w-0">
          <span className="text-sm">Craft Credits</span>
          <span className="text-sm text-muted-foreground ml-1.5">— included with Craft</span>
        </div>
        <div
          className={cn(
            'w-[14px] h-[14px] rounded-full border-[1.5px] grid place-items-center transition-colors shrink-0 ml-4',
            selected ? 'border-primary bg-primary' : 'border-muted-foreground/30'
          )}
        >
          {selected && <div className="w-[6px] h-[6px] rounded-full bg-primary-foreground" />}
        </div>
      </button>
      {selected && (
        <button
          type="button"
          onClick={handleCheckCredits}
          disabled={isLoadingUrl}
          className="ml-0 mt-0.5 mb-1 text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
        >
          {isLoadingUrl ? (
            <>
              <Spinner className="text-[10px]" />
              <span>Loading...</span>
            </>
          ) : (
            <>
              <ExternalLink className="size-3" />
              <span>Check Credits</span>
            </>
          )}
        </button>
      )}
    </div>
  )
}

// ============================================
// API Key Input Component
// ============================================

interface ApiKeyInputProps {
  value: string
  onChange: (value: string) => void
  onSave: () => void
  onCancel: () => void
  isSaving: boolean
  hasExistingKey: boolean
  error?: string
}

function ApiKeyInput({ value, onChange, onSave, onCancel, isSaving, hasExistingKey, error }: ApiKeyInputProps) {
  const [showValue, setShowValue] = useState(false)

  return (
    <div className={cn(
      "py-1.5 px-3 -mx-3 rounded-lg bg-foreground/[0.02] border space-y-3",
      error ? "border-destructive/50" : "border-border/50"
    )}>
      {/* Header - same visual as RadioOption */}
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <span className="text-sm">API Key</span>
          <span className="text-sm text-muted-foreground ml-1.5">— your Anthropic key</span>
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-muted-foreground">
        Pay-as-you-go with your own API key.{' '}
        <a
          href="https://console.anthropic.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline inline-flex items-center gap-0.5"
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
          className={cn("pr-10 text-sm bg-background", error && "border-destructive")}
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
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={onSave}
          disabled={!value.trim() || isSaving}
          className="text-xs"
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
          size="sm"
          variant="ghost"
          onClick={onCancel}
          disabled={isSaving}
          className="text-xs bg-foreground/5 hover:bg-foreground/10"
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}

// ============================================
// Claude OAuth Component
// ============================================

interface ClaudeOAuthProps {
  existingToken: string | null
  isCliInstalled: boolean
  isLoading: boolean
  onUseExisting: () => void
  onStartOAuth: () => void
  onCancel: () => void
  status: 'idle' | 'loading' | 'success' | 'error'
  errorMessage?: string
  showCancel: boolean
}

function ClaudeOAuth({
  existingToken,
  isCliInstalled,
  isLoading,
  onUseExisting,
  onStartOAuth,
  onCancel,
  status,
  errorMessage,
  showCancel,
}: ClaudeOAuthProps) {
  // Header component for consistency
  const Header = () => (
    <div className="flex items-center justify-between">
      <div className="flex-1 min-w-0">
        <span className="text-sm">Claude Max</span>
        <span className="text-sm text-muted-foreground ml-1.5">— subscription</span>
      </div>
    </div>
  )

  if (status === 'success') {
    return (
      <div className="py-1.5 px-3 -mx-3 rounded-lg bg-foreground/[0.02] border border-border/50 space-y-2">
        <Header />
        <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
          <CheckCircle2 className="size-4" />
          Connected to Claude
        </div>
      </div>
    )
  }

  if (!isCliInstalled && !existingToken) {
    return (
      <div className="py-1.5 px-3 -mx-3 rounded-lg bg-foreground/[0.02] border border-border/50 space-y-3">
        <Header />
        <p className="text-xs text-muted-foreground">
          Use your Claude Pro or Max subscription. Requires Claude Code CLI.{' '}
          <a
            href="https://docs.anthropic.com/claude-code/getting-started"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline inline-flex items-center gap-0.5"
            onClick={(e) => {
              e.preventDefault()
              window.electronAPI?.openUrl('https://docs.anthropic.com/claude-code/getting-started')
            }}
          >
            Install Claude Code
            <ExternalLink className="size-3" />
          </a>
        </p>
        {showCancel && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onCancel}
            className="text-xs bg-foreground/5 hover:bg-foreground/10"
          >
            Cancel
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className={cn(
      "py-1.5 px-3 -mx-3 rounded-lg bg-foreground/[0.02] border space-y-3",
      errorMessage ? "border-destructive/50" : "border-border/50"
    )}>
      <Header />
      <p className="text-xs text-muted-foreground">
        Use your Claude Pro or Max subscription for unlimited access.
      </p>
      <div className="flex items-center gap-2">
        {existingToken ? (
          <Button
            size="sm"
            onClick={onUseExisting}
            disabled={isLoading}
            className="text-xs"
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
            size="sm"
            onClick={onStartOAuth}
            disabled={isLoading}
            className="text-xs"
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
        {showCancel && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onCancel}
            disabled={isLoading}
            className="text-xs bg-foreground/5 hover:bg-foreground/10"
          >
            Cancel
          </Button>
        )}
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

export default function SettingsTabPanel({
  tab: _tab,
  authType: propAuthType,
  model: propModel,
  onAuthTypeChange,
  onModelChange: propOnModelChange,
}: SettingsTabPanelProps) {
  const { mode, setMode, font, setFont } = useTheme()

  // Get model and onModelChange from context (primary) or props (playground fallback)
  const chatContext = useChatContext()
  const model = propModel ?? chatContext.currentModel ?? 'claude-sonnet-4-5-20250929'
  const onModelChange = propOnModelChange ?? chatContext.onModelChange

  // Billing state
  const [authType, setAuthType] = useState<AuthType>(propAuthType ?? 'craft_credits') // Actually saved auth type
  const [expandedMethod, setExpandedMethod] = useState<AuthType | null>(null) // Which input box is expanded (not yet saved)
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

  // New session defaults state
  const [defaultSafeMode, setDefaultSafeMode] = useState(false)
  const [defaultSkipPermissions, setDefaultSkipPermissions] = useState(false)
  const [defaultWorkingDirectory, setDefaultWorkingDirectory] = useState('')

  // Load new session defaults on mount
  useEffect(() => {
    const loadDefaults = async () => {
      if (!window.electronAPI) return
      try {
        const [modes, skipPerms, workingDir] = await Promise.all([
          window.electronAPI.getDefaultModes(),
          window.electronAPI.getDefaultSkipPermissions(),
          window.electronAPI.getDefaultWorkingDirectory(),
        ])
        // Check if 'safe' mode is in the default modes array
        setDefaultSafeMode(modes.includes('safe'))
        setDefaultSkipPermissions(skipPerms)
        setDefaultWorkingDirectory(workingDir)
      } catch (error) {
        console.error('Failed to load session defaults:', error)
      }
    }
    loadDefaults()
  }, [])

  // Handlers for new session defaults
  const handleDefaultSafeModeChange = useCallback(async (enabled: boolean) => {
    if (!window.electronAPI) return
    setDefaultSafeMode(enabled)
    try {
      // Get current modes, then add or remove 'safe' mode
      const currentModes = await window.electronAPI.getDefaultModes()
      const newModes = enabled
        ? (currentModes.includes('safe') ? currentModes : [...currentModes, 'safe'] as import('../../../shared/types').Mode[])
        : currentModes.filter(m => m !== 'safe')
      await window.electronAPI.setDefaultModes(newModes)
    } catch (error) {
      console.error('Failed to save default safe mode:', error)
      setDefaultSafeMode(!enabled) // Revert on error
    }
  }, [])

  const handleDefaultSkipPermissionsChange = useCallback(async (enabled: boolean) => {
    if (!window.electronAPI) return
    setDefaultSkipPermissions(enabled)
    try {
      await window.electronAPI.setDefaultSkipPermissions(enabled)
    } catch (error) {
      console.error('Failed to save default skip permissions:', error)
      setDefaultSkipPermissions(!enabled) // Revert on error
    }
  }, [])

  const handleChangeWorkingDirectory = useCallback(async () => {
    if (!window.electronAPI) return
    try {
      const selectedPath = await window.electronAPI.openFolderDialog()
      if (selectedPath) {
        setDefaultWorkingDirectory(selectedPath)
        await window.electronAPI.setDefaultWorkingDirectory(selectedPath)
      }
    } catch (error) {
      console.error('Failed to change working directory:', error)
    }
  }, [])

  // Load current billing method on mount
  useEffect(() => {
    const loadBilling = async () => {
      if (!window.electronAPI) return
      try {
        const billing = await window.electronAPI.getBillingMethod()
        setAuthType(billing.authType)
        setHasCredential(billing.hasCredential)
      } catch (error) {
        console.error('Failed to load billing method:', error)
      } finally {
        setIsLoadingBilling(false)
      }
    }
    loadBilling()
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

  // Sync with prop changes (for playground)
  useEffect(() => {
    if (propAuthType !== undefined) {
      setAuthType(propAuthType)
    }
  }, [propAuthType])

  // Handle clicking on a billing method option
  const handleMethodClick = useCallback(async (method: AuthType) => {
    // If clicking the already-selected method, do nothing
    if (method === authType && hasCredential) {
      setExpandedMethod(null)
      return
    }

    // For craft_credits, save immediately (no credential needed)
    if (method === 'craft_credits' && window.electronAPI) {
      try {
        await window.electronAPI.updateBillingMethod(method)
        setAuthType(method)
        setHasCredential(true)
        setExpandedMethod(null)
        onAuthTypeChange?.(method)
      } catch (error) {
        console.error('Failed to update billing method:', error)
      }
    } else {
      // For api_key or oauth_token, just expand the input (don't switch yet)
      setExpandedMethod(method)
      // Clear any previous errors
      setApiKeyError(undefined)
      setClaudeOAuthStatus('idle')
      setClaudeOAuthError(undefined)
    }
  }, [authType, hasCredential, onAuthTypeChange])

  // Cancel - just close the expanded box
  const handleCancel = useCallback(() => {
    setExpandedMethod(null)
    setApiKeyValue('')
    setApiKeyError(undefined)
    setClaudeOAuthStatus('idle')
    setClaudeOAuthError(undefined)
  }, [])

  // Save API key - validates, saves, and switches billing method
  const handleSaveApiKey = useCallback(async () => {
    if (!window.electronAPI || !apiKeyValue.trim()) return

    setIsSavingApiKey(true)
    setApiKeyError(undefined)
    try {
      // TODO: Add real API key validation here
      await window.electronAPI.updateBillingMethod('api_key', apiKeyValue.trim())
      // Success - switch to api_key
      setAuthType('api_key')
      setHasCredential(true)
      setApiKeyValue('')
      setExpandedMethod(null)
      onAuthTypeChange?.('api_key')
    } catch (error) {
      console.error('Failed to save API key:', error)
      setApiKeyError(error instanceof Error ? error.message : 'Invalid API key. Please check and try again.')
    } finally {
      setIsSavingApiKey(false)
    }
  }, [apiKeyValue, onAuthTypeChange])

  // Use existing Claude token
  const handleUseExistingClaudeToken = useCallback(async () => {
    if (!window.electronAPI || !existingClaudeToken) return

    setClaudeOAuthStatus('loading')
    setClaudeOAuthError(undefined)
    try {
      await window.electronAPI.updateBillingMethod('oauth_token', existingClaudeToken)
      // Success - switch to oauth_token
      setAuthType('oauth_token')
      setHasCredential(true)
      setClaudeOAuthStatus('success')
      setExpandedMethod(null)
      onAuthTypeChange?.('oauth_token')
    } catch (error) {
      setClaudeOAuthStatus('error')
      setClaudeOAuthError(error instanceof Error ? error.message : 'Failed to save token')
    }
  }, [existingClaudeToken, onAuthTypeChange])

  // Start Claude OAuth flow
  const handleStartClaudeOAuth = useCallback(async () => {
    if (!window.electronAPI) return

    setClaudeOAuthStatus('loading')
    setClaudeOAuthError(undefined)
    try {
      const result = await window.electronAPI.runClaudeSetupToken()
      if (result.success && result.token) {
        await window.electronAPI.updateBillingMethod('oauth_token', result.token)
        // Success - switch to oauth_token
        setAuthType('oauth_token')
        setHasCredential(true)
        setClaudeOAuthStatus('success')
        setExpandedMethod(null)
        onAuthTypeChange?.('oauth_token')
      } else {
        setClaudeOAuthStatus('error')
        setClaudeOAuthError(result.error || 'OAuth failed')
      }
    } catch (error) {
      setClaudeOAuthStatus('error')
      setClaudeOAuthError(error instanceof Error ? error.message : 'OAuth failed')
    }
  }, [onAuthTypeChange])

  return (
    <ScrollArea className="h-full">
      <div className="px-5 py-4">
        <div className="space-y-6">
          {/* Appearance - horizontal theme buttons */}
          <div>
            <SectionHeader>Appearance</SectionHeader>
            <SettingRow label="Theme">
              <ThemeButton
                selected={mode === 'system'}
                onClick={() => setMode('system')}
                icon={<Monitor className="w-4 h-4" />}
                label="System"
              />
              <ThemeButton
                selected={mode === 'light'}
                onClick={() => setMode('light')}
                icon={<Sun className="w-4 h-4" />}
                label="Light"
              />
              <ThemeButton
                selected={mode === 'dark'}
                onClick={() => setMode('dark')}
                icon={<Moon className="w-4 h-4" />}
                label="Dark"
              />
            </SettingRow>
            <SettingRow label="Font">
              <ThemeButton
                selected={font === 'inter'}
                onClick={() => setFont('inter')}
                icon={<span className="w-4 h-4 flex items-center justify-center font-semibold text-xs">Aa</span>}
                label="Inter"
              />
              <ThemeButton
                selected={font === 'system'}
                onClick={() => setFont('system')}
                icon={<Monitor className="w-4 h-4" />}
                label="System"
              />
            </SettingRow>
          </div>

          {/* Model - vertical radio list */}
          <div>
            <SectionHeader>Model</SectionHeader>
            <div>
              <RadioOption
                selected={model === 'claude-opus-4-5-20251101'}
                onClick={() => onModelChange?.('claude-opus-4-5-20251101')}
                label="Opus 4.5"
                description="— most capable"
              />
              <RadioOption
                selected={model === 'claude-sonnet-4-5-20250929'}
                onClick={() => onModelChange?.('claude-sonnet-4-5-20250929')}
                label="Sonnet 4.5"
                description="— balanced"
              />
              <RadioOption
                selected={model === 'claude-haiku-4-5-20251001'}
                onClick={() => onModelChange?.('claude-haiku-4-5-20251001')}
                label="Haiku 4.5"
                description="— fast"
              />
            </div>
          </div>

          {/* New Sessions - default settings for new chats */}
          <div>
            <SectionHeader>New Sessions</SectionHeader>
            <div>
              <ToggleRow
                label="Safe Mode"
                description="— start with safe mode enabled"
                checked={defaultSafeMode}
                onCheckedChange={handleDefaultSafeModeChange}
              />
              <ToggleRow
                label="Skip Permissions"
                description="— auto-approve tool use"
                checked={defaultSkipPermissions}
                onCheckedChange={handleDefaultSkipPermissionsChange}
              />
            </div>
          </div>

          {/* Working Directory - folder selector */}
          <div>
            <SectionHeader>Working Directory</SectionHeader>
            <div className="space-y-1">
              <button
                type="button"
                onClick={handleChangeWorkingDirectory}
                className="w-full flex items-center gap-2 py-1.5 text-left transition-colors rounded hover:bg-foreground/[0.02]"
              >
                <Folder className="size-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium truncate">
                  {defaultWorkingDirectory ? defaultWorkingDirectory.split('/').pop() : 'Home'}
                </span>
                <span className="text-xs text-muted-foreground ml-auto shrink-0">Change...</span>
              </button>
              <p className="text-xs text-muted-foreground truncate pl-6">
                {defaultWorkingDirectory || '~'}
              </p>
            </div>
          </div>

          {/* Billing - vertical radio list with inline credential entry */}
          <div>
            <SectionHeader>Billing</SectionHeader>
            <div>
              {/* Craft Credits - always visible, with Check Credits link when selected */}
              <CraftCreditsOption
                selected={authType === 'craft_credits'}
                onClick={() => handleMethodClick('craft_credits')}
              />

              {/* API Key - show radio OR input box (not both) */}
              {expandedMethod === 'api_key' ? (
                <ApiKeyInput
                  value={apiKeyValue}
                  onChange={setApiKeyValue}
                  onSave={handleSaveApiKey}
                  onCancel={handleCancel}
                  isSaving={isSavingApiKey}
                  hasExistingKey={authType === 'api_key' && hasCredential}
                  error={apiKeyError}
                />
              ) : (
                <RadioOption
                  selected={authType === 'api_key'}
                  onClick={() => handleMethodClick('api_key')}
                  label="API Key"
                  description={authType === 'api_key' && hasCredential ? '— configured' : '— your Anthropic key'}
                />
              )}

              {/* Claude Max - show radio OR OAuth box (not both) */}
              {expandedMethod === 'oauth_token' ? (
                <ClaudeOAuth
                  existingToken={existingClaudeToken}
                  isCliInstalled={isClaudeCliInstalled}
                  isLoading={claudeOAuthStatus === 'loading'}
                  onUseExisting={handleUseExistingClaudeToken}
                  onStartOAuth={handleStartClaudeOAuth}
                  onCancel={handleCancel}
                  status={claudeOAuthStatus}
                  showCancel={true}
                  errorMessage={claudeOAuthError}
                />
              ) : (
                <RadioOption
                  selected={authType === 'oauth_token'}
                  onClick={() => handleMethodClick('oauth_token')}
                  label="Claude Max"
                  description={authType === 'oauth_token' && hasCredential ? '— connected' : '— subscription'}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </ScrollArea>
  )
}
