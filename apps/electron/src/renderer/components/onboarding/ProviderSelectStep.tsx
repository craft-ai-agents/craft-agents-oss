import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { Globe, Monitor, Key, Zap } from "lucide-react"
import { ARCHstudioSymbol } from "@/components/icons/ARCHstudioSymbol"
import { StepFormLayout } from "./primitives"
import { ProviderCatalogPicker } from "./ProviderCatalogPicker"
import type { PiProviderEntry } from "./provider-catalog"

import claudeIcon from "@/assets/provider-icons/claude.svg"
import openaiIcon from "@/assets/provider-icons/openai.svg"
import copilotIcon from "@/assets/provider-icons/copilot.svg"

/**
 * The high-level provider choice the user makes on first launch.
 * This maps to one or more ApiSetupMethods downstream.
 */
export type ProviderChoice = 'claude' | 'chatgpt' | 'copilot' | 'api_key' | 'local'

/**
 * Which API-key provider the user picked out of the searchable catalog.
 *
 * Passed as an optional SECOND argument to `onSelect` alongside `'api_key'`.
 * Handlers that only accept `(choice)` stay assignable — TypeScript allows a
 * shorter function where a longer one is expected — so this is additive: today
 * the credential step opens on its default preset, and once the onboarding
 * state machine reads this argument it can pre-select `piAuthProvider`.
 */
export interface ProviderApiKeySelection {
  /** Pi SDK provider id — the `piAuthProvider` / ApiKeyInput preset key, e.g. 'mistral'. */
  provider: string
  /** Human-readable name, e.g. 'Mistral'. */
  label: string
  /** API-key hint for the credential field, e.g. 'sk-...'. */
  placeholder: string
}

/** Connection-type category — used to show a descriptive badge on each card */
type ConnectionType = 'cloud' | 'local'

const CONNECTION_TYPE_CONFIG: Record<ConnectionType, { label: string; icon: React.ReactNode; accent: string }> = {
  'cloud': {
    label: 'Cloud',
    icon: <Globe className="size-2.5" />,
    accent: 'var(--ds-provider-cloud)',
  },
  'local': {
    label: 'Local',
    icon: <Zap className="size-2.5" />,
    accent: 'var(--ds-provider-local)',
  },
}

/** The choices that keep a dedicated card — genuinely different auth paths. */
type PrimaryChoice = Extract<ProviderChoice, 'claude' | 'chatgpt' | 'copilot' | 'local'>

interface ProviderOption {
  id: PrimaryChoice
  name: string
  description: string
  icon: React.ReactNode
  connectionType: ConnectionType
}

const PROVIDER_ICONS: Record<PrimaryChoice, React.ReactNode> = {
  claude: <img src={claudeIcon} alt="" className="size-5 rounded-[3px]" />,
  chatgpt: <img src={openaiIcon} alt="" className="size-5 rounded-[3px]" />,
  copilot: <img src={copilotIcon} alt="" className="size-5 rounded-[3px]" />,
  local: <Monitor className="size-5" />,
}

interface ProviderSelectStepProps {
  /**
   * Called when the user selects a provider.
   *
   * For catalog picks the second argument carries the chosen API-key provider;
   * callers may ignore it and still land on the generic API-key credential step.
   */
  onSelect: (choice: ProviderChoice, apiKeySelection?: ProviderApiKeySelection) => void
  /** Called when the user chooses to skip setup */
  onSkip?: () => void
  /**
   * Override the API-key catalog instead of fetching it over RPC.
   * Only used by the playground and tests.
   */
  providers?: readonly PiProviderEntry[]
}

/**
 * ProviderSelectStep — First screen after install.
 *
 * Subscription / OAuth logins and the local-model path keep dedicated cards.
 * Everything else lives in a searchable picker over the full API-key catalog
 * (`getPiApiKeyProviders()`), so any provider is two keystrokes away instead of
 * being hidden behind a generic "other provider" form.
 */
