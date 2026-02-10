/**
 * ApiKeyInput - Reusable API key entry form control
 *
 * Renders a password input for the API key, a preset selector for Base URL,
 * and an optional Model override field.
 *
 * Does NOT include layout wrappers or action buttons — the parent
 * controls placement via the form ID ("api-key-form") for submit binding.
 *
 * Used in: Onboarding CredentialsStep, Settings API dialog
 */

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
} from "@/components/ui/styled-dropdown"
import { cn } from "@/lib/utils"
import { Check, ChevronDown, Eye, EyeOff } from "lucide-react"
import { useLocale } from "@/context/LocaleContext"

export type ApiKeyStatus = 'idle' | 'validating' | 'success' | 'error'

export interface ApiKeySubmitData {
  apiKey: string
  baseUrl?: string
  customModel?: string
}

export interface ApiKeyInputProps {
  /** Current validation status */
  status: ApiKeyStatus
  /** Error message to display when status is 'error' */
  errorMessage?: string
  /** Called when the form is submitted with the key and optional endpoint config */
  onSubmit: (data: ApiKeySubmitData) => void
  /** Form ID for external submit button binding (default: "api-key-form") */
  formId?: string
  /** Disable the input (e.g. during validation) */
  disabled?: boolean
  /** Provider type determines which presets and placeholders to show */
  providerType?: 'anthropic' | 'openai'
}

// Preset key includes both provider defaults ('anthropic', 'openai') and third-party services
type PresetKey = 'anthropic' | 'openai' | 'openrouter' | 'vercel' | 'ollama' | 'custom'

interface Preset {
  key: PresetKey
  label: string
  url: string
}

// Anthropic provider presets - for Claude Code backend
const ANTHROPIC_PRESETS: Preset[] = [
  { key: 'anthropic', label: 'Anthropic', url: 'https://api.anthropic.com' },
  { key: 'openrouter', label: 'OpenRouter', url: 'https://openrouter.ai/api' },
  { key: 'vercel', label: 'Vercel AI Gateway', url: 'https://ai-gateway.vercel.sh' },
  { key: 'ollama', label: 'Ollama', url: 'http://localhost:11434' },
  { key: 'custom', label: 'Custom', url: '' },
]

