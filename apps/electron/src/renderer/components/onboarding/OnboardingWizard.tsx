import { useState } from "react"
import { cn } from "@/lib/utils"
import { StepIndicator, type OnboardingStep } from "./StepIndicator"
import { WelcomeStep } from "./WelcomeStep"
import { CraftLoginStep, type LoginStatus } from "./CraftLoginStep"
import { SpaceSelectionStep, type SpaceCategory } from "./SpaceSelectionStep"
import { BillingMethodStep, type BillingMethod } from "./BillingMethodStep"
import { CredentialsStep, type CredentialStatus } from "./CredentialsStep"
import { CompletionStep } from "./CompletionStep"

export interface OnboardingState {
  step: OnboardingStep
  loginStatus: LoginStatus
  credentialStatus: CredentialStatus
  completionStatus: 'saving' | 'complete'
  selectedSpaceId: string | null
  selectedSpaceName: string | null
  billingMethod: BillingMethod | null
  isExistingUser: boolean
  errorMessage?: string
}

interface OnboardingWizardProps {
  /** Current state of the wizard */
  state: OnboardingState
  /** Available spaces grouped by category */
  spaceCategories: SpaceCategory[]
  /** Whether spaces are loading */
  isLoadingSpaces?: boolean

  // Event handlers
  onCancel?: () => void
  onContinue: () => void
  onBack: () => void
  onLogin: () => void
  onOpenLoginManually?: () => void
  onRetryLogin?: () => void
  onSelectSpace: (spaceId: string) => void
  onSelectBillingMethod: (method: BillingMethod) => void
  onSubmitCredential: (credential: string) => void
  onStartOAuth?: () => void
  onFinish: () => void

  className?: string
}

/**
 * OnboardingWizard - Full-screen onboarding flow container
 *
 * Manages the step-by-step flow for setting up Craft Agent:
 * 1. Welcome
 * 2. Craft Login (OAuth)
 * 3. Space Selection
 * 4. Billing Method
 * 5. Credentials (if needed)
 * 6. Completion
 */
export function OnboardingWizard({
  state,
  spaceCategories,
  isLoadingSpaces = false,
  onCancel,
  onContinue,
  onBack,
  onLogin,
  onOpenLoginManually,
  onRetryLogin,
  onSelectSpace,
  onSelectBillingMethod,
  onSubmitCredential,
  onStartOAuth,
  onFinish,
  className
}: OnboardingWizardProps) {
  const renderStep = () => {
    switch (state.step) {
      case 'welcome':
        return (
          <WelcomeStep
            isExistingUser={state.isExistingUser}
            onContinue={onContinue}
            onCancel={onCancel}
          />
        )

      case 'craft-login':
        return (
          <CraftLoginStep
            status={state.loginStatus}
            errorMessage={state.errorMessage}
            onLogin={onLogin}
            onOpenManually={onOpenLoginManually}
            onBack={onBack}
            onRetry={onRetryLogin}
          />
        )

      case 'select-space':
        return (
          <SpaceSelectionStep
            categories={spaceCategories}
            selectedSpaceId={state.selectedSpaceId}
            isLoading={isLoadingSpaces}
            onSelect={onSelectSpace}
            onContinue={onContinue}
            onBack={onBack}
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
          />
        )

      case 'complete':
        return (
          <CompletionStep
            status={state.completionStatus}
            spaceName={state.selectedSpaceName ?? undefined}
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
        "flex min-h-screen flex-col bg-background",
        className
      )}
    >
      {/* Header with progress indicator */}
      <header className="flex h-14 items-center justify-center border-b border-border px-4">
        <StepIndicator
          currentStep={state.step}
          isExistingUser={state.isExistingUser}
        />
      </header>

      {/* Main content */}
      <main className="flex flex-1 items-center justify-center p-8">
        {renderStep()}
      </main>
    </div>
  )
}
