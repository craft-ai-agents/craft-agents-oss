import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import { Eye, EyeOff, ExternalLink, CheckCircle2, XCircle, ChevronDown } from "lucide-react"
import { Spinner } from "@craft-agent/ui"
import type { BillingMethod } from "./BillingMethodStep"
import { StepFormLayout, BackButton, ContinueButton, type StepIconVariant } from "./primitives"

export type CredentialStatus = 'idle' | 'validating' | 'success' | 'error'

interface CredentialsStepProps {
  billingMethod: BillingMethod
  status: CredentialStatus
  errorMessage?: string
  onSubmit: (credential: string) => void
  onStartOAuth?: () => void
  onBack: () => void
  // Claude OAuth specific
  existingClaudeToken?: string | null
  isClaudeCliInstalled?: boolean
  onUseExistingClaudeToken?: () => void
  // Two-step OAuth flow
  isWaitingForCode?: boolean
  onSubmitAuthCode?: (code: string) => void
  onCancelOAuth?: () => void
  // Advanced API options
  baseUrl?: string
  onBaseUrlChange?: (value: string) => void
  customModelNames?: { opus: string; sonnet: string; haiku: string }
  onCustomModelNamesChange?: (names: { opus: string; sonnet: string; haiku: string }) => void
}

function getOAuthIcon(status: CredentialStatus): React.ReactNode {
  switch (status) {
    case 'idle': return undefined
    case 'validating': return <Spinner className="text-2xl" />
    case 'success': return <CheckCircle2 />
    case 'error': return <XCircle />
  }
}

function getOAuthIconVariant(status: CredentialStatus): StepIconVariant {
  switch (status) {
    case 'idle': return 'primary'
    case 'validating': return 'loading'
    case 'success': return 'success'
    case 'error': return 'error'
  }
}

const OAUTH_STATUS_CONTENT: Record<CredentialStatus, { title: string; description: string }> = {
  idle: {
    title: 'Connect Claude Account',
    description: 'Use your Claude subscription to power multi-agent workflows.',
  },
  validating: {
    title: 'Connecting...',
    description: 'Waiting for authentication to complete...',
  },
  success: {
    title: 'Connected!',
    description: 'Your Claude account is connected.',
  },
  error: {
    title: 'Connection failed',
    description: '', // Will use errorMessage prop
  },
}

/**
 * CredentialsStep - Enter API key or start OAuth flow
 *
 * For API Key: Shows input field with validation
 * For Claude OAuth: Shows button to start OAuth flow
 */
