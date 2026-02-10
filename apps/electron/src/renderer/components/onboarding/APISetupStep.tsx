import { useState } from "react"
import { cn } from "@/lib/utils"
import { Check, CreditCard, Key, Cpu } from "lucide-react"
import { StepFormLayout, BackButton, ContinueButton } from "./primitives"
import type { TFunction } from "i18next"
import { useTranslation } from "react-i18next"
import { getApiSetupLabels } from './labels'

/** Provider segment for the segmented control */
export type ProviderSegment = 'anthropic' | 'openai' | 'copilot'

const SEGMENT_LABELS: Record<ProviderSegment, string> = {
  anthropic: 'Claude',
  openai: 'Codex',
  copilot: 'GitHub Copilot',
}

const BetaBadge = () => (
  <span className="inline px-1.5 pt-[2px] pb-[3px] text-[10px] font-accent font-bold rounded-[4px] bg-accent text-background ml-1 relative -top-[1px]">
    Beta
  </span>
)

const SEGMENT_DESCRIPTIONS: Record<ProviderSegment, React.ReactNode> = {
  anthropic: <>Use Claude Agent SDK as the main agent.<br />Configure with your Claude subscription or API key.</>,
  openai: <>Use Codex CLI as the main agent.<BetaBadge /><br />Configure with your ChatGPT subscription or OpenAI API key.</>,
  copilot: <>Use Copilot Agent as the main agent.<BetaBadge /><br />Configure with your GitHub Copilot subscription.</>,
}

/**
 * API setup method for onboarding.
 * Maps to specific LlmProviderType + LlmAuthType combinations.
 *
 * - 'claude_oauth' → anthropic + oauth
 * - 'anthropic_api_key' → anthropic + api_key
 * - 'chatgpt_oauth' → openai + oauth
 * - 'openai_api_key' → openai + api_key
 */
export type ApiSetupMethod = 'anthropic_api_key' | 'claude_oauth' | 'chatgpt_oauth' | 'openai_api_key' | 'copilot_oauth'

/**
 * Map ApiSetupMethod to the underlying LLM connection types.
 */
export function apiSetupMethodToConnectionTypes(method: ApiSetupMethod): {
  providerType: LlmProviderType;
  authType: LlmAuthType;
} {
  switch (method) {
    case 'claude_oauth':
      return { providerType: 'anthropic', authType: 'oauth' };
    case 'anthropic_api_key':
      return { providerType: 'anthropic', authType: 'api_key' };
    case 'chatgpt_oauth':
      return { providerType: 'openai', authType: 'oauth' };
    case 'openai_api_key':
      return { providerType: 'openai', authType: 'api_key' };
    case 'copilot_oauth':
      return { providerType: 'copilot', authType: 'oauth' };
  }
}

interface ApiSetupOption {
  id: ApiSetupMethod
  name: string
  description: string
  icon: React.ReactNode
  providerType: LlmProviderType
}

function getApiSetupOptions(t: TFunction): ApiSetupOption[] {
  return [
    {
      id: 'claude_oauth',
      name: t('onboarding:apiSetup.options.claude.name'),
      description: t('onboarding:apiSetup.options.claude.description'),
      icon: <CreditCard className="size-4" />,
      recommended: true,
    },
    {
      id: 'api_key',
      name: t('onboarding:apiSetup.options.apiKey.name'),
      description: t('onboarding:apiSetup.options.apiKey.description'),
      icon: <Key className="size-4" />,
    },
  ]
}

interface APISetupStepProps {
  selectedMethod: ApiSetupMethod | null
  onSelect: (method: ApiSetupMethod) => void
  onContinue: () => void
  onBack: () => void
  /** Initial segment to show (defaults to 'anthropic') */
  initialSegment?: ProviderSegment
}

/**
 * Individual option button component
 */
function OptionButton({
  option,
  isSelected,
  onSelect,
}: {
  option: ApiSetupOption
  isSelected: boolean
  onSelect: (method: ApiSetupMethod) => void
}) {
  return (
    <button
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
          <span className="font-medium text-sm">{option.name}</span>
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
            ? "border-foreground bg-foreground text-background"
            : "border-muted-foreground/20"
        )}
      >
        {isSelected && <Check className="size-3" strokeWidth={3} />}
      </div>
    </button>
  )
}

/**
 * Segmented control for provider selection
 */
function ProviderSegmentedControl({
  activeSegment,
  onSegmentChange,
}: {
  activeSegment: ProviderSegment
  onSegmentChange: (segment: ProviderSegment) => void
}) {
  const segments: ProviderSegment[] = ['anthropic', 'openai', 'copilot']

  return (
    <div className="flex rounded-xl bg-foreground/[0.03] p-1 mb-4">
      {segments.map((segment) => (
        <button
          key={segment}
          onClick={() => onSegmentChange(segment)}
          className={cn(
            "flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-all",
            activeSegment === segment
              ? "bg-background shadow-minimal text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {SEGMENT_LABELS[segment]}
        </button>
      ))}
    </div>
  )
}

/**
 * APISetupStep - Choose how to connect your AI agents
 *
 * Features a segmented control to filter by provider:
 * - Anthropic - Claude Pro/Max or API Key
 * - OpenAI - ChatGPT Plus/Pro or API Key
 * - GitHub Copilot - Copilot subscription
 */
export function APISetupStep({
  selectedMethod,
  onSelect,
  onContinue,
  onBack,
  initialSegment = 'anthropic',
}: APISetupStepProps) {
  const { t } = useTranslation(['onboarding'])
  const options = getApiSetupOptions(t)
  const labels = getApiSetupLabels(t)
  return (
    <StepFormLayout
      title={labels.title}
      description={labels.description}
      actions={
        <>
          <BackButton onClick={onBack}>{labels.back}</BackButton>
          <ContinueButton onClick={onContinue} disabled={!selectedMethod}>{labels.continue}</ContinueButton>
        </>
      }
    >
      {/* Options */}
      <div className="space-y-3">
        {options.map((option) => {
          const isSelected = option.id === selectedMethod

          return (
            <button
              key={option.id}
              type="button"
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
                  <span className="font-medium text-sm">{option.name}</span>
                  {option.recommended && (
                    <span className="rounded-[4px] bg-background shadow-minimal px-2 py-0.5 text-[11px] font-medium text-foreground/70">
                      {labels.recommended}
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
