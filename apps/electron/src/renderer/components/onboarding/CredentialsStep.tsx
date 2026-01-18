import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { Eye, EyeOff, ExternalLink, CheckCircle2, XCircle } from "lucide-react"
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
}: CredentialsStepProps) {
  const [value, setValue] = useState('')
  const [showValue, setShowValue] = useState(false)

  const isApiKey = billingMethod === 'api_key'
  const isOAuth = billingMethod === 'claude_oauth'

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (value.trim()) {
      onSubmit(value.trim())
    }
  }

  // OAuth flow
  if (isOAuth) {
    const content = OAUTH_STATUS_CONTENT[status]

    // Check if we have options to show
    const hasExistingToken = !!existingClaudeToken
    const hasCliOption = isClaudeCliInstalled
    const hasNoOptions = !hasExistingToken && !hasCliOption

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
            ) : hasCliOption ? (
              <ContinueButton onClick={onStartOAuth} className="gap-2">
                <ExternalLink className="size-4" />
                Sign in with Claude
              </ContinueButton>
            ) : null}
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

    // Dynamic description based on available options
    let description = content.description
    if (status === 'idle') {
      if (hasExistingToken && existingClaudeToken) {
        // Show preview of detected token (first 20 chars)
        const tokenPreview = existingClaudeToken.length > 20
          ? `${existingClaudeToken.slice(0, 20)}...`
          : existingClaudeToken
        description = `Found existing token: ${tokenPreview}`
      } else if (hasCliOption) {
        description = 'This will open Claude CLI to authenticate with your Claude subscription.'
      } else if (hasNoOptions) {
        description = 'Claude Code is not installed. Install it with: curl -fsSL https://claude.ai/install.sh | bash'
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
        {/* Show secondary option if both are available */}
        {status === 'idle' && hasExistingToken && hasCliOption && (
          <div className="text-center">
            <button
              onClick={onStartOAuth}
              className="text-sm text-muted-foreground hover:text-foreground underline"
            >
              Or run claude setup-token to get a new token
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
      </form>
    </StepFormLayout>
  )
}