export function CredentialsStep({
  billingMethod,
  status,
  errorMessage,
  onSubmit,
  onStartOAuth,
  onBack,
  existingClaudeToken,
  isClaudeCliInstalled,
  onUseExistingClaudeToken,
  // Two-step OAuth flow
  isWaitingForCode,
  onSubmitAuthCode,
  onCancelOAuth,
  // Advanced API options
  baseUrl = '',
  onBaseUrlChange,
  customModelNames = { opus: '', sonnet: '', haiku: '' },
  onCustomModelNamesChange,
}: CredentialsStepProps) {
  const [value, setValue] = useState('')
  const [showValue, setShowValue] = useState(false)
  // Test connection state
  const [isTestingConnection, setIsTestingConnection] = useState(false)
  const [testConnectionResult, setTestConnectionResult] = useState<{ success: boolean; error?: string; modelCount?: number } | null>(null)
  const [authCode, setAuthCode] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)

  const isApiKey = billingMethod === 'api_key'
  const isOAuth = billingMethod === 'claude_oauth'

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (value.trim()) {
      onSubmit(value.trim())
    }
  }

  // Handle auth code submission
  const handleAuthCodeSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (authCode.trim() && onSubmitAuthCode) {
      onSubmitAuthCode(authCode.trim())
    }
  }

  // OAuth flow
  if (isOAuth) {
    const content = OAUTH_STATUS_CONTENT[status]

    // Check if we have existing token from keychain
    const hasExistingToken = !!existingClaudeToken

    // Waiting for authorization code entry
    if (isWaitingForCode) {
      return (
        <StepFormLayout
          title="Enter Authorization Code"
          description="Copy the code from the browser page and paste it below."
          actions={
            <>
              <BackButton onClick={onCancelOAuth} disabled={status === 'validating'}>Cancel</BackButton>
              <ContinueButton
                type="submit"
                form="auth-code-form"
                disabled={!authCode.trim()}
                loading={status === 'validating'}
                loadingText="Connecting..."
              />
            </>
          }
        >
          <form id="auth-code-form" onSubmit={handleAuthCodeSubmit}>
            <div className="space-y-2">
              <Label htmlFor="auth-code">Authorization Code</Label>
              <div className={cn(
                "relative rounded-md shadow-minimal transition-colors",
                "bg-foreground-2 focus-within:bg-background"
              )}>
                <Input
                  id="auth-code"
                  type="text"
                  value={authCode}
                  onChange={(e) => setAuthCode(e.target.value)}
                  placeholder="Paste your authorization code here"
                  className={cn(
                    "border-0 bg-transparent shadow-none font-mono text-sm",
                    status === 'error' && "focus-visible:ring-destructive"
                  )}
                  disabled={status === 'validating'}
                  autoFocus
                />
              </div>
              {status === 'error' && errorMessage && (
                <p className="text-sm text-destructive">{errorMessage}</p>
              )}
            </div>
          </form>
        </StepFormLayout>
      )
    }

    const actions = (
      <>
        {status === 'idle' && (
          <>
            <BackButton onClick={onBack} />
            {hasExistingToken ? (
              <ContinueButton onClick={onUseExistingClaudeToken} className="gap-2">
                <CheckCircle2 className="size-4" />
                Use Existing Token
              </ContinueButton>
            ) : (
              <ContinueButton onClick={onStartOAuth} className="gap-2">
                <ExternalLink className="size-4" />
                Sign in with Claude
              </ContinueButton>
            )}
          </>
        )}

        {status === 'validating' && (
          <BackButton onClick={onBack} className="w-full">Cancel</BackButton>
        )}

        {status === 'error' && (
          <>
            <BackButton onClick={onBack} />
            <ContinueButton onClick={hasExistingToken ? onUseExistingClaudeToken : onStartOAuth}>
              Try Again
            </ContinueButton>
          </>
        )}
      </>
    )

    // Dynamic description based on state
    let description = content.description
    if (status === 'idle') {
      if (hasExistingToken && existingClaudeToken) {
        // Show preview of detected token (first 20 chars)
        const tokenPreview = existingClaudeToken.length > 20
          ? `${existingClaudeToken.slice(0, 20)}...`
          : existingClaudeToken
        description = `Found existing token: ${tokenPreview}`
      } else {
        description = 'Click below to sign in with your Claude Pro or Max subscription.'
      }
    }

    return (
      <StepFormLayout
        icon={getOAuthIcon(status)}
        iconVariant={getOAuthIconVariant(status)}
        title={content.title}
        description={status === 'error' ? (errorMessage || 'Something went wrong. Please try again.') : description}
        actions={actions}
      >
        {/* Show secondary option if we have an existing token */}
        {status === 'idle' && hasExistingToken && (
          <div className="text-center">
            <button
              onClick={onStartOAuth}
              className="text-sm text-muted-foreground hover:text-foreground underline"
            >
              Or sign in with a different account
            </button>
          </div>
        )}
      </StepFormLayout>
    )
  }

  // API Key flow
  return (
    <StepFormLayout
      title="Enter API Key"
      description={
        <>
          Get your API key from{' '}
          <a
            href="https://console.anthropic.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground hover:underline"
          >
            console.anthropic.com
          </a>
        </>
      }
      actions={
        <>
          <BackButton onClick={onBack} disabled={status === 'validating'} />
          <ContinueButton
            type="submit"
            form="api-key-form"
            disabled={!value.trim()}
            loading={status === 'validating'}
            loadingText="Validating..."
          />
        </>
      }
    >
      <form id="api-key-form" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="api-key">Anthropic API Key</Label>
          <div className={cn(
            "relative rounded-md shadow-minimal transition-colors",
            "bg-foreground-2 focus-within:bg-background"
          )}>
            <Input
              id="api-key"
              type={showValue ? 'text' : 'password'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="sk-ant-..."
              className={cn(
                "pr-10 border-0 bg-transparent shadow-none",
                status === 'error' && "focus-visible:ring-destructive"
              )}
              disabled={status === 'validating'}
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowValue(!showValue)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              tabIndex={-1}
            >
              {showValue ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </button>
          </div>
          {status === 'error' && errorMessage && (
            <p className="text-sm text-destructive">{errorMessage}</p>
          )}
        </div>

        {/* Advanced Options */}
        <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced} className="mt-4">
          <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ChevronDown className={cn("size-4 transition-transform", showAdvanced && "rotate-180")} />
            Advanced Options
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 space-y-4">
            {/* Base URL */}
            <div className="space-y-2">
              <Label htmlFor="base-url" className="text-xs text-muted-foreground">
                Anthropic Base URL <span className="font-normal">(optional)</span>
              </Label>
              <Input
                id="base-url"
                type="text"
                value={baseUrl}
                onChange={(e) => onBaseUrlChange?.(e.target.value)}
                placeholder="https://api.anthropic.com"
                disabled={status === 'validating'}
                className="text-sm"
              />
              <p className="text-xs text-muted-foreground">
                For third-party Claude-compatible APIs. Leave empty for official API.
              </p>
            </div>

            {/* Custom Model Names */}
            <div className="space-y-3 pt-2 border-t border-border">
              <div>
                <Label className="text-xs text-muted-foreground">
                  Custom Model Names <span className="font-normal">(optional)</span>
                </Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Override model IDs for third-party APIs.
                </p>
              </div>

              {/* Opus */}
              <div className="space-y-1.5">
                <Label htmlFor="model-opus" className="text-xs text-muted-foreground">
                  Opus (Most capable)
                </Label>
                <Input
                  id="model-opus"
                  type="text"
                  value={customModelNames.opus}
                  onChange={(e) => onCustomModelNamesChange?.({ ...customModelNames, opus: e.target.value })}
                  placeholder="claude-opus-4-5-20251101"
                  disabled={status === 'validating'}
                  className="font-mono text-sm"
                />
              </div>

              {/* Sonnet */}
              <div className="space-y-1.5">
                <Label htmlFor="model-sonnet" className="text-xs text-muted-foreground">
                  Sonnet (Balanced)
                </Label>
                <Input
                  id="model-sonnet"
                  type="text"
                  value={customModelNames.sonnet}
                  onChange={(e) => onCustomModelNamesChange?.({ ...customModelNames, sonnet: e.target.value })}
                  placeholder="claude-sonnet-4-5-20250929"
                  disabled={status === 'validating'}
                  className="font-mono text-sm"
                />
              </div>

              {/* Haiku */}
              <div className="space-y-1.5">
                <Label htmlFor="model-haiku" className="text-xs text-muted-foreground">
                  Haiku (Fast &amp; efficient)
                </Label>
                <Input
                  id="model-haiku"
                  type="text"
                  value={customModelNames.haiku}
                  onChange={(e) => onCustomModelNamesChange?.({ ...customModelNames, haiku: e.target.value })}
                  placeholder="claude-haiku-4-5-20251001"
                  disabled={status === 'validating'}
                  className="font-mono text-sm"
                />
              </div>
            </div>

            {/* Test Connection Button */}
            <div className="pt-2 border-t border-border">
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    setIsTestingConnection(true)
                    setTestConnectionResult(null)
                    try {
                      // Use the first available custom model name for testing
                      const testModel = customModelNames.sonnet || customModelNames.opus || customModelNames.haiku || undefined
                      const result = await window.electronAPI.testApiConnection(
                        value,
                        baseUrl || undefined,
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
                  disabled={!value.trim() || isTestingConnection}
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
          </CollapsibleContent>
        </Collapsible>
      </form>
    </StepFormLayout>
  )
}
