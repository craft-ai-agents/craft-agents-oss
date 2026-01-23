// Shared primitives for building step components
export {
  StepIcon,
  StepHeader,
  StepFormLayout,
  StepActions,
  BackButton,
  ContinueButton,
  type StepIconVariant,
} from './primitives'

// Individual steps
export { WelcomeStep } from './WelcomeStep'
export { BillingMethodStep, type BillingMethod } from './BillingMethodStep'
export { CredentialsStep, type CredentialStatus } from './CredentialsStep'
export { CompletionStep } from './CompletionStep'
export { ReauthScreen } from './ReauthScreen'

// Main wizard container
export { OnboardingWizard, type OnboardingState, type OnboardingStep, type LoginStatus } from './OnboardingWizard'

// Re-export all types for convenient import
export type {
  OnboardingStep as OnboardingStepType,
  OnboardingState as OnboardingStateType,
} from './OnboardingWizard'

export type {
  BillingMethod as BillingMethodType,
} from './BillingMethodStep'

export type {
  CredentialStatus as CredentialStatusType,
} from './CredentialsStep'
