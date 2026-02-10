import { Button } from "@/components/ui/button"
import { Spinner } from "@g4os/ui"
import { G4OSSymbol } from "@/components/icons/G4OSSymbol"
import { StepFormLayout } from "./primitives"
import { useLocale } from "@/context/LocaleContext"

interface CompletionStepProps {
  status: 'saving' | 'complete'
  spaceName?: string
  onFinish: () => void
}

/**
 * CompletionStep - Success screen after onboarding
 *
 * Shows:
 * - saving: Spinner while saving configuration
 * - complete: Success message with option to start
 */
export function CompletionStep({
  status,
  spaceName,
  onFinish
}: CompletionStepProps) {
  const { t } = useLocale()
  const isSaving = status === 'saving'

  return (
    <StepFormLayout
      iconElement={isSaving ? (
        <div className="flex size-16 items-center justify-center">
          <Spinner className="text-2xl text-foreground" />
        </div>
      ) : (
        <div className="flex size-16 items-center justify-center">
          <G4OSSymbol className="size-10 text-accent" />
        </div>
      )}
      title={isSaving ? t('onboarding.completion.settingUp') : t('onboarding.completion.allSet')}
      description={
        isSaving ? (
          t('onboarding.completion.saving')
        ) : (
          t('onboarding.completion.startChat')
        )
      }
      actions={
        status === 'complete' ? (
          <Button onClick={onFinish} className="w-full max-w-[320px] bg-background shadow-minimal text-foreground hover:bg-foreground/5 rounded-lg" size="lg">
            {t('onboarding.completion.getStarted')}
          </Button>
        ) : undefined
      }
    />
  )
}
