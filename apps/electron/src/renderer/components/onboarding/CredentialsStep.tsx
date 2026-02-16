/**
 * CredentialsStep - Onboarding step wrapper for API key or OAuth flow
 *
 * Thin wrapper that composes ApiKeyInput or OAuthConnect controls
 * with StepFormLayout for the onboarding wizard context.
 */

import { useEffect, useState } from "react"
import { Check, ExternalLink, Terminal, CheckCircle2, XCircle, Loader2 } from "lucide-react"
import type { ApiSetupMethod } from "./APISetupStep"
import { StepFormLayout, BackButton, ContinueButton } from "./primitives"
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
  const isClaudeOAuth = apiSetupMethod === 'claude_oauth'
  const isChatGptOAuth = apiSetupMethod === 'chatgpt_oauth'
  const isCopilotOAuth = apiSetupMethod === 'copilot_oauth'
  const isAnthropicApiKey = apiSetupMethod === 'anthropic_api_key'
  const isOpenAiApiKey = apiSetupMethod === 'openai_api_key'
  const isAmpCli = apiSetupMethod === 'amp_cli'
  const isApiKey = isAnthropicApiKey || isOpenAiApiKey

  // Copilot device code clipboard handling
  const [copiedCode, setCopiedCode] = useState(false)

  // Amp CLI installation status
  const [ampStatus, setAmpStatus] = useState<'checking' | 'installed' | 'not_installed'>('checking')

  // Check Amp installation on mount (only when Amp is selected)
  useEffect(() => {
    if (isAmpCli) {
      window.electronAPI.checkAmpInstalled().then((installed: boolean) => {
        setAmpStatus(installed ? 'installed' : 'not_installed')
      }).catch(() => {
        setAmpStatus('not_installed')
      })
    }
  }, [isAmpCli])

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

  // --- Amp CLI flow (external CLI auth) ---
  if (isAmpCli) {
    const handleOpenAmpInstall = () => {
      window.electronAPI.openUrl('https://ampcode.com/install')
    }

    const handleRefreshCheck = () => {
      setAmpStatus('checking')
      window.electronAPI.checkAmpInstalled().then((installed: boolean) => {
        setAmpStatus(installed ? 'installed' : 'not_installed')
      }).catch(() => {
        setAmpStatus('not_installed')
      })
    }

    return (
      <StepFormLayout
        title="Set up Amp CLI"
        description="Amp is a frontier coding agent with multi-model support."
        actions={
          <>
            <BackButton onClick={onBack} />
            <ContinueButton
              onClick={() => onSubmit({ apiKey: '' })}
              disabled={ampStatus !== 'installed'}
            >
              Continue
            </ContinueButton>
          </>
        }
      >
        <div className="space-y-4">
          {/* Status indicator */}
          <div className="rounded-xl bg-foreground-2 p-4">
            <div className="flex items-center gap-3">
              {ampStatus === 'checking' && (
                <>
                  <Loader2 className="size-5 text-muted-foreground animate-spin" />
                  <span className="text-sm text-muted-foreground">Checking for Amp CLI...</span>
                </>
              )}
              {ampStatus === 'installed' && (
                <>
                  <CheckCircle2 className="size-5 text-success" />
                  <span className="text-sm text-success">Amp CLI is installed and ready!</span>
                </>
              )}
              {ampStatus === 'not_installed' && (
                <>
                  <XCircle className="size-5 text-destructive" />
                  <span className="text-sm text-destructive">Amp CLI not found</span>
                </>
              )}
            </div>
          </div>

          {/* Installation instructions */}
          {ampStatus === 'not_installed' && (
            <div className="rounded-xl border border-border p-4 space-y-3">
              <p className="text-sm text-muted-foreground">
                Install Amp CLI by running this command in your terminal:
              </p>
              <code className="block bg-background rounded-lg p-3 text-sm font-mono text-foreground">
                curl -fsSL https://ampcode.com/install.sh | bash
              </code>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleOpenAmpInstall}
                  className="flex items-center gap-2 text-sm text-primary hover:underline"
                >
                  <ExternalLink className="size-3" />
                  Open ampcode.com/install
                </button>
                <span className="text-muted-foreground">·</span>
                <button
                  type="button"
                  onClick={handleRefreshCheck}
                  className="text-sm text-primary hover:underline"
                >
                  Refresh
                </button>
              </div>
            </div>
          )}

          {/* Features list */}
          <div className="rounded-xl bg-foreground-2 p-4">
            <p className="text-xs text-muted-foreground mb-2 font-medium">Amp features:</p>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li>• Multi-model: Opus 4.6, GPT-5.2 Codex, and more</li>
              <li>• Three modes: Smart, Rush, and Deep reasoning</li>
              <li>• Oracle for complex analysis and review</li>
              <li>• Subagents for parallel task execution</li>
            </ul>
          </div>
        </div>
      </StepFormLayout>
    )
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
          title="Enter Authorization Code"
          description="Copy the code from the browser page and paste it below."
          actions={
            <>
              <BackButton onClick={onCancelOAuth} disabled={status === 'validating'}>Cancel</BackButton>
              <ContinueButton
                type="submit"
                form="auth-code-form"
                disabled={false}
                loading={status === 'validating'}
                loadingText="Connecting..."
              />
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
        title="Connect Claude Account"
        description="Use your Claude subscription to power multi-agent workflows."
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
              Sign in with Claude
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
    ? "Enter your OpenAI API key."
    : "Enter your API key. Optionally configure a custom endpoint for OpenRouter, Ollama, or compatible APIs."

  return (
    <StepFormLayout
      title="API Configuration"
      description={apiKeyDescription}
      actions={
        <>
          <BackButton onClick={onBack} disabled={status === 'validating'} />
          <ContinueButton
            type="submit"
            form="api-key-form"
            disabled={false}
            loading={status === 'validating'}
            loadingText="Validating..."
          />
        </>
      }
    >
      <ApiKeyInput
        status={status as ApiKeyStatus}
        errorMessage={errorMessage}
        onSubmit={onSubmit}
        providerType={providerType}
      />
    </StepFormLayout>
  )
}
