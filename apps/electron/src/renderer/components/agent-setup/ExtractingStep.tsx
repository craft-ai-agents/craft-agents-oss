import { Bot } from "lucide-react"
import { StepFormLayout, BackButton } from "@/components/onboarding/primitives"
import { Spinner } from "@/components/ui/loading-indicator"

interface ExtractingStepProps {
  /** Name of the agent being extracted */
  agentName: string
  /** Current extraction message */
  message?: string
  /** Called when user cancels extraction */
  onCancel?: () => void
}

/**
 * ExtractingStep - Loading screen while parsing agent from Craft document
 *
 * Shows a spinner with the agent name and optional status message.
 * User can cancel to go back to agent selection.
 */
export function ExtractingStep({
  agentName,
  message = "Reading agent configuration...",
  onCancel,
}: ExtractingStepProps) {
  return (
    <StepFormLayout
      iconElement={
        <div className="mb-2 flex size-16 items-center justify-center">
          <Spinner className="text-4xl text-primary" />
        </div>
      }
      title={`Setting up ${agentName}`}
      description={message}
      actions={
        onCancel && (
          <BackButton onClick={onCancel}>Cancel</BackButton>
        )
      }
    />
  )
}
