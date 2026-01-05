/**
 * SettingsTabPanel
 *
 * Settings page combining global and workspace settings.
 *
 * Global Settings:
 * - Appearance (Theme, Font)
 * - Billing (Craft Credits, API Key, Claude Max)
 *
 * Workspace Settings (for active workspace):
 * - Model
 * - Default Permission Mode
 * - Default Working Directory
 * - Credential Storage Strategy
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
import {
  Monitor,
  Sun,
  Moon,
  Eye,
  EyeOff,
  Check,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Unlock,
} from 'lucide-react'
import { Spinner } from '@/components/ui/loading-indicator'
import { RenameDialog } from '@/components/ui/rename-dialog'
import type { Tab } from '../types'
import type { AuthType, PermissionMode } from '../../../shared/types'

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
// Group Header - for separating app vs workspace settings
// ============================================

function GroupHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4 pb-1.5 border-b border-border">
      {children}
    </h2>
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
  disabled?: boolean
}

function RadioOption({ selected, onClick, label, description, disabled }: RadioOptionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'w-full flex items-center justify-between py-1.5 text-left transition-colors rounded',
        disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-foreground/[0.02]'
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
          selected ? 'border-foreground bg-foreground' : 'border-muted-foreground/30'
        )}
      >
        {selected && <div className="w-[6px] h-[6px] rounded-full bg-background" />}
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
          <span className="text-sm text-muted-foreground ml-1.5">· included with Craft</span>
        </div>
        <div
          className={cn(
            'w-[14px] h-[14px] rounded-full border-[1.5px] grid place-items-center transition-colors shrink-0 ml-4',
            selected ? 'border-foreground bg-foreground' : 'border-muted-foreground/30'
          )}
        >
          {selected && <div className="w-[6px] h-[6px] rounded-full bg-background" />}
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
          <span className="text-sm text-muted-foreground ml-1.5">· your Anthropic key</span>
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-muted-foreground">
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
        <span className="text-sm text-muted-foreground ml-1.5">· subscription</span>
      </div>
    </div>
  )

  if (status === 'success') {
    return (
      <div className="py-1.5 px-3 -mx-3 rounded-lg bg-foreground/[0.02] border border-border/50 space-y-2">
        <Header />
        <div className="flex items-center gap-2 text-sm text-success">
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
// Credential Strategy Types
// ============================================

type CredentialStrategy = 'local' | 'portable'

// ============================================
// Password Dialog for Portable Credentials
// ============================================

interface PasswordDialogProps {
  mode: 'set' | 'unlock'
  onSubmit: (password: string) => void
  onCancel: () => void
  isLoading: boolean
  error?: string
}

function PasswordDialog({ mode, onSubmit, onCancel, isLoading, error }: PasswordDialogProps) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const isSettingPassword = mode === 'set'
  const passwordsMatch = !isSettingPassword || password === confirmPassword
  const isShortPassword = password.length > 0 && password.length < 12

  const handleSubmit = () => {
    if (!password || (isSettingPassword && !passwordsMatch)) return
    onSubmit(password)
  }

  return (
    <div className="py-2 px-3 -mx-3 rounded-lg bg-foreground/[0.02] border border-border/50 space-y-3">
      <div className="flex items-center gap-2">
        {isSettingPassword ? <Lock className="size-4" /> : <Unlock className="size-4" />}
        <span className="text-sm font-medium">
          {isSettingPassword ? 'Set Master Password' : 'Unlock Credentials'}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        {isSettingPassword
          ? "Create a password to encrypt your API keys. You'll need this when using this workspace on another device."
          : 'This workspace uses portable credentials. Enter your password to unlock.'}
      </p>

      {/* Password input */}
      <div className="space-y-2">
        <div className="relative">
          <Input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="pr-10 text-sm bg-background"
            disabled={isLoading}
            onKeyDown={(e) => e.key === 'Enter' && !isSettingPassword && handleSubmit()}
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            tabIndex={-1}
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>

        {isSettingPassword && (
          <Input
            type={showPassword ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm password"
            className="text-sm bg-background"
            disabled={isLoading}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          />
        )}
      </div>

      {/* Short password warning (non-blocking) */}
      {isShortPassword && (
        <div className="flex items-start gap-2 text-xs text-info">
          <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
          <span>Short passwords are easier to guess. Consider 12+ characters.</span>
        </div>
      )}

      {/* Password mismatch error */}
      {isSettingPassword && confirmPassword && !passwordsMatch && (
        <p className="text-xs text-destructive">Passwords don't match</p>
      )}

      {/* API error */}
      {error && <p className="text-xs text-destructive">{error}</p>}

      {/* Cannot recover warning */}
      {isSettingPassword && (
        <p className="text-xs text-muted-foreground">
          ⚠️ This password cannot be recovered if forgotten.
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={!password || (isSettingPassword && !passwordsMatch) || isLoading}
          className="text-xs"
        >
          {isLoading ? (
            <>
              <Spinner className="mr-1.5" />
              {isSettingPassword ? 'Enabling...' : 'Unlocking...'}
            </>
          ) : (
            <>
              <Check className="size-3 mr-1.5" />
              {isSettingPassword ? 'Enable' : 'Unlock'}
            </>
          )}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onCancel}
          disabled={isLoading}
          className="text-xs bg-foreground/5 hover:bg-foreground/10"
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}

// ============================================
// Type for workspace settings (matches IPC interface)
// ============================================

interface WorkspaceSettings {
  name?: string
  model?: string
  permissionMode?: PermissionMode
  workingDirectory?: string
  credentialStrategy?: CredentialStrategy
  localMcpEnabled?: boolean
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

  // Get model, onModelChange, and active workspace from context
  const chatContext = useChatContext()
  const model = propModel ?? chatContext.currentModel ?? 'claude-sonnet-4-5-20250929'
  const onModelChange = propOnModelChange ?? chatContext.onModelChange
  const activeWorkspaceId = chatContext.activeWorkspaceId
  const onRefreshWorkspaces = chatContext.onRefreshWorkspaces

  // Billing state
  const [authType, setAuthType] = useState<AuthType>(propAuthType ?? 'craft_credits')
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

  // Workspace settings state
  const [wsName, setWsName] = useState('')
  const [wsNameEditing, setWsNameEditing] = useState('')
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [wsIconUrl, setWsIconUrl] = useState<string | null>(null)
  const [isUploadingIcon, setIsUploadingIcon] = useState(false)
  const [wsModel, setWsModel] = useState('claude-sonnet-4-5-20250929')
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('ask')
  const [workingDirectory, setWorkingDirectory] = useState('')
  const [credentialStrategy, setCredentialStrategy] = useState<CredentialStrategy>('local')
  const [localMcpEnabled, setLocalMcpEnabled] = useState(true)
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(true)

  // Password dialog state
  const [showPasswordDialog, setShowPasswordDialog] = useState<'set' | 'unlock' | null>(null)
  const [passwordError, setPasswordError] = useState<string | undefined>()
  const [isSubmittingPassword, setIsSubmittingPassword] = useState(false)

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

  // Load workspace settings when active workspace changes
  useEffect(() => {
    const loadWorkspaceSettings = async () => {
      if (!window.electronAPI || !activeWorkspaceId) {
        setIsLoadingWorkspace(false)
        return
      }

      setIsLoadingWorkspace(true)
      try {
        const settings = await window.electronAPI.getWorkspaceSettings(activeWorkspaceId)
        if (settings) {
          setWsName(settings.name || '')
          setWsNameEditing(settings.name || '')
          setWsModel(settings.model || 'claude-sonnet-4-5-20250929')
          setPermissionMode(settings.permissionMode || 'ask')
          setWorkingDirectory(settings.workingDirectory || '')
          setCredentialStrategy(settings.credentialStrategy || 'local')
          setLocalMcpEnabled(settings.localMcpEnabled ?? true)
        }

        // Try to load workspace icon (check common extensions)
        const ICON_EXTENSIONS = ['png', 'jpg', 'jpeg', 'svg', 'webp', 'gif']
        let iconFound = false
        for (const ext of ICON_EXTENSIONS) {
          try {
            const iconData = await window.electronAPI.readWorkspaceImage(activeWorkspaceId, `./icon.${ext}`)
            // For SVG, wrap in data URL
            if (ext === 'svg' && !iconData.startsWith('data:')) {
              setWsIconUrl(`data:image/svg+xml;base64,${btoa(iconData)}`)
            } else {
              setWsIconUrl(iconData)
            }
            iconFound = true
            break
          } catch {
            // Icon not found with this extension, try next
          }
        }
        if (!iconFound) {
          setWsIconUrl(null)
        }
      } catch (error) {
        console.error('Failed to load workspace settings:', error)
      } finally {
        setIsLoadingWorkspace(false)
      }
    }

    loadWorkspaceSettings()
  }, [activeWorkspaceId])

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
        onAuthTypeChange?.(method)
      } catch (error) {
        console.error('Failed to update billing method:', error)
      }
    } else {
      setExpandedMethod(method)
      setApiKeyError(undefined)
      setClaudeOAuthStatus('idle')
      setClaudeOAuthError(undefined)
    }
  }, [authType, hasCredential, onAuthTypeChange])

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

  // Save workspace setting
  const updateWorkspaceSetting = useCallback(
    async <K extends keyof WorkspaceSettings>(key: K, value: WorkspaceSettings[K]) => {
      if (!window.electronAPI || !activeWorkspaceId) return

      try {
        await window.electronAPI.updateWorkspaceSetting(activeWorkspaceId, key, value)
      } catch (error) {
        console.error(`Failed to save ${key}:`, error)
      }
    },
    [activeWorkspaceId]
  )

  // Workspace name handler
  const handleNameSave = useCallback(async () => {
    if (!activeWorkspaceId || wsNameEditing.trim() === wsName) return
    const newName = wsNameEditing.trim()
    if (!newName) {
      setWsNameEditing(wsName)
      return
    }
    setWsName(newName)
    await updateWorkspaceSetting('name', newName)
  }, [activeWorkspaceId, wsName, wsNameEditing, updateWorkspaceSetting])

  // Workspace icon upload handler
  const handleIconUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !activeWorkspaceId || !window.electronAPI) return

    // Validate file type
    const validTypes = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp', 'image/gif']
    if (!validTypes.includes(file.type)) {
      console.error('Invalid file type:', file.type)
      return
    }

    setIsUploadingIcon(true)
    try {
      // Read file as base64
      const buffer = await file.arrayBuffer()
      const base64 = btoa(
        new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
      )

      // Determine extension from mime type
      const extMap: Record<string, string> = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/svg+xml': 'svg',
        'image/webp': 'webp',
        'image/gif': 'gif',
      }
      const ext = extMap[file.type] || 'png'

      // Upload to workspace
      await window.electronAPI.writeWorkspaceImage(activeWorkspaceId, `./icon.${ext}`, base64, file.type)

      // Reload the icon locally for settings display
      const iconData = await window.electronAPI.readWorkspaceImage(activeWorkspaceId, `./icon.${ext}`)
      if (ext === 'svg' && !iconData.startsWith('data:')) {
        setWsIconUrl(`data:image/svg+xml;base64,${btoa(iconData)}`)
      } else {
        setWsIconUrl(iconData)
      }

      // Refresh workspaces to update sidebar icon
      onRefreshWorkspaces?.()
    } catch (error) {
      console.error('Failed to upload icon:', error)
    } finally {
      setIsUploadingIcon(false)
      // Reset the input so the same file can be selected again
      e.target.value = ''
    }
  }, [activeWorkspaceId, onRefreshWorkspaces])

  // Workspace settings handlers
  const handleModelChange = useCallback(
    async (newModel: string) => {
      setWsModel(newModel)
      await updateWorkspaceSetting('model', newModel)
      // Also update the global model context so it takes effect immediately
      onModelChange?.(newModel)
    },
    [updateWorkspaceSetting, onModelChange]
  )

  const handlePermissionModeChange = useCallback(
    async (newMode: PermissionMode) => {
      setPermissionMode(newMode)
      await updateWorkspaceSetting('permissionMode', newMode)
    },
    [updateWorkspaceSetting]
  )

  const handleChangeWorkingDirectory = useCallback(async () => {
    if (!window.electronAPI) return

    try {
      const selectedPath = await window.electronAPI.openFolderDialog()
      if (selectedPath) {
        setWorkingDirectory(selectedPath)
        await updateWorkspaceSetting('workingDirectory', selectedPath)
      }
    } catch (error) {
      console.error('Failed to change working directory:', error)
    }
  }, [updateWorkspaceSetting])

  const handleLocalMcpEnabledChange = useCallback(
    async (enabled: boolean) => {
      setLocalMcpEnabled(enabled)
      await updateWorkspaceSetting('localMcpEnabled', enabled)
    },
    [updateWorkspaceSetting]
  )

  const handleCredentialStrategyChange = useCallback(
    async (newStrategy: CredentialStrategy) => {
      if (newStrategy === credentialStrategy) return

      if (newStrategy === 'portable') {
        setShowPasswordDialog('set')
        setPasswordError(undefined)
      } else {
        setShowPasswordDialog('unlock')
        setPasswordError(undefined)
      }
    },
    [credentialStrategy]
  )

  const handlePasswordSubmit = useCallback(
    async (password: string) => {
      if (!window.electronAPI || !activeWorkspaceId) return

      setIsSubmittingPassword(true)
      setPasswordError(undefined)

      try {
        if (showPasswordDialog === 'set') {
          await window.electronAPI.enablePortableCredentials(activeWorkspaceId, password)
          setCredentialStrategy('portable')
        } else {
          await window.electronAPI.disablePortableCredentials(activeWorkspaceId, password)
          setCredentialStrategy('local')
        }
        setShowPasswordDialog(null)
      } catch (error) {
        setPasswordError(error instanceof Error ? error.message : 'Failed to update credentials')
      } finally {
        setIsSubmittingPassword(false)
      }
    },
    [activeWorkspaceId, showPasswordDialog]
  )

  const handlePasswordCancel = useCallback(() => {
    setShowPasswordDialog(null)
    setPasswordError(undefined)
  }, [])

  return (
    <ScrollArea className="h-full">
      <div className="px-5 py-4">
        <div className="space-y-6">
          {/* ========== APP SETTINGS ========== */}
          <GroupHeader>App</GroupHeader>

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

          {/* Billing - vertical radio list with inline credential entry */}
          <div>
            <SectionHeader>Billing</SectionHeader>
            <div>
              <CraftCreditsOption
                selected={authType === 'craft_credits'}
                onClick={() => handleMethodClick('craft_credits')}
              />

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
                  description={authType === 'api_key' && hasCredential ? '· configured' : '· your Anthropic key'}
                />
              )}

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
                  description={authType === 'oauth_token' && hasCredential ? '· connected' : '· subscription'}
                />
              )}
            </div>
          </div>

          {/* ========== WORKSPACE SETTINGS ========== */}

          {activeWorkspaceId && !isLoadingWorkspace && (
            <>
              <GroupHeader>Workspace</GroupHeader>

              {/* Name & Icon */}
              <div>
                {/* Name */}
                <div className="flex items-center py-1.5">
                <span className="text-sm">Name</span>
                <span className="text-sm text-muted-foreground ml-1.5">
                  · {wsName || 'Untitled'} ·
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setWsNameEditing(wsName)
                    setRenameDialogOpen(true)
                  }}
                  className="text-sm text-muted-foreground ml-1.5 hover:text-foreground transition-colors underline"
                >
                  Edit
                </button>
              </div>
              {/* Icon */}
              <div className="flex items-center py-1.5">
                <span className="text-sm">Icon</span>
                <span className="text-sm text-muted-foreground ml-1.5">·</span>
                <div className={cn(
                  "w-3.5 h-3.5 rounded-full overflow-hidden bg-foreground/5 flex items-center justify-center ml-1.5",
                  "ring-1 ring-border/50"
                )}>
                  {isUploadingIcon ? (
                    <Spinner className="text-muted-foreground text-[6px]" />
                  ) : wsIconUrl ? (
                    <img src={wsIconUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-[8px] font-medium text-muted-foreground">
                      {wsName?.charAt(0)?.toUpperCase() || 'W'}
                    </span>
                  )}
                </div>
                <span className="text-sm text-muted-foreground ml-1.5">·</span>
                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
                    onChange={handleIconUpload}
                    className="sr-only"
                    disabled={isUploadingIcon}
                  />
                  <span className="text-sm text-muted-foreground ml-1.5 hover:text-foreground transition-colors underline">
                    {isUploadingIcon ? 'Uploading...' : 'Edit'}
                  </span>
                </label>
              </div>

              {/* Rename Dialog */}
              <RenameDialog
                open={renameDialogOpen}
                onOpenChange={setRenameDialogOpen}
                title="Rename workspace"
                value={wsNameEditing}
                onValueChange={setWsNameEditing}
                onSubmit={() => {
                  const newName = wsNameEditing.trim()
                  if (newName && newName !== wsName) {
                    setWsName(newName)
                    updateWorkspaceSetting('name', newName)
                    // Refresh workspaces list so UI updates everywhere
                    onRefreshWorkspaces?.()
                  }
                  setRenameDialogOpen(false)
                }}
                placeholder="Enter workspace name..."
              />
              </div>

              {/* Model */}
              <div>
                <SectionHeader>Model</SectionHeader>
                <div>
                  <RadioOption
                    selected={wsModel === 'claude-opus-4-5-20251101'}
                    onClick={() => handleModelChange('claude-opus-4-5-20251101')}
                    label="Opus 4.5"
                    description="· most capable"
                  />
                  <RadioOption
                    selected={wsModel === 'claude-sonnet-4-5-20250929'}
                    onClick={() => handleModelChange('claude-sonnet-4-5-20250929')}
                    label="Sonnet 4.5"
                    description="· balanced"
                  />
                  <RadioOption
                    selected={wsModel === 'claude-haiku-4-5-20251001'}
                    onClick={() => handleModelChange('claude-haiku-4-5-20251001')}
                    label="Haiku 4.5"
                    description="· fast"
                  />
                </div>
              </div>

              {/* Default Permission Mode */}
              <div>
                <SectionHeader>Default Permission Mode</SectionHeader>
                <div>
                  <RadioOption
                    selected={permissionMode === 'safe'}
                    onClick={() => handlePermissionModeChange('safe')}
                    label="Safe Mode"
                    description="· read-only, blocks all write operations"
                  />
                  <RadioOption
                    selected={permissionMode === 'ask'}
                    onClick={() => handlePermissionModeChange('ask')}
                    label="Ask"
                    description="· prompt before tool execution (default)"
                  />
                  <RadioOption
                    selected={permissionMode === 'allow-all'}
                    onClick={() => handlePermissionModeChange('allow-all')}
                    label="Allow All"
                    description="· auto-approve all tool use"
                  />
                </div>
              </div>

              {/* Default Working Directory */}
              <div>
                <SectionHeader>Default Working Directory</SectionHeader>
                <div className="flex items-center justify-between py-1.5">
                  <div className="flex-1 min-w-0">
                    <span className="text-sm truncate">
                      {workingDirectory ? workingDirectory.split('/').pop() : 'Home'}
                    </span>
                    <span className="text-sm text-muted-foreground ml-1.5 truncate">
                      · {workingDirectory || '~'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleChangeWorkingDirectory}
                    className="text-xs text-muted-foreground ml-4 shrink-0 hover:text-foreground transition-colors"
                  >
                    Change...
                  </button>
                </div>
              </div>

              {/* Credential Storage */}
              <div>
                <SectionHeader>Credential Storage</SectionHeader>

                {showPasswordDialog ? (
                  <PasswordDialog
                    mode={showPasswordDialog}
                    onSubmit={handlePasswordSubmit}
                    onCancel={handlePasswordCancel}
                    isLoading={isSubmittingPassword}
                    error={passwordError}
                  />
                ) : (
                  <div>
                    <RadioOption
                      selected={credentialStrategy === 'local'}
                      onClick={() => handleCredentialStrategyChange('local')}
                      label="Local"
                      description="· secure on this device"
                    />
                    <RadioOption
                      selected={credentialStrategy === 'portable'}
                      onClick={() => handleCredentialStrategyChange('portable')}
                      label="Portable"
                      description="· sync with workspace files"
                    />
                  </div>
                )}
              </div>

              {/* Advanced */}
              <div>
                <SectionHeader>Advanced</SectionHeader>
                <ToggleRow
                  label="Local MCP Servers"
                  description="· spawn subprocess servers"
                  checked={localMcpEnabled}
                  onCheckedChange={handleLocalMcpEnabledChange}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </ScrollArea>
  )
}
