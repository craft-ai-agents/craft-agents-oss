import { AlertCircle, RotateCcw, X } from "lucide-react"
import { StepFormLayout, BackButton, ContinueButton } from "@/components/onboarding/primitives"
import { Button } from "@/components/ui/button"

interface ErrorStepProps {
  /** Name of the agent */
  agentName: string
  /** Error message to display */
  errorMessage: string
  /** Called to retry the failed operation */
  onRetry?: () => void
  /** Called to cancel and close */
  onCancel?: () => void
}

/**
 * ErrorStep - Error screen when something goes wrong
 *
 * Shows the error message with options to retry or cancel.
 */
export function ErrorStep({
  agentName,
  errorMessage,
  onRetry,
  onCancel,
}: ErrorStepProps) {
  return (
    <StepFormLayout
      icon={<AlertCircle />}
      iconVariant="error"
      title="Setup failed"
      description={`Something went wrong while setting up ${agentName}.`}
      actions={
        <>
          <BackButton onClick={onCancel}>
            <X className="mr-1.5 size-4" />
            Cancel
          </BackButton>
          <ContinueButton onClick={onRetry}>
            <RotateCcw className="mr-1.5 size-4" />
            Retry
          </ContinueButton>
        </>
      }
    >
      <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
        <p className="text-sm text-destructive">
          {errorMessage}
        </p>
      </div>
    </StepFormLayout>
  )
}
