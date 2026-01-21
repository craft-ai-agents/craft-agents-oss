import { CraftAgentsSymbol } from "@/components/icons/CraftAgentsSymbol"
import { StepFormLayout, ContinueButton } from "./primitives"
import { useTranslation } from "@/i18n"

interface WelcomeStepProps {
  onContinue: () => void
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
  isExistingUser = false
}: WelcomeStepProps) {
  const { t } = useTranslation()

  return (
    <StepFormLayout
      iconElement={
        <div className="flex size-16 items-center justify-center">
          <CraftAgentsSymbol className="size-10 text-accent" />
        </div>
      }
      title={isExistingUser ? t('updateSettings' as any) : t('welcomeToCraftAgents' as any)}
      description={
        isExistingUser
          ? t('updateBillingOrChangeSetup' as any)
          : t('welcomeToCraftAgentsLong' as any)
      }
      actions={
        <ContinueButton onClick={onContinue} className="w-full">
          {isExistingUser ? t('continue' as any) : t('getStarted' as any)}
        </ContinueButton>
      }
    />
  )
}
