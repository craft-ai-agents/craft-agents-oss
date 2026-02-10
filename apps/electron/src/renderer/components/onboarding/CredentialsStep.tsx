/**
 * CredentialsStep - Onboarding step wrapper for API key or OAuth flow
 *
 * Thin wrapper that composes ApiKeyInput or OAuthConnect controls
 * with StepFormLayout for the onboarding wizard context.
 */

import { ExternalLink } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { ApiSetupMethod } from "./APISetupStep"
import { StepFormLayout, BackButton, ContinueButton } from "./primitives"
import { getCredentialsLabels } from './labels'
import {
  ApiKeyInput,
  type ApiKeyStatus,
  type ApiKeySubmitData,
  OAuthConnect,
  type OAuthStatus,
} from "../apisetup"

export type CredentialStatus = ApiKeyStatus | OAuthStatus

interface CredentialsStepProps {
  apiSetupMethod: ApiSetupMethod
  status: CredentialStatus
  errorMessage?: string
  onSubmit: (data: ApiKeySubmitData) => void
  onStartOAuth?: (methodOverride?: ApiSetupMethod) => void
  onBack: () => void
  // Two-step OAuth flow
  isWaitingForCode?: boolean
  onSubmitAuthCode?: (code: string) => void
  onCancelOAuth?: () => void
  // Device flow (Copilot)
  copilotDeviceCode?: { userCode: string; verificationUri: string }
}

