import { G4OSSymbol } from "@/components/icons/G4OSSymbol"
import { StepFormLayout, ContinueButton } from "./primitives"
import { useLocale } from "@/context/LocaleContext"

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
  const { t } = useLocale()
  return (
    <StepFormLayout
      iconElement={
        <div className="flex size-16 items-center justify-center">
          <G4OSSymbol className="size-10 text-accent" />
        </div>
      }
      title={isExistingUser ? t('onboarding.welcome.titleExisting') : t('onboarding.welcome.title')}
      description={
        isExistingUser
          ? t('onboarding.welcome.descriptionExisting')
          : t('onboarding.welcome.description')
      }
      actions={
        <ContinueButton onClick={onContinue} className="w-full" loading={isLoading} loadingText={t('onboarding.welcome.checking')}>
          {isExistingUser ? t('onboarding.welcome.continue') : t('onboarding.welcome.getStarted')}
        </ContinueButton>
      }
    />
  )
}
