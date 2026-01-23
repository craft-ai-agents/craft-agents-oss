/**
 * CredentialsStep - Onboarding step wrapper for API key or OAuth flow
 *
 * Thin wrapper that composes ApiKeyInput or OAuthConnect controls
 * with StepFormLayout for the onboarding wizard context.
 */

import { ExternalLink, CheckCircle2 } from "lucide-react"
import type { BillingMethod } from "./BillingMethodStep"
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
  billingMethod: BillingMethod
  status: CredentialStatus
  errorMessage?: string
  onSubmit: (data: ApiKeySubmitData) => void
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
}

export function CredentialsStep({
  billingMethod,
  status,
  errorMessage,
  onSubmit,
  onStartOAuth,
  onBack,
  existingClaudeToken,
  onUseExistingClaudeToken,
  isWaitingForCode,
  onSubmitAuthCode,
  onCancelOAuth,
}: CredentialsStepProps) {
  const isOAuth = billingMethod === 'claude_oauth'

  // --- OAuth flow ---
  if (isOAuth) {
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
            existingClaudeToken={existingClaudeToken}
            isWaitingForCode={true}
            onStartOAuth={onStartOAuth!}
            onUseExistingClaudeToken={onUseExistingClaudeToken}
            onSubmitAuthCode={onSubmitAuthCode}
            onCancelOAuth={onCancelOAuth}
          />
        </StepFormLayout>
      )
    }

    // Static layout matching the API key step pattern:
    // Fixed title/description, button shows loading, error below content
    const description = hasExistingToken
      ? 'Found an existing Claude token. Use it or sign in with a different account.'
      : 'Use your Claude subscription to power multi-agent workflows.'

    return (
      <StepFormLayout
        title="Connect Claude Account"
        description={description}
        actions={
          <>
            <BackButton onClick={onBack} disabled={status === 'validating'} />
            {hasExistingToken ? (
              <ContinueButton
                onClick={onUseExistingClaudeToken}
                className="gap-2"
                loading={status === 'validating'}
                loadingText="Connecting..."
              >
                <CheckCircle2 className="size-4" />
                Use Existing Token
              </ContinueButton>
            ) : (
              <ContinueButton
                onClick={onStartOAuth}
                className="gap-2"
                loading={status === 'validating'}
                loadingText="Connecting..."
              >
                <ExternalLink className="size-4" />
                Sign in with Claude
              </ContinueButton>
            )}
          </>
        }
      >
        <OAuthConnect
          status={status as OAuthStatus}
          errorMessage={errorMessage}
          existingClaudeToken={existingClaudeToken}
          isWaitingForCode={false}
          onStartOAuth={onStartOAuth!}
          onUseExistingClaudeToken={onUseExistingClaudeToken}
          onSubmitAuthCode={onSubmitAuthCode}
          onCancelOAuth={onCancelOAuth}
        />
      </StepFormLayout>
    )
  }

  // --- API Key flow ---
  return (
    <StepFormLayout
      title="API Configuration"
      description="Enter your API key. Optionally configure a custom endpoint for OpenRouter, Ollama, or compatible APIs."
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
      />
    </StepFormLayout>
  )
}
