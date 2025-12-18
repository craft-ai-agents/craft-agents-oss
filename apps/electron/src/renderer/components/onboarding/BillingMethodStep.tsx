import { cn } from "@/lib/utils"
import { Check, CreditCard, Key, Zap } from "lucide-react"
import { StepFormLayout, BackButton, ContinueButton } from "./primitives"

export type BillingMethod = 'craft_credits' | 'api_key' | 'claude_oauth'

interface BillingOption {
  id: BillingMethod
  name: string
  description: string
  icon: React.ReactNode
  recommended?: boolean
}

const BILLING_OPTIONS: BillingOption[] = [
  {
    id: 'craft_credits',
    name: 'Craft Credits',
    description: 'Use your Craft subscription credits. No additional setup needed.',
    icon: <Zap className="size-4" />,
    recommended: true,
  },
  {
    id: 'api_key',
    name: 'Anthropic API Key',
    description: 'Pay-as-you-go with your own API key from console.anthropic.com',
    icon: <Key className="size-4" />,
  },
  {
    id: 'claude_oauth',
    name: 'Claude Pro/Max',
    description: 'Use your Claude subscription for unlimited access.',
    icon: <CreditCard className="size-4" />,
  },
]

interface BillingMethodStepProps {
  selectedMethod: BillingMethod | null
  onSelect: (method: BillingMethod) => void
  onContinue: () => void
  onBack: () => void
}

/**
 * BillingMethodStep - Choose how to pay for AI usage
 *
 * Three options:
 * - Craft Credits (recommended) - Uses Craft subscription
 * - API Key - Pay-as-you-go via Anthropic
 * - Claude Pro/Max - Uses Claude subscription
 */
export function BillingMethodStep({
  selectedMethod,
  onSelect,
  onContinue,
  onBack
}: BillingMethodStepProps) {
  return (
    <StepFormLayout
      title="Choose Billing Method"
      description="Select how you'd like to pay for AI usage."
      actions={
        <>
          <BackButton onClick={onBack} />
          <ContinueButton onClick={onContinue} disabled={!selectedMethod} />
        </>
      }
    >
      {/* Options */}
      <div className="space-y-3">
        {BILLING_OPTIONS.map((option) => {
          const isSelected = option.id === selectedMethod

          return (
            <button
              key={option.id}
              onClick={() => onSelect(option.id)}
              className={cn(
                "flex w-full items-start gap-4 rounded-xl border p-4 text-left transition-all",
                "hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-border"
              )}
            >
              {/* Icon */}
              <div
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-lg",
                  isSelected ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                )}
              >
                {option.icon}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{option.name}</span>
                  {option.recommended && (
                    <span className="bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary/70">
                      Recommended
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {option.description}
                </p>
              </div>

              {/* Check */}
              <div
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                  isSelected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted-foreground/20"
                )}
              >
                {isSelected && <Check className="size-3" strokeWidth={3} />}
              </div>
            </button>
          )
        })}
      </div>
    </StepFormLayout>
  )
}
