import { VesperSymbol } from "@/components/icons/VesperSymbol"
import { StepFormLayout, ContinueButton } from "./primitives"

interface WelcomeStepProps {
  onContinue: () => void
  /** Whether this is an existing user updating settings */
  isExistingUser?: boolean
}

/**
 * WelcomeStep - Initial welcome screen for onboarding
 *
 * Shows different messaging for new vs existing users:
 * - New users: Welcome to Vesper
 * - Existing users: Update your billing settings
 */
export function WelcomeStep({
  onContinue,
  isExistingUser = false
}: WelcomeStepProps) {
  return (
    <StepFormLayout
      iconElement={
        <div className="flex size-16 items-center justify-center">
          <VesperSymbol className="size-10 text-accent" />
        </div>
      }
      title={isExistingUser ? 'Update Settings' : 'Welcome to Vesper'}
      description={
        isExistingUser
          ? 'Update billing or change your setup.'
          : 'The golden hour where AI Companions work tirelessly into the night while you do the orchestration and creative thinking.'
      }
      actions={
        <ContinueButton onClick={onContinue} className="w-full">
          {isExistingUser ? 'Continue' : 'Get Started'}
        </ContinueButton>
      }
    />
  )
}
