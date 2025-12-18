import { cn } from "@/lib/utils"

export type AgentSetupStep =
  | 'extracting'
  | 'review'
  | 'mcp-auth'
  | 'api-auth'
  | 'ready'
  | 'active'
  | 'error'

interface AgentSetupStepIndicatorProps {
  /** Current step */
  currentStep: AgentSetupStep
  /** Whether there are concerns to review */
  hasConcerns?: boolean
  /** Whether there are MCP servers to auth */
  hasMcpServers?: boolean
  /** Whether there are APIs to auth */
  hasApis?: boolean
  className?: string
}

// Step order for display
const stepOrder: AgentSetupStep[] = ['extracting', 'review', 'mcp-auth', 'api-auth', 'ready']

/**
 * AgentSetupStepIndicator - Progress dots for agent setup flow
 *
 * Shows only relevant steps based on what the agent needs.
 */
export function AgentSetupStepIndicator({
  currentStep,
  hasConcerns = false,
  hasMcpServers = false,
  hasApis = false,
  className,
}: AgentSetupStepIndicatorProps) {
  // Filter to only show relevant steps
  const visibleSteps = stepOrder.filter((step) => {
    if (step === 'extracting') return true // Always show
    if (step === 'review') return hasConcerns
    if (step === 'mcp-auth') return hasMcpServers
    if (step === 'api-auth') return hasApis
    if (step === 'ready') return true // Always show
    return false
  })

  // Handle error/active as special states (show at end)
  const displayStep = currentStep === 'error' || currentStep === 'active' ? 'ready' : currentStep
  const currentIndex = visibleSteps.indexOf(displayStep)

  // Don't show indicator if only 2 steps (extracting + ready)
  if (visibleSteps.length <= 2) {
    return null
  }

  return (
    <div className={cn("flex items-center justify-center gap-2", className)}>
      {visibleSteps.map((step, index) => {
        const isComplete = index < currentIndex
        const isCurrent = index === currentIndex
        const isPending = index > currentIndex

        return (
          <div
            key={step}
            className={cn(
              "size-2 rounded-full transition-all duration-200",
              isComplete && "bg-primary",
              isCurrent && "bg-primary ring-2 ring-primary/30 ring-offset-2 ring-offset-background",
              isPending && "bg-muted-foreground/30"
            )}
          />
        )
      })}
    </div>
  )
}
