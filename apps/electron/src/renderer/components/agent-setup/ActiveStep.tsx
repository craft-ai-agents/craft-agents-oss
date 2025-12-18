import { CheckCircle2, MessageSquare, ArrowRight } from "lucide-react"
import { StepFormLayout, ContinueButton } from "@/components/onboarding/primitives"
import { Button } from "@/components/ui/button"

interface ActiveStepProps {
  /** Name of the agent */
  agentName: string
  /** Called to start chatting with the agent */
  onStartChat?: () => void
  /** Called to close the setup */
  onClose?: () => void
}

/**
 * ActiveStep - Success screen after agent activation
 *
 * Shows that the agent is now active and ready to use.
 */
export function ActiveStep({
  agentName,
  onStartChat,
  onClose,
}: ActiveStepProps) {
  return (
    <StepFormLayout
      icon={<CheckCircle2 />}
      iconVariant="success"
      title={`${agentName} is active`}
      description="The agent is now ready. Start a conversation or close this tab to continue."
      actions={
        <>
          <Button
            variant="ghost"
            onClick={onClose}
            className="flex-1 bg-foreground/5 hover:bg-foreground/10"
          >
            Close
          </Button>
          <ContinueButton onClick={onStartChat}>
            <MessageSquare className="mr-1.5 size-4" />
            Start Chat
            <ArrowRight className="ml-1.5 size-4" />
          </ContinueButton>
        </>
      }
    >
      <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-4 text-center">
        <p className="text-sm text-muted-foreground">
          You can now mention <span className="font-medium text-foreground">@{agentName}</span> in
          any conversation, or create a new chat with this agent.
        </p>
      </div>
    </StepFormLayout>
  )
}
