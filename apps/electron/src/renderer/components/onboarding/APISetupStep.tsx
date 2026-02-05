import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { Check, CreditCard, Key } from "lucide-react"
import { StepFormLayout, BackButton, ContinueButton } from "./primitives"

export type ApiSetupMethod = 'api_key' | 'claude_oauth'

interface ApiSetupOption {
  id: ApiSetupMethod
  nameKey: string
  descriptionKey: string
  icon: React.ReactNode
  recommended?: boolean
}

const API_SETUP_OPTIONS: ApiSetupOption[] = [
  {
    id: 'claude_oauth',
    nameKey: 'onboarding.claudeProMax',
    descriptionKey: 'onboarding.claudeProMaxDesc',
    icon: <CreditCard className="size-4" />,
    recommended: true,
  },
  {
    id: 'api_key',
    nameKey: 'onboarding.apiKey',
    descriptionKey: 'onboarding.apiKeyDesc',
    icon: <Key className="size-4" />,
  },
]

interface APISetupStepProps {
  selectedMethod: ApiSetupMethod | null
  onSelect: (method: ApiSetupMethod) => void
  onContinue: () => void
  onBack: () => void
}

/**
 * APISetupStep - Choose how to connect your AI agents
 *
 * Two options:
 * - Claude Pro/Max (recommended) - Uses Claude subscription
 * - API Key - Pay-as-you-go via Anthropic
 */
export function APISetupStep({
  selectedMethod,
  onSelect,
  onContinue,
  onBack
}: APISetupStepProps) {
  const { t } = useTranslation()

  return (
    <StepFormLayout
      title={t('onboarding.setupApiConnection')}
      description={t('onboarding.selectPowerMethod')}
      actions={
        <>
          <BackButton onClick={onBack} />
          <ContinueButton onClick={onContinue} disabled={!selectedMethod} />
        </>
      }
    >
      {/* Options */}
      <div className="space-y-3">
        {API_SETUP_OPTIONS.map((option) => {
          const isSelected = option.id === selectedMethod

          return (
            <button
              key={option.id}
              onClick={() => onSelect(option.id)}
              className={cn(
                "flex w-full items-start gap-4 rounded-xl p-4 text-left transition-all",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "hover:bg-foreground/[0.02] shadow-minimal",
                isSelected
                  ? "bg-background"
                  : "bg-foreground-2"
              )}
            >
              {/* Icon */}
              <div
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-lg",
                  isSelected ? "bg-foreground/10 text-foreground" : "bg-muted text-muted-foreground"
                )}
              >
                {option.icon}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{t(option.nameKey)}</span>
                  {option.recommended && (
                    <span className="rounded-[4px] bg-background shadow-minimal px-2 py-0.5 text-[11px] font-medium text-foreground/70">
                      {t('common.recommended')}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t(option.descriptionKey)}
                </p>
              </div>

              {/* Check */}
              <div
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                  isSelected
                    ? "border-foreground bg-foreground text-background"
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
