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

// Step indicator
export { StepIndicator, type OnboardingStep } from './StepIndicator'

// Individual steps
export { WelcomeStep } from './WelcomeStep'
export { CraftLoginStep, type LoginStatus } from './CraftLoginStep'
export { SpaceSelectionStep, type CraftSpace, type SpaceCategory } from './SpaceSelectionStep'
export { BillingMethodStep, type BillingMethod } from './BillingMethodStep'
export { CredentialsStep, type CredentialStatus } from './CredentialsStep'
export { CompletionStep } from './CompletionStep'

// Main wizard container
export { OnboardingWizard, type OnboardingState } from './OnboardingWizard'

// Re-export all types for convenient import
export type {
  OnboardingStep as OnboardingStepType,
} from './StepIndicator'

export type {
  LoginStatus as LoginStatusType,
} from './CraftLoginStep'

export type {
  CraftSpace as CraftSpaceType,
  SpaceCategory as SpaceCategoryType,
} from './SpaceSelectionStep'

export type {
  BillingMethod as BillingMethodType,
} from './BillingMethodStep'

export type {
  CredentialStatus as CredentialStatusType,
} from './CredentialsStep'

export type {
  OnboardingState as OnboardingStateType,
} from './OnboardingWizard'