export function ProviderSelectStep({ onSelect, onSkip, providers }: ProviderSelectStepProps) {
  const { t } = useTranslation()

  const [catalog, setCatalog] = useState<readonly PiProviderEntry[]>(providers ?? [])
  const [isCatalogLoading, setIsCatalogLoading] = useState(!providers)

  useEffect(() => {
    if (providers) {
      setCatalog(providers)
      setIsCatalogLoading(false)
      return
    }

    let cancelled = false
    setIsCatalogLoading(true)

    const load = async () => {
      try {
        const list = await window.electronAPI.getPiApiKeyProviders()
        if (!cancelled) setCatalog(Array.isArray(list) ? list : [])
      } catch (error) {
        console.error('[ProviderSelectStep] Failed to load provider catalog:', error)
        if (!cancelled) setCatalog([])
      } finally {
        if (!cancelled) setIsCatalogLoading(false)
      }
    }
    load()

    return () => { cancelled = true }
  }, [providers])

  // Every catalog pick routes through the existing 'api_key' path so the save
  // logic stays in useOnboarding — the entry just rides along as a hint.
  const handleCatalogSelect = useCallback((entry: PiProviderEntry) => {
    onSelect('api_key', {
      provider: entry.key,
      label: entry.label,
      placeholder: entry.placeholder,
    })
  }, [onSelect])

  const PROVIDER_OPTIONS: ProviderOption[] = [
    {
      id: 'claude',
      name: t("onboarding.providerSelect.claudeProMax"),
      description: t("onboarding.providerSelect.claudeProMaxDesc"),
      icon: PROVIDER_ICONS.claude,
      connectionType: 'cloud',
    },
    {
      id: 'chatgpt',
      name: t("onboarding.providerSelect.codexChatGPT"),
      description: t("onboarding.providerSelect.codexChatGPTDesc"),
      icon: PROVIDER_ICONS.chatgpt,
      connectionType: 'cloud',
    },
    {
      id: 'copilot',
      name: t("onboarding.providerSelect.githubCopilot"),
      description: t("onboarding.providerSelect.githubCopilotDesc"),
      icon: PROVIDER_ICONS.copilot,
      connectionType: 'cloud',
    },
    {
      id: 'local',
      name: t("onboarding.providerSelect.localModel"),
      description: 'Run models locally with Ollama.',
      icon: PROVIDER_ICONS.local,
      connectionType: 'local',
    },
  ]

  return (
    <StepFormLayout
      iconElement={
        <div className="flex size-16 items-center justify-center">
          <ARCHstudioSymbol className="size-10 text-accent" />
        </div>
      }
      title={t("onboarding.providerSelect.title")}
      description={t("onboarding.providerSelect.description")}
    >
      <div className="space-y-2 sm:space-y-3">
        {PROVIDER_OPTIONS.map((option) => (
          <button
            key={option.id}
            onClick={() => onSelect(option.id)}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl bg-foreground-2 p-3 text-left transition-all",
              "sm:items-start sm:gap-4 sm:p-4",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "hover:bg-foreground/[0.02] shadow-minimal",
            )}
          >
            {/* Icon */}
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              {option.icon}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{option.name}</span>
                <span
                  className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium leading-none tracking-wide uppercase"
                  style={{
                    color: CONNECTION_TYPE_CONFIG[option.connectionType].accent,
                    background: `color-mix(in oklch, ${CONNECTION_TYPE_CONFIG[option.connectionType].accent} 10%, transparent)`,
                  }}
                >
                  {CONNECTION_TYPE_CONFIG[option.connectionType].icon}
                  {CONNECTION_TYPE_CONFIG[option.connectionType].label}
                </span>
              </div>
              <p className="mt-0 hidden sm:block text-xs text-muted-foreground">
                {option.description}
              </p>
            </div>
          </button>
        ))}
      </div>

      {/* API-key catalog — searchable, keyboard-first */}
      <div className="mt-5">
        <div className="mb-2 flex items-center gap-2">
          <Key className="size-3 text-muted-foreground" />
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Or bring an API key
          </span>
          <span
            className="h-px flex-1"
            style={{ background: 'color-mix(in oklch, var(--foreground) 8%, transparent)' }}
          />
        </div>
        <ProviderCatalogPicker
          providers={catalog}
          isLoading={isCatalogLoading}
          onSelect={handleCatalogSelect}
        />
      </div>

      {onSkip && (
        <div className="mt-4 text-center">
          <button
            onClick={onSkip}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("onboarding.providerSelect.setupLater")}
          </button>
        </div>
      )}
    </StepFormLayout>
  )
}
