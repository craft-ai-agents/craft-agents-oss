import { cn } from "@/lib/utils"
import { Check, CreditCard, Key, Cpu } from "lucide-react"
import { StepFormLayout, BackButton, ContinueButton } from "./primitives"
import type { LlmAuthType, LlmProviderType } from "@g4os/shared/config/llm-connections"

/**
 * API setup method for onboarding.
 * Maps to specific LlmProviderType + LlmAuthType combinations.
 *
 * - 'claude_oauth' → anthropic + oauth
 * - 'anthropic_api_key' → anthropic + api_key
 * - 'chatgpt_oauth' → openai + oauth
 * - 'openai_api_key' → openai + api_key
 */
export type ApiSetupMethod = 'anthropic_api_key' | 'claude_oauth' | 'chatgpt_oauth' | 'openai_api_key'

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
  }
}

interface ApiSetupOption {
  id: ApiSetupMethod
  name: string
  description: string
  icon: React.ReactNode
  providerType: LlmProviderType
}

const API_SETUP_OPTIONS: ApiSetupOption[] = [
  {
    id: 'claude_oauth',
    name: 'Claude Pro/Max',
    description: 'Use your Claude subscription for unlimited access.',
    icon: <CreditCard className="size-4" />,
    providerType: 'anthropic',
  },
  {
    id: 'anthropic_api_key',
    name: 'Anthropic API Key',
    description: 'Pay-as-you-go via Anthropic, OpenRouter, or compatible APIs.',
    icon: <Key className="size-4" />,
    providerType: 'anthropic',
  },
  {
    id: 'chatgpt_oauth',
    name: 'Codex · ChatGPT Plus/Pro',
    description: 'Use your ChatGPT Plus or Pro subscription with Codex.',
    icon: <Cpu className="size-4" />,
    providerType: 'openai',
  },
  {
    id: 'openai_api_key',
    name: 'Codex · OpenAI API Key',
    description: 'Pay-as-you-go via OpenAI Platform, OpenRouter, or Vercel AI Gateway.',
    icon: <Key className="size-4" />,
    providerType: 'openai',
  },
]

interface APISetupStepProps {
  selectedMethod: ApiSetupMethod | null
  onSelect: (method: ApiSetupMethod) => void
  onContinue: () => void
  onBack: () => void
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
  return (
    <StepFormLayout
      title="Set Up API Connection"
      description="Select how you'd like to power your AI agents."
      actions={
        <>
          <BackButton onClick={onBack} />
          <ContinueButton onClick={onContinue} disabled={!selectedMethod} />
        </>
      }
    >
      {/* Options grouped by provider */}
      <div className="space-y-4">
        {/* Anthropic section */}
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-2 py-2.5 text-center">Anthropic</div>
          <div className="space-y-3">
            {API_SETUP_OPTIONS.filter(o => o.providerType === 'anthropic').map((option) => (
              <OptionButton
                key={option.id}
                option={option}
                isSelected={option.id === selectedMethod}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>

        {/* OpenAI section */}
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-2 py-2.5 text-center">OpenAI</div>
          <div className="space-y-3">
            {API_SETUP_OPTIONS.filter(o => o.providerType === 'openai').map((option) => (
              <OptionButton
                key={option.id}
                option={option}
                isSelected={option.id === selectedMethod}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      </div>
    </StepFormLayout>
  )
}
