import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Check, CreditCard, Key, Zap } from "lucide-react"

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
    icon: <Zap className="size-5" />,
    recommended: true,
  },
  {
    id: 'api_key',
    name: 'Anthropic API Key',
    description: 'Pay-as-you-go with your own API key from console.anthropic.com',
    icon: <Key className="size-5" />,
  },
  {
    id: 'claude_oauth',
    name: 'Claude Pro/Max',
    description: 'Use your Claude subscription for unlimited access.',
    icon: <CreditCard className="size-5" />,
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
    <div className="flex w-full max-w-md flex-col">
      {/* Header */}
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Choose Billing Method
        </h1>
        <p className="mt-2 text-muted-foreground">
          Select how you'd like to pay for AI usage.
        </p>
      </div>

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
                  <span className="font-medium">{option.name}</span>
                  {option.recommended && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      Recommended
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {option.description}
                </p>
              </div>

              {/* Check */}
              <div
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                  isSelected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted-foreground/30"
                )}
              >
                {isSelected && <Check className="size-3" strokeWidth={3} />}
              </div>
            </button>
          )
        })}
      </div>

      {/* Actions */}
      <div className="mt-8 flex gap-3">
        <Button variant="ghost" onClick={onBack} className="flex-1">
          Back
        </Button>
        <Button
          onClick={onContinue}
          disabled={!selectedMethod}
          className="flex-1"
        >
          Continue
        </Button>
      </div>
    </div>
  )
}
