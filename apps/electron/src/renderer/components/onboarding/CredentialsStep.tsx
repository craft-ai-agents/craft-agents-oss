import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { Eye, EyeOff, ExternalLink, CheckCircle2, XCircle } from "lucide-react"
import { Spinner } from "@craft-agent/ui"
import type { BillingMethod } from "./BillingMethodStep"
import { StepFormLayout, BackButton, ContinueButton, type StepIconVariant } from "./primitives"
import { useTranslation } from "@/i18n"
import { SettingsSecretInput } from "@/components/settings"

export type CredentialStatus = 'idle' | 'validating' | 'success' | 'error'

interface CredentialsStepProps {
  billingMethod: BillingMethod
  status: CredentialStatus
  errorMessage?: string
  onSubmit: (credential: string) => void
  onStartOAuth?: () => void
  onBack: () => void
  // Custom billing
  onSubmitCustom?: (settings: {
    baseUrl: string
    apiTimeoutMs: string
    model: string
    authToken: string
  }) => void
  // Claude OAuth specific
  existingClaudeToken?: string | null
  isClaudeCliInstalled?: boolean
  onUseExistingClaudeToken?: () => void
  // Two-step OAuth flow
  isWaitingForCode?: boolean
  onSubmitAuthCode?: (code: string) => void
  onCancelOAuth?: () => void
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

/**
 * CredentialsStep - Enter API key, start OAuth, or set custom endpoint
 *
 * For API Key: Shows input field with validation
 * For Claude OAuth: Shows button to start OAuth flow
 * For Custom: Shows base URL, timeout, model, and auth token inputs
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
}: CredentialsStepProps) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const [showValue, setShowValue] = useState(false)
  const [authCode, setAuthCode] = useState('')
  const [customBaseUrl, setCustomBaseUrl] = useState('')
  const [customTimeout, setCustomTimeout] = useState('')
  const [customModel, setCustomModel] = useState('')
  const [customAuthToken, setCustomAuthToken] = useState('')

  const isApiKey = billingMethod === 'api_key'
  const isOAuth = billingMethod === 'claude_oauth'
  const isCustom = billingMethod === 'custom'

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

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!onSubmitCustom) return
    onSubmitCustom({
      baseUrl: customBaseUrl.trim(),
      apiTimeoutMs: customTimeout.trim(),
      model: customModel.trim(),
      authToken: customAuthToken.trim(),
    })
  }

  // OAuth flow
  if (isOAuth) {
    const OAUTH_STATUS_CONTENT: Record<CredentialStatus, { title: string; description: string }> = {
      idle: {
        title: t('billingSetup' as any),
        description: t('billingSetupDescription' as any),
      },
      validating: {
        title: t('loading' as any) + '...',
        description: t('loadingCraftAgents' as any),
      },
      success: {
        title: t('credentialsStepSuccess' as any),
        description: t('credentialsStepSuccess' as any),
      },
      error: {
        title: t('credentialsStepError' as any).split(' ')[0] + ' failed',
        description: '',
      },
    }

    const content = OAUTH_STATUS_CONTENT[status]

    // Check if we have existing token from keychain
    const hasExistingToken = !!existingClaudeToken

    // Waiting for authorization code entry
    if (isWaitingForCode) {
      return (
        <StepFormLayout
          title={t('apiKey' as any)}
          description={t('apiKeyDescription' as any)}
          actions={
            <>
              <BackButton onClick={onCancelOAuth} disabled={status === 'validating'}>{t('cancel' as any)}</BackButton>
              <ContinueButton
                type="submit"
                form="auth-code-form"
                disabled={!authCode.trim()}
                loading={status === 'validating'}
                loadingText={t('loading' as any) + '...'}
              />
            </>
          }
        >
          <form id="auth-code-form" onSubmit={handleAuthCodeSubmit}>
            <div className="space-y-2">
              <Label htmlFor="auth-code">{t('apiKey' as any)}</Label>
              <div className={cn(
                "relative rounded-md shadow-minimal transition-colors",
                "bg-foreground-2 focus-within:bg-background"
              )}>
                <Input
                  id="auth-code"
                  type="text"
                  value={authCode}
                  onChange={(e) => setAuthCode(e.target.value)}
                  placeholder={t('apiKeyPlaceholder' as any)}
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
                {t('allow' as any)} {t('apiKey' as any)}
              </ContinueButton>
            ) : (
              <ContinueButton onClick={onStartOAuth} className="gap-2">
                <ExternalLink className="size-4" />
                {t('authenticate' as any)}
              </ContinueButton>
            )}
          </>
        )}

        {status === 'validating' && (
          <BackButton onClick={onBack} className="w-full">{t('cancel' as any)}</BackButton>
        )}

        {status === 'error' && (
          <>
            <BackButton onClick={onBack} />
            <ContinueButton onClick={hasExistingToken ? onUseExistingClaudeToken : onStartOAuth}>
              {t('continue' as any)}
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
        description = t('selectHowToPowerAgents' as any)
      }
    }

    return (
      <StepFormLayout
        icon={getOAuthIcon(status)}
        iconVariant={getOAuthIconVariant(status)}
        title={content.title}
        description={status === 'error' ? (errorMessage || t('credentialsStepError' as any)) : description}
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

  if (isCustom) {
    return (
      <StepFormLayout
        title={t('customAnthropicCompatible' as any)}
        description={t('customAnthropicCompatibleDescription' as any)}
        actions={
          <>
            <BackButton onClick={onBack} disabled={status === 'validating'} />
            <ContinueButton
              type="submit"
              form="custom-billing-form"
              disabled={!customAuthToken.trim()}
              loading={status === 'validating'}
              loadingText={t('loading' as any) + '...'}
            />
          </>
        }
      >
        <form id="custom-billing-form" onSubmit={handleCustomSubmit}>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="custom-base-url">{t('baseUrl' as any)}</Label>
              <Input
                id="custom-base-url"
                type="text"
                value={customBaseUrl}
                onChange={(e) => setCustomBaseUrl(e.target.value)}
                placeholder="https://open.bigmodel.cn/api/anthropic"
                className="border-0 bg-foreground-2 shadow-minimal focus-visible:ring-2 focus-visible:ring-ring"
                disabled={status === 'validating'}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="custom-timeout">{t('apiTimeoutMs' as any)}</Label>
              <Input
                id="custom-timeout"
                type="number"
                min={1}
                value={customTimeout}
                onChange={(e) => setCustomTimeout(e.target.value)}
                placeholder="3000000"
                className="border-0 bg-foreground-2 shadow-minimal focus-visible:ring-2 focus-visible:ring-ring"
                disabled={status === 'validating'}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="custom-model">{t('modelOverride' as any)}</Label>
              <Input
                id="custom-model"
                type="text"
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder="glm-4.7"
                className="border-0 bg-foreground-2 shadow-minimal focus-visible:ring-2 focus-visible:ring-ring"
                disabled={status === 'validating'}
              />
            </div>

            <SettingsSecretInput
              label={t('authToken' as any)}
              value={customAuthToken}
              onChange={setCustomAuthToken}
              placeholder="ANTHROPIC_AUTH_TOKEN"
              disabled={status === 'validating'}
              className="pt-1"
            />

            {status === 'error' && errorMessage && (
              <p className="text-sm text-destructive">{errorMessage}</p>
            )}
          </div>
        </form>
      </StepFormLayout>
    )
  }

  // API Key flow
  return (
    <StepFormLayout
      title={t('apiKey' as any)}
      description={
        <>
          {t('learnMoreAboutApiKeys' as any)}{' '}
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
            loadingText={t('loading' as any) + '...'}
          />
        </>
      }
    >
      <form id="api-key-form" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="api-key">{t('apiKey' as any)}</Label>
          <div className={cn(
            "relative rounded-md shadow-minimal transition-colors",
            "bg-foreground-2 focus-within:bg-background"
          )}>
            <Input
              id="api-key"
              type={showValue ? 'text' : 'password'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={t('apiKeyPlaceholder' as any)}
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
