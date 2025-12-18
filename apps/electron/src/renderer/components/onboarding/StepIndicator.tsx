import { cn } from "@/lib/utils"

export type OnboardingStep =
  | 'welcome'
  | 'craft-login'
  | 'select-space'
  | 'billing-method'
  | 'credentials'
  | 'complete'

interface StepIndicatorProps {
  currentStep: OnboardingStep
  /** Whether this is an existing user flow (fewer steps) */
  isExistingUser?: boolean
  className?: string
}

const NEW_USER_STEPS: OnboardingStep[] = [
  'welcome',
  'craft-login',
  'select-space',
  'billing-method',
  'credentials',
  'complete',
]

const EXISTING_USER_STEPS: OnboardingStep[] = [
  'welcome',
  'billing-method',
  'credentials',
  'complete',
]

/**
 * StepIndicator - Shows progress through the onboarding flow
 *
 * Displays dots for each step:
 * - Filled dot (●) = completed
 * - Ring dot (◉) = current
 * - Empty dot (○) = pending
 */
export function StepIndicator({
  currentStep,
  isExistingUser = false,
  className
}: StepIndicatorProps) {
  const steps = isExistingUser
    ? EXISTING_USER_STEPS
    : NEW_USER_STEPS
  const currentIndex = steps.indexOf(currentStep)

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {steps.map((step, index) => {
        const isCompleted = index < currentIndex
        const isCurrent = index === currentIndex

        return (
          <div
            key={step}
            className={cn(
              "size-2 rounded-full transition-all duration-200",
              isCompleted && "bg-primary",
              isCurrent && "bg-primary ring-2 ring-primary/30 ring-offset-1 ring-offset-background",
              !isCompleted && !isCurrent && "bg-muted-foreground/30"
            )}
            aria-label={`Step ${index + 1}: ${step}${isCompleted ? ' (completed)' : isCurrent ? ' (current)' : ''}`}
          />
        )
      })}
    </div>
  )
}
