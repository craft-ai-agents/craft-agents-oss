import { cn } from "@/lib/utils"
import { Check, CreditCard, Key, Cpu, Cloud } from "lucide-react"
import { StepFormLayout, BackButton, ContinueButton } from "./primitives"
import type { LlmAuthType, LlmProviderType } from "@g4os/shared/config/llm-connections"
import { useLocale } from "@/context/LocaleContext"
import type { TranslationKey } from "@/i18n/locales/en-US"

/**
 * API setup method for onboarding.
 * Maps to specific LlmProviderType + LlmAuthType combinations.
 *
 * - 'claude_oauth' → anthropic + oauth
 * - 'anthropic_api_key' → anthropic + api_key
 * - 'chatgpt_oauth' → openai + oauth
 * - 'openai_api_key' → openai + api_key
 */
export type ApiSetupMethod = 'anthropic_api_key' | 'claude_oauth' | 'chatgpt_oauth' | 'openai_api_key' | 'bedrock_iam'

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
    case 'bedrock_iam':
      return { providerType: 'bedrock', authType: 'iam_credentials' };
  }
}

interface ApiSetupOption {
  id: ApiSetupMethod
  nameKey: TranslationKey
  descriptionKey: TranslationKey
  icon: React.ReactNode
  providerType: LlmProviderType
}

const API_SETUP_OPTIONS: ApiSetupOption[] = [
  {
    id: 'claude_oauth',
    nameKey: 'onboarding.apiSetup.option.claudeOAuth.name',
    descriptionKey: 'onboarding.apiSetup.option.claudeOAuth.description',
    icon: <CreditCard className="size-4" />,
    providerType: 'anthropic',
  },
  {
    id: 'anthropic_api_key',
    nameKey: 'onboarding.apiSetup.option.anthropicApiKey.name',
    descriptionKey: 'onboarding.apiSetup.option.anthropicApiKey.description',
    icon: <Key className="size-4" />,
    providerType: 'anthropic',
  },
  {
    id: 'chatgpt_oauth',
    nameKey: 'onboarding.apiSetup.option.chatgptOAuth.name',
    descriptionKey: 'onboarding.apiSetup.option.chatgptOAuth.description',
    icon: <Cpu className="size-4" />,
    providerType: 'openai',
  },
  {
    id: 'openai_api_key',
    nameKey: 'onboarding.apiSetup.option.openaiApiKey.name',
    descriptionKey: 'onboarding.apiSetup.option.openaiApiKey.description',
    icon: <Key className="size-4" />,
    providerType: 'openai',
  },
  {
    id: 'bedrock_iam',
    nameKey: 'onboarding.apiSetup.option.bedrockIam.name',
    descriptionKey: 'onboarding.apiSetup.option.bedrockIam.description',
    icon: <Cloud className="size-4" />,
    providerType: 'bedrock',
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
  const { t } = useLocale()
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
          <span className="font-medium text-sm">{t(option.nameKey)}</span>
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
  const { t } = useLocale()
  return (
    <StepFormLayout
      title={t('onboarding.apiSetup.title')}
      description={t('onboarding.apiSetup.description')}
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
          <div className="text-xs font-medium text-muted-foreground mb-2 py-2.5 text-center">{t('onboarding.apiSetup.providerAnthropic')}</div>
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
          <div className="text-xs font-medium text-muted-foreground mb-2 py-2.5 text-center">{t('onboarding.apiSetup.providerOpenAI')}</div>
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

        {/* AWS Bedrock section */}
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-2 py-2.5 text-center">{t('onboarding.apiSetup.providerAWS')}</div>
          <div className="space-y-3">
            {API_SETUP_OPTIONS.filter(o => o.providerType === 'bedrock').map((option) => (
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