// OpenAI provider presets - for Codex backend
// Empty URL for 'openai' means use the default OpenAI API endpoint
const OPENAI_PRESETS: Preset[] = [
  { key: 'openai', label: 'OpenAI', url: '' },
  { key: 'openrouter', label: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
  { key: 'vercel', label: 'Vercel AI Gateway', url: 'https://gateway.ai.vercel.sh/v1' },
  { key: 'custom', label: 'Custom', url: '' },
]

function getPresetsForProvider(providerType: 'anthropic' | 'openai'): Preset[] {
  return providerType === 'openai' ? OPENAI_PRESETS : ANTHROPIC_PRESETS
}

function getPresetForUrl(url: string, presets: Preset[]): PresetKey {
  const match = presets.find(p => p.key !== 'custom' && p.url === url)
  return match?.key ?? 'custom'
}

export function ApiKeyInput({
  status,
  errorMessage,
  onSubmit,
  formId = "api-key-form",
  disabled,
  providerType = 'anthropic',
}: ApiKeyInputProps) {
  const { t } = useLocale()
  // Get presets based on provider type
  const presets = getPresetsForProvider(providerType)
  const defaultPreset = presets[0]

  const [apiKey, setApiKey] = useState('')
  const [showValue, setShowValue] = useState(false)
  const [baseUrl, setBaseUrl] = useState(defaultPreset.url)
  const [activePreset, setActivePreset] = useState<PresetKey>(defaultPreset.key)
  const [customModel, setCustomModel] = useState('')

  const isDisabled = disabled || status === 'validating'

  // Determine if we're using the default provider preset (hide base URL field)
  const isDefaultProviderPreset = activePreset === 'anthropic' || activePreset === 'openai'

  // Provider-specific placeholders
  const apiKeyPlaceholder = providerType === 'openai' ? 'sk-...' : 'sk-ant-...'

  const handlePresetSelect = (preset: Preset) => {
    setActivePreset(preset.key)
    if (preset.key === 'custom') {
      setBaseUrl('')
    } else {
      setBaseUrl(preset.url)
    }
    // Pre-fill recommended model for Ollama; clear for all others
    // (Default provider presets hide the field entirely, others default to provider model IDs when empty)
    if (preset.key === 'ollama') {
      setCustomModel('qwen3-coder')
    } else {
      setCustomModel('')
    }
  }

  const handleBaseUrlChange = (value: string) => {
    setBaseUrl(value)
    setActivePreset(getPresetForUrl(value, presets))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Always call onSubmit — the hook decides whether an empty key is valid
    // (custom endpoints like Ollama don't require API keys)
    const effectiveBaseUrl = baseUrl.trim()
    // For default provider presets, don't pass a baseUrl (use provider's default)
    const isDefault = isDefaultProviderPreset || !effectiveBaseUrl
    onSubmit({
      apiKey: apiKey.trim(),
      baseUrl: isDefault ? undefined : effectiveBaseUrl,
      customModel: customModel.trim() || undefined,
    })
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="space-y-6">
      {/* API Key */}
      <div className="space-y-2">
        <Label htmlFor="api-key">{t('apiSetup.apiKey.label')}</Label>
        <div className={cn(
          "relative rounded-md shadow-minimal transition-colors",
          "bg-foreground-2 focus-within:bg-background"
        )}>
          <Input
            id="api-key"
            type={showValue ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={apiKeyPlaceholder}
            className={cn(
              "pr-10 border-0 bg-transparent shadow-none",
              status === 'error' && "focus-visible:ring-destructive"
            )}
            disabled={isDisabled}
            autoFocus
          />
          <button
            type="button"
            onClick={() => setShowValue(!showValue)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            tabIndex={-1}
          >
            {showValue ? (
              <EyeOff className="size-4" />
            ) : (
              <Eye className="size-4" />
            )}
          </button>
        </div>
      </div>

      {/* Endpoint Preset Selector - always visible to allow switching between providers */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="base-url">{t('apiSetup.apiKey.endpoint')}</Label>
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={isDisabled}
              className="flex h-6 items-center gap-1 rounded-[6px] bg-background shadow-minimal pl-2.5 pr-2 text-[12px] font-medium text-foreground/50 hover:bg-foreground/5 hover:text-foreground focus:outline-none"
            >
              {presets.find(p => p.key === activePreset)?.label}
              <ChevronDown className="size-2.5 opacity-50" />
            </DropdownMenuTrigger>
            <StyledDropdownMenuContent align="end" className="z-floating-menu">
              {presets.map((preset) => (
                <StyledDropdownMenuItem
                  key={preset.key}
                  onClick={() => handlePresetSelect(preset)}
                  className="justify-between"
                >
                  {preset.label}
                  <Check className={cn("size-3", activePreset === preset.key ? "opacity-100" : "opacity-0")} />
                </StyledDropdownMenuItem>
              ))}
            </StyledDropdownMenuContent>
          </DropdownMenu>
        </div>
        {/* Base URL input - hidden for default provider presets (Anthropic/OpenAI) */}
        {!isDefaultProviderPreset && (
          <div className={cn(
            "rounded-md shadow-minimal transition-colors",
            "bg-foreground-2 focus-within:bg-background"
          )}>
            <Input
              id="base-url"
              type="text"
              value={baseUrl}
              onChange={(e) => handleBaseUrlChange(e.target.value)}
              placeholder="https://your-api-endpoint.com"
              className="border-0 bg-transparent shadow-none"
              disabled={isDisabled}
            />
          </div>
        )}
      </div>

      {/* Custom Model (optional) — hidden for default provider presets since they use their own model routing */}
      {!isDefaultProviderPreset && (
        <div className="space-y-2">
          <Label htmlFor="custom-model" className="text-muted-foreground font-normal">
            {t('apiSetup.apiKey.model')} <span className="text-foreground/30">· {t('apiSetup.apiKey.modelOptional')}</span>
          </Label>
          <div className={cn(
            "rounded-md shadow-minimal transition-colors",
            "bg-foreground-2 focus-within:bg-background"
          )}>
            <Input
              id="custom-model"
              type="text"
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              placeholder={providerType === 'openai' ? "e.g. gpt-4.1, o3" : "e.g. openai/gpt-5, qwen3-coder"}
              className="border-0 bg-transparent shadow-none"
              disabled={isDisabled}
            />
          </div>
          {/* Contextual help links for providers that need model format guidance */}
          {activePreset === 'openrouter' && (
            <p className="text-xs text-foreground/30">
              {providerType === 'openai'
                ? t('apiSetup.apiKey.openrouter.hint.openai')
                : t('apiSetup.apiKey.openrouter.hint.anthropic')}
              <br />
              Format: <code className="text-foreground/40">provider/model-name</code>.{' '}
              <a href="https://openrouter.ai/models" target="_blank" rel="noopener noreferrer" className="text-foreground/50 underline hover:text-foreground/70">
                {t('apiSetup.apiKey.openrouter.browseModels')}
              </a>
            </p>
          )}
          {activePreset === 'vercel' && (
            <p className="text-xs text-foreground/30">
              {providerType === 'openai'
                ? t('apiSetup.apiKey.vercel.hint.openai')
                : t('apiSetup.apiKey.vercel.hint.anthropic')}
              <br />
              Format: <code className="text-foreground/40">provider/model-name</code>.{' '}
              <a href="https://vercel.com/docs/ai-gateway" target="_blank" rel="noopener noreferrer" className="text-foreground/50 underline hover:text-foreground/70">
                {t('apiSetup.apiKey.vercel.viewModels')}
              </a>
            </p>
          )}
          {activePreset === 'ollama' && (
            <p className="text-xs text-foreground/30">
              {t('apiSetup.apiKey.ollama.hint')}
            </p>
          )}
          {(activePreset === 'custom' || !activePreset) && (
            <p className="text-xs text-foreground/30">
              {providerType === 'openai'
                ? t('apiSetup.apiKey.custom.hint.openai')
                : t('apiSetup.apiKey.custom.hint.anthropic')}
            </p>
          )}
        </div>
      )}

      {/* Error message */}
      {status === 'error' && errorMessage && (
        <p className="text-sm text-destructive">{errorMessage}</p>
      )}
    </form>
  )
}
