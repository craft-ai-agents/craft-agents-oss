import { useI18n } from '@/i18n'
import { CraftAgentsSymbol } from "@/components/icons/CraftAgentsSymbol"
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
 * - New users: Welcome to Craft Agents
 * - Existing users: Update your API connection settings
 */
export function WelcomeStep({
  onContinue,
  isExistingUser = false,
  isLoading = false
}: WelcomeStepProps) {
  const { t } = useI18n('onboarding')

  return (
    <StepFormLayout
      iconElement={
        <div className="flex size-16 items-center justify-center">
          <CraftAgentsSymbol className="size-10 text-accent" />
        </div>
      }
      title={isExistingUser ? t('welcome.existingUserTitle') : t('welcome.newUserTitle')}
      description={
        isExistingUser
          ? t('welcome.existingUserDescription')
          : t('welcome.newUserDescription')
      }
      actions={
        <ContinueButton onClick={onContinue} className="w-full" loading={isLoading} loadingText={t('welcome.checkingText')}>
          {isExistingUser ? t('welcome.continueButton') : t('welcome.getStartedButton')}
        </ContinueButton>
      }
    />
  )
}
