import { Button } from "@/components/ui/button"
import { Spinner } from "@craft-agent/ui"
import { CraftAgentsSymbol } from "@/components/icons/CraftAgentsSymbol"
import { StepFormLayout } from "./primitives"
import { useI18n } from '@/i18n'

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
  const { t } = useI18n('onboarding')
  const isSaving = status === 'saving'

  return (
    <StepFormLayout
      iconElement={isSaving ? (
        <div className="flex size-16 items-center justify-center">
          <Spinner className="text-2xl text-foreground" />
        </div>
      ) : (
        <div className="flex size-16 items-center justify-center">
          <CraftAgentsSymbol className="size-10 text-accent" />
        </div>
      )}
      title={isSaving ? t('completion.savingTitle') : t('completion.completeTitle')}
      description={
        isSaving ? (
          t('completion.savingDescription')
        ) : (
          t('completion.completeDescription')
        )
      }
      actions={
        status === 'complete' ? (
          <Button onClick={onFinish} className="w-full max-w-[320px] bg-background shadow-minimal text-foreground hover:bg-foreground/5 rounded-lg" size="lg">
            {t('completion.getStartedButton')}
          </Button>
        ) : undefined
      }
    />
  )
}
