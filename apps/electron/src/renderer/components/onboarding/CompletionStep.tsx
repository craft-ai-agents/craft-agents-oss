import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/loading-indicator"
import { CraftAgentsSymbol } from "@/components/icons/CraftAgentsSymbol"
import { StepFormLayout } from "./primitives"

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
  const isSaving = status === 'saving'

  return (
    <StepFormLayout
      iconElement={isSaving ? (
        <div className="flex size-16 items-center justify-center">
          <Spinner className="text-2xl text-primary" />
        </div>
      ) : (
        <div className="flex size-16 items-center justify-center">
          <CraftAgentsSymbol className="size-10" />
        </div>
      )}
      title={isSaving ? 'Setting up...' : "You're all set!"}
      description={
        isSaving ? (
          'Saving your configuration...'
        ) : (
          <>
            {spaceName && (
              <>Connected to <span className="font-medium text-foreground">{spaceName}</span>. </>
            )}
            Start chatting with Claude to manage your Craft documents.
          </>
        )
      }
      actions={
        status === 'complete' ? (
          <Button onClick={onFinish} className="w-full" size="lg">
            Get Started
          </Button>
        ) : undefined
      }
    />
  )
}
