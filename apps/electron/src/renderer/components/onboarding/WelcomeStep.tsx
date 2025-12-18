import { CraftAgentsSymbol } from "@/components/icons/CraftAgentsSymbol"
import { StepFormLayout, BackButton, ContinueButton } from "./primitives"

interface WelcomeStepProps {
  onContinue: () => void
  onCancel?: () => void
  /** Whether this is an existing user updating settings */
  isExistingUser?: boolean
}

/**
 * WelcomeStep - Initial welcome screen for onboarding
 *
 * Shows different messaging for new vs existing users:
 * - New users: Welcome to Craft Agents
 * - Existing users: Update your billing settings
 */
export function WelcomeStep({
  onContinue,
  onCancel,
  isExistingUser = false
}: WelcomeStepProps) {
  return (
    <StepFormLayout
      iconElement={
        <div className="flex size-16 items-center justify-center">
          <CraftAgentsSymbol className="size-10" />
        </div>
      }
      title={isExistingUser ? 'Update Settings' : 'Welcome to Craft Agents'}
      description={
        isExistingUser
          ? 'You can update your billing method or connect a different Craft space.'
          : <>A new way to manage your<br />work, knowledge, and tools.</>
      }
      actions={
        <>
          {onCancel && <BackButton onClick={onCancel}>Cancel</BackButton>}
          <ContinueButton onClick={onContinue} className={onCancel ? undefined : "w-full"}>
            {isExistingUser ? 'Continue' : 'Get Started'}
          </ContinueButton>
        </>
      }
    />
  )
}
