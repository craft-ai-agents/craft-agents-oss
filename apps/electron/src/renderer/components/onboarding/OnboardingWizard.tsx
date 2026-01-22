import { cn } from "@/lib/utils"
import { WelcomeStep } from "./WelcomeStep"
import { BillingMethodStep, type BillingMethod } from "./BillingMethodStep"
import { CredentialsStep, type CredentialStatus } from "./CredentialsStep"
import { CustomEndpointStep, type CustomEndpointStatus } from "./CustomEndpointStep"
import { CompletionStep } from "./CompletionStep"
import type { CustomEndpointUploadResult } from "../../../shared/types"

export type OnboardingStep =
  | 'welcome'
  | 'billing-method'
  | 'credentials'
  | 'custom-endpoint'
  | 'complete'

export type LoginStatus = 'idle' | 'waiting' | 'success' | 'error'

// Re-export CustomEndpointStatus for use in other components
export type { CustomEndpointStatus }

export interface OnboardingState {
  step: OnboardingStep
  loginStatus: LoginStatus
  credentialStatus: CredentialStatus
  completionStatus: 'saving' | 'complete'
  billingMethod: BillingMethod | null
  isExistingUser: boolean
  errorMessage?: string
}

interface OnboardingWizardProps {
  /** Current state of the wizard */
  state: OnboardingState

  // Event handlers
  onContinue: () => void
  onBack: () => void
  onSelectBillingMethod: (method: BillingMethod) => void
  onSubmitCredential: (credential: string) => void
  onStartOAuth?: () => void
  onFinish: () => void

  // Claude OAuth
  existingClaudeToken?: string | null
  isClaudeCliInstalled?: boolean
  onUseExistingClaudeToken?: () => void
  // Two-step OAuth flow
  isWaitingForCode?: boolean
  onSubmitAuthCode?: (code: string) => void
  onCancelOAuth?: () => void

  // Custom endpoint
  customEndpointStatus?: CustomEndpointStatus
  onUploadCustomEndpoint?: (jsonContent: string) => Promise<CustomEndpointUploadResult>

  className?: string
}

/**
 * OnboardingWizard - Full-screen onboarding flow container
 *
 * Manages the step-by-step flow for setting up Craft Agent:
 * 1. Welcome
 * 2. Billing Method (choose: API Key / Claude OAuth / Custom Endpoint)
 * 3. Credentials (API Key or Claude OAuth) OR Custom Endpoint (upload config)
 * 4. Completion
 */
export function OnboardingWizard({
  state,
  onContinue,
  onBack,
  onSelectBillingMethod,
  onSubmitCredential,
  onStartOAuth,
  onFinish,
  existingClaudeToken,
  isClaudeCliInstalled,
  onUseExistingClaudeToken,
  // Two-step OAuth flow
  isWaitingForCode,
  onSubmitAuthCode,
  onCancelOAuth,
  // Custom endpoint
  customEndpointStatus = 'idle',
  onUploadCustomEndpoint,
  className
}: OnboardingWizardProps) {
  const renderStep = () => {
    switch (state.step) {
      case 'welcome':
        return (
          <WelcomeStep
            isExistingUser={state.isExistingUser}
            onContinue={onContinue}
          />
        )

      case 'billing-method':
        return (
          <BillingMethodStep
            selectedMethod={state.billingMethod}
            onSelect={onSelectBillingMethod}
            onContinue={onContinue}
            onBack={onBack}
          />
        )

      case 'credentials':
        return (
          <CredentialsStep
            billingMethod={state.billingMethod!}
            status={state.credentialStatus}
            errorMessage={state.errorMessage}
            onSubmit={onSubmitCredential}
            onStartOAuth={onStartOAuth}
            onBack={onBack}
            existingClaudeToken={existingClaudeToken}
            isClaudeCliInstalled={isClaudeCliInstalled}
            onUseExistingClaudeToken={onUseExistingClaudeToken}
            isWaitingForCode={isWaitingForCode}
            onSubmitAuthCode={onSubmitAuthCode}
            onCancelOAuth={onCancelOAuth}
          />
        )

      case 'custom-endpoint':
        return (
          <CustomEndpointStep
            status={customEndpointStatus}
            errorMessage={state.errorMessage}
            onUploadConfig={onUploadCustomEndpoint!}
            onBack={onBack}
            onContinue={onContinue}
          />
        )

      case 'complete':
        return (
          <CompletionStep
            status={state.completionStatus}
            onFinish={onFinish}
          />
        )

      default:
        return null
    }
  }

  return (
    <div
      className={cn(
        "flex flex-col bg-foreground-2",
        !className?.includes('h-full') && "min-h-screen",
        className
      )}
    >
      {/* Draggable title bar region for transparent window (macOS) */}
      <div className="titlebar-drag-region fixed top-0 left-0 right-0 h-[50px] z-titlebar" />

      {/* Main content */}
      <main className="flex flex-1 items-center justify-center p-8">
        {renderStep()}
      </main>
    </div>
  )
}
