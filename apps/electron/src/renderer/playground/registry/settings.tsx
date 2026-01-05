import * as React from 'react'
import type { ComponentEntry } from './types'
import SettingsTabPanel from '@/tabs/panels/SettingsTabPanel'
import type { SettingsTab } from '@/tabs/types'
import type { AuthType } from '../../../shared/types'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/loading-indicator'
import { Check, Eye, EyeOff, ExternalLink, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'

// Mock settings tab for playground
const mockSettingsTab: SettingsTab = {
  id: 'settings',
  type: 'settings',
  label: 'Settings',
  closable: true,
}

// Wrapper component that manages state for the settings panel
function SettingsTabPanelWithState(props: {
  authType?: AuthType
  model?: string
}) {
  const [model, setModel] = React.useState(props.model ?? 'claude-sonnet-4-5-20250929')

  // Update internal state when props change (from variants)
  React.useEffect(() => {
    if (props.model !== undefined) setModel(props.model)
  }, [props.model])

  return (
    <SettingsTabPanel
      tab={mockSettingsTab}
      authType={props.authType}
      model={model}
      onModelChange={setModel}
    />
  )
}

// ============================================
// Standalone API Key Input for Playground
// ============================================

interface ApiKeyInputPlaygroundProps {
  error?: string
  isValidating?: boolean
  hasExistingKey?: boolean
}

function ApiKeyInputPlayground({ error, isValidating, hasExistingKey }: ApiKeyInputPlaygroundProps) {
  const [value, setValue] = React.useState('')
  const [showValue, setShowValue] = React.useState(false)

  return (
    <div className={cn(
      "py-1.5 px-3 rounded-lg bg-foreground/[0.02] border space-y-3 max-w-md",
      error ? "border-destructive/50" : "border-border/50"
    )}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <span className="text-sm">API Key</span>
          <span className="text-sm text-muted-foreground ml-1.5">— your Anthropic key</span>
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-muted-foreground">
        Pay-as-you-go with your own API key.{' '}
        <a href="#" className="text-foreground hover:underline inline-flex items-center gap-0.5">
          Get one from Anthropic
          <ExternalLink className="size-3" />
        </a>
      </p>

      {/* Input */}
      <div className="relative">
        <Input
          type={showValue ? 'text' : 'password'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={hasExistingKey ? '••••••••••••••••' : 'sk-ant-...'}
          className={cn("pr-10 text-sm bg-background", error && "border-destructive")}
          disabled={isValidating}
        />
        <button
          type="button"
          onClick={() => setShowValue(!showValue)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          {showValue ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>

      {/* Error */}
      {error && <p className="text-xs text-destructive">{error}</p>}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={!value.trim() || isValidating} className="text-xs">
          {isValidating ? (
            <><Spinner className="mr-1.5" />Validating...</>
          ) : (
            <><Check className="size-3 mr-1.5" />{hasExistingKey ? 'Update Key' : 'Save'}</>
          )}
        </Button>
        <Button size="sm" variant="ghost" disabled={isValidating} className="text-xs bg-foreground/5 hover:bg-foreground/10">
          Cancel
        </Button>
      </div>
    </div>
  )
}

// ============================================
// Standalone Claude OAuth for Playground
// ============================================

interface ClaudeOAuthPlaygroundProps {
  hasExistingToken?: boolean
  isCliInstalled?: boolean
  isLoading?: boolean
  error?: string
  isConnected?: boolean
}

function ClaudeOAuthPlayground({ hasExistingToken, isCliInstalled = true, isLoading, error, isConnected }: ClaudeOAuthPlaygroundProps) {
  const Header = () => (
    <div className="flex items-center justify-between">
      <div className="flex-1 min-w-0">
        <span className="text-sm">Claude Max</span>
        <span className="text-sm text-muted-foreground ml-1.5">— subscription</span>
      </div>
    </div>
  )

  // Connected state
  if (isConnected) {
    return (
      <div className="py-1.5 px-3 rounded-lg bg-foreground/[0.02] border border-border/50 space-y-2 max-w-md">
        <Header />
        <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
          <CheckCircle2 className="size-4" />
          Connected to Claude
        </div>
      </div>
    )
  }

  // CLI not installed
  if (!isCliInstalled && !hasExistingToken) {
    return (
      <div className="py-1.5 px-3 rounded-lg bg-foreground/[0.02] border border-border/50 space-y-3 max-w-md">
        <Header />
        <p className="text-xs text-muted-foreground">
          Use your Claude Pro or Max subscription. Requires Claude Code CLI.{' '}
          <a href="#" className="text-foreground hover:underline inline-flex items-center gap-0.5">
            Install Claude Code
            <ExternalLink className="size-3" />
          </a>
        </p>
        <Button size="sm" variant="ghost" className="text-xs bg-foreground/5 hover:bg-foreground/10">
          Cancel
        </Button>
      </div>
    )
  }

  return (
    <div className={cn(
      "py-1.5 px-3 rounded-lg bg-foreground/[0.02] border space-y-3 max-w-md",
      error ? "border-destructive/50" : "border-border/50"
    )}>
      <Header />
      <p className="text-xs text-muted-foreground">
        Use your Claude Pro or Max subscription for unlimited access.
      </p>
      <div className="flex items-center gap-2">
        {hasExistingToken ? (
          <Button size="sm" disabled={isLoading} className="text-xs">
            {isLoading ? (
              <><Spinner className="mr-1.5" />Connecting...</>
            ) : (
              <><CheckCircle2 className="size-3 mr-1.5" />Use Existing Token</>
            )}
          </Button>
        ) : (
          <Button size="sm" disabled={isLoading} className="text-xs">
            {isLoading ? (
              <><Spinner className="mr-1.5" />Connecting...</>
            ) : (
              <><ExternalLink className="size-3 mr-1.5" />Sign in with Claude</>
            )}
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={isLoading} className="text-xs bg-foreground/5 hover:bg-foreground/10">
          Cancel
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

export const settingsComponents: ComponentEntry[] = [
  {
    id: 'settings-panel',
    name: 'SettingsTabPanel',
    category: 'Settings',
    description: 'Full settings panel with theme, model, tool output, and billing',
    component: SettingsTabPanelWithState,
    layout: 'top',
    props: [
      {
        name: 'authType',
        description: 'Initial billing method (component loads actual value from IPC)',
        control: {
          type: 'select',
          options: [
            { label: 'Craft Credits', value: 'craft_credits' },
            { label: 'API Key', value: 'api_key' },
            { label: 'Claude Max', value: 'oauth_token' },
          ],
        },
        defaultValue: 'craft_credits',
      },
      {
        name: 'model',
        description: 'Selected AI model',
        control: {
          type: 'select',
          options: [
            { label: 'Opus', value: 'claude-opus-4-5-20251101' },
            { label: 'Sonnet', value: 'claude-sonnet-4-5-20250929' },
            { label: 'Haiku', value: 'claude-haiku-4-5-20251001' },
          ],
        },
        defaultValue: 'claude-sonnet-4-5-20250929',
      },
    ],
    variants: [
      { name: 'Default', props: { model: 'claude-sonnet-4-5-20250929' } },
    ],
  },
  {
    id: 'api-key-input',
    name: 'API Key Input',
    category: 'Settings',
    description: 'API key entry box with validation states',
    component: ApiKeyInputPlayground,
    props: [
      {
        name: 'error',
        description: 'Validation error message',
        control: { type: 'string' },
        defaultValue: '',
      },
      {
        name: 'isValidating',
        description: 'Show validating state',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'hasExistingKey',
        description: 'User already has a key configured',
        control: { type: 'boolean' },
        defaultValue: false,
      },
    ],
    variants: [
      { name: 'Default', props: {} },
      { name: 'Validating', props: { isValidating: true } },
      { name: 'Validation Error', props: { error: 'Invalid API key. Please check your key and try again.' } },
      { name: 'Update Existing', props: { hasExistingKey: true } },
    ],
  },
  {
    id: 'claude-oauth',
    name: 'Claude OAuth',
    category: 'Settings',
    description: 'Claude Max OAuth entry with various states',
    component: ClaudeOAuthPlayground,
    props: [
      {
        name: 'hasExistingToken',
        description: 'User has existing token in keychain',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'isCliInstalled',
        description: 'Claude CLI is installed',
        control: { type: 'boolean' },
        defaultValue: true,
      },
      {
        name: 'isLoading',
        description: 'OAuth in progress',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'error',
        description: 'Error message',
        control: { type: 'string' },
        defaultValue: '',
      },
      {
        name: 'isConnected',
        description: 'Successfully connected',
        control: { type: 'boolean' },
        defaultValue: false,
      },
    ],
    variants: [
      { name: 'Default (No Token)', props: { isCliInstalled: true, hasExistingToken: false } },
      { name: 'Has Existing Token', props: { isCliInstalled: true, hasExistingToken: true } },
      { name: 'CLI Not Installed', props: { isCliInstalled: false, hasExistingToken: false } },
      { name: 'Connecting', props: { isLoading: true } },
      { name: 'OAuth Error', props: { error: 'Authentication failed. Please try again.' } },
      { name: 'Connected', props: { isConnected: true } },
    ],
  },
]