export function CredentialsStep({
  apiSetupMethod,
  status,
  errorMessage,
  onSubmit,
  onStartOAuth,
  onBack,
  isWaitingForCode,
  onSubmitAuthCode,
  onCancelOAuth,
  copilotDeviceCode,
}: CredentialsStepProps) {
  const { t } = useTranslation(['onboarding'])
  const labels = getCredentialsLabels(t)
  const isOAuth = apiSetupMethod === 'claude_oauth'

  // Copilot device code clipboard handling
  const [copiedCode, setCopiedCode] = useState(false)

  // Auto-copy device code to clipboard when it appears
  useEffect(() => {
    if (copilotDeviceCode?.userCode) {
      navigator.clipboard.writeText(copilotDeviceCode.userCode).then(() => {
        setCopiedCode(true)
        setTimeout(() => setCopiedCode(false), 2000)
      }).catch(() => {
        // Clipboard write failed, user can still click to copy
      })
    }
  }, [copilotDeviceCode?.userCode])

  const handleCopyCode = () => {
    if (copilotDeviceCode?.userCode) {
      navigator.clipboard.writeText(copilotDeviceCode.userCode).then(() => {
        setCopiedCode(true)
        setTimeout(() => setCopiedCode(false), 2000)
      })
    }
  }

  // --- ChatGPT OAuth flow (native browser OAuth) ---
  if (isChatGptOAuth) {
    return (
      <StepFormLayout
        title="Connect ChatGPT"
        description="Use your ChatGPT Plus or Pro subscription to power Codex."
        actions={
          <>
            <BackButton onClick={onBack} disabled={status === 'validating'} />
            <ContinueButton
              onClick={() => onStartOAuth?.()}
              className="gap-2"
              loading={status === 'validating'}
              loadingText="Connecting..."
            >
              <ExternalLink className="size-4" />
              Sign in with ChatGPT
            </ContinueButton>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-xl bg-foreground-2 p-4 text-sm text-muted-foreground">
            <p>Click the button above to sign in with your OpenAI account. A browser window will open for authentication.</p>
          </div>
          {status === 'error' && errorMessage && (
            <div className="rounded-lg bg-destructive/10 text-destructive text-sm p-3">
              {errorMessage}
            </div>
          )}
          {status === 'success' && (
            <div className="rounded-lg bg-success/10 text-success text-sm p-3">
              Connected! Your ChatGPT subscription is ready.
            </div>
          )}
        </div>
      </StepFormLayout>
    )
  }

  // --- Copilot OAuth flow (device flow) ---
  if (isCopilotOAuth) {
    return (
      <StepFormLayout
        title="Connect GitHub Copilot"
        description="Use your GitHub Copilot subscription to power AI agents."
        actions={
          <>
            <BackButton onClick={onBack} disabled={status === 'validating'} />
            <ContinueButton
              onClick={() => onStartOAuth?.()}
              className="gap-2"
              loading={status === 'validating'}
              loadingText="Waiting for authorization..."
            >
              <ExternalLink className="size-4" />
              Sign in with GitHub
            </ContinueButton>
          </>
        }
      >
        <div className="space-y-4">
          {copilotDeviceCode ? (
            <div className="rounded-xl bg-foreground-2 p-4 text-sm space-y-3">
              <p className="text-muted-foreground text-center">
                Enter this code on GitHub to authorize:
              </p>
              <div className="flex flex-col items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyCode}
                  className="text-2xl font-mono font-bold tracking-widest text-foreground px-4 py-2 rounded-lg bg-background border border-border hover:bg-foreground-2 transition-colors cursor-pointer"
                >
                  {copilotDeviceCode.userCode}
                </button>
                <span className={`text-xs text-muted-foreground flex items-center gap-1 transition-opacity ${copiedCode ? 'opacity-100' : 'opacity-0'}`}>
                  <Check className="size-3" />
                  Copied to clipboard
                </span>
              </div>
              <p className="text-muted-foreground text-xs text-center">
                A browser window should have opened to github.com/login/device
              </p>
            </div>
          ) : (
            <div className="rounded-xl bg-foreground-2 p-4 text-sm text-muted-foreground text-center">
              <p>Click the button above to sign in with your GitHub account.</p>
            </div>
          )}
          {status === 'error' && errorMessage && (
            <div className="rounded-lg bg-destructive/10 text-destructive text-sm p-3 text-center">
              {errorMessage}
            </div>
          )}
          {status === 'success' && (
            <div className="rounded-lg bg-success/10 text-success text-sm p-3 text-center">
              Connected! Your GitHub Copilot subscription is ready.
            </div>
          )}
        </div>
      </StepFormLayout>
    )
  }

  // --- Claude OAuth flow ---
  if (isClaudeOAuth) {
    // Waiting for authorization code entry
    if (isWaitingForCode) {
      return (
        <StepFormLayout
          title={t('onboarding:credentials.oauthCode.title')}
          description={t('onboarding:credentials.oauthCode.description')}
          actions={
            <>
              <BackButton onClick={onCancelOAuth} disabled={status === 'validating'}>
                {t('onboarding:credentials.oauthCode.cancel')}
              </BackButton>
              <ContinueButton
                type="submit"
                form="auth-code-form"
                disabled={false}
                loading={status === 'validating'}
                loadingText={t('onboarding:credentials.oauthCode.loading')}
              >
                {labels.continue}
              </ContinueButton>
            </>
          }
        >
          <OAuthConnect
            status={status as OAuthStatus}
            errorMessage={errorMessage}
            isWaitingForCode={true}
            onStartOAuth={onStartOAuth!}
            onSubmitAuthCode={onSubmitAuthCode}
            onCancelOAuth={onCancelOAuth}
          />
        </StepFormLayout>
      )
    }

    return (
      <StepFormLayout
        title={t('onboarding:credentials.oauthConnect.title')}
        description={t('onboarding:credentials.oauthConnect.description')}
          actions={
            <>
              <BackButton onClick={onBack} disabled={status === 'validating'}>{labels.back}</BackButton>
              <ContinueButton
                onClick={onStartOAuth}
                className="gap-2"
                loading={status === 'validating'}
              loadingText={t('onboarding:credentials.oauthConnect.loading')}
            >
              <ExternalLink className="size-4" />
              {t('onboarding:credentials.oauthConnect.button')}
            </ContinueButton>
          </>
        }
      >
        <OAuthConnect
          status={status as OAuthStatus}
          errorMessage={errorMessage}
          isWaitingForCode={false}
          onStartOAuth={onStartOAuth!}
          onSubmitAuthCode={onSubmitAuthCode}
          onCancelOAuth={onCancelOAuth}
        />
      </StepFormLayout>
    )
  }

  // --- API Key flow ---
  // Determine provider type and description based on selected method
  const providerType = isOpenAiApiKey ? 'openai' : 'anthropic'
  const apiKeyDescription = isOpenAiApiKey
    ? "Enter your OpenAI API key. Optionally configure OpenRouter or Vercel AI Gateway."
    : "Enter your API key. Optionally configure a custom endpoint for OpenRouter, Ollama, or compatible APIs."

  return (
    <StepFormLayout
      title={t('onboarding:credentials.apiKey.title')}
      description={t('onboarding:credentials.apiKey.description')}
      actions={
        <>
          <BackButton onClick={onBack} disabled={status === 'validating'}>{labels.back}</BackButton>
          <ContinueButton
            type="submit"
            form="api-key-form"
            disabled={false}
            loading={status === 'validating'}
            loadingText={t('onboarding:credentials.apiKey.loading')}
          >
            {labels.continue}
          </ContinueButton>
        </>
      }
    >
      <ApiKeyInput
        status={status as ApiKeyStatus}
        errorMessage={errorMessage}
        onSubmit={onSubmit}
        customModelDefaultHint={labels.customModelDefaultHint}
        nonClaudeHint={labels.nonClaudeHint}
        modelFormatPrefix={labels.formatPrefix}
        browseModelsLabel={labels.browseModels}
        viewSupportedModelsLabel={labels.viewSupportedModels}
        ollamaHint={labels.ollamaHint}
        customModelLabel={labels.customModelLabel}
        optionalLabel={labels.optional}
        customPresetLabel={labels.customPreset}
      />
    </StepFormLayout>
  )
}
