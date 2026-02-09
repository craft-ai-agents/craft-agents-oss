import { G4OSSymbol } from "@/components/icons/G4OSSymbol"
import { StepFormLayout, ContinueButton } from "./primitives"

interface WelcomeStepProps {
  onContinue: () => void
  /** Whether this is an existing user updating settings */
  isExistingUser?: boolean
  /** Whether the app is loading (e.g., checking Git Bash on Windows) */
  isLoading?: boolean
}

/**
 * WelcomeStep - Initial welcome screen for onboarding
 *
 * Shows different messaging for new vs existing users:
 * - New users: Welcome to G4 OS
 * - Existing users: Update your API connection settings
 */
export function WelcomeStep({
  onContinue,
  isExistingUser = false,
  isLoading = false
}: WelcomeStepProps) {
  return (
    <StepFormLayout
      iconElement={
        <div className="flex size-16 items-center justify-center">
          <G4OSSymbol className="size-10 text-accent" />
        </div>
      }
      title={isExistingUser ? 'Update Settings' : 'Welcome to G4 OS'}
      description={
        isExistingUser
          ? 'Update your API connection or change your setup.'
          : 'Agents with the UX they deserve. Connect anything. Organize your sessions. Everything you need to do the work of your life!'
      }
      actions={
        <ContinueButton onClick={onContinue} className="w-full" loading={isLoading} loadingText="Checking...">
          {isExistingUser ? 'Continue' : 'Get Started'}
        </ContinueButton>
      }
    />
  )
}
