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

import { useState, useMemo, useEffect } from "react"
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

export type ApiKeyStatus = 'idle' | 'validating' | 'success' | 'error'

export interface ApiKeySubmitData {
  apiKey: string
  baseUrl?: string
  connectionDefaultModel?: string
  models?: string[]
  piAuthProvider?: string
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
  providerType?: 'anthropic' | 'openai' | 'pi' | 'google' | 'pi_api_key'
  /** Pre-fill values when editing an existing connection */
  initialValues?: {
    apiKey?: string
    baseUrl?: string
    connectionDefaultModel?: string
    activePreset?: string
  }
}

// Preset key — string to support dynamic Pi SDK providers
type PresetKey = string

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
// Only direct OpenAI is supported; 3PP providers (OpenRouter, Vercel, Ollama) should be
// configured via the Anthropic/Claude connection which routes through the Claude Agent SDK.
const OPENAI_PRESETS: Preset[] = [
  { key: 'openai', label: 'OpenAI', url: '' },
]

// Pi provider presets - unified API for 20+ LLM providers
const PI_PRESETS: Preset[] = [
  { key: 'pi', label: 'Pi (Direct)', url: '' },
  { key: 'openrouter', label: 'OpenRouter', url: 'https://openrouter.ai/api' },
  { key: 'ollama', label: 'Ollama', url: 'http://localhost:11434' },
  { key: 'custom', label: 'Custom', url: '' },
]

// Google AI Studio preset - single endpoint, no custom URL needed
const GOOGLE_PRESETS: Preset[] = [
  { key: 'google', label: 'Google AI Studio', url: '' },
]

// Pi API Key provider presets — loaded async via IPC from main process
// (Pi SDK can't run in renderer due to @aws-sdk/client-bedrock-runtime → Node.js stream)
const PI_API_KEY_FALLBACK: Preset[] = [{ key: 'custom', label: 'Custom', url: '' }]

const COMPAT_ANTHROPIC_DEFAULTS = 'anthropic/claude-opus-4.6, anthropic/claude-sonnet-4.5, anthropic/claude-haiku-4.5'
const COMPAT_OPENAI_DEFAULTS = 'openai/gpt-5.2-codex, openai/gpt-5.1-codex-mini'

function getPresetsForProvider(providerType: 'anthropic' | 'openai' | 'pi' | 'google' | 'pi_api_key', piApiKeyPresets?: Preset[]): Preset[] {
  if (providerType === 'pi_api_key') return piApiKeyPresets ?? PI_API_KEY_FALLBACK
  if (providerType === 'google') return GOOGLE_PRESETS
  if (providerType === 'pi') return PI_PRESETS
  return providerType === 'openai' ? OPENAI_PRESETS : ANTHROPIC_PRESETS
}

function getPresetForUrl(url: string, presets: Preset[]): PresetKey {
  const match = presets.find(p => p.key !== 'custom' && p.url === url)
  return match?.key ?? 'custom'
}

function parseModelList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export function ApiKeyInput({
  status,
  errorMessage,
  onSubmit,
  formId = "api-key-form",
  disabled,
  providerType = 'anthropic',
  initialValues,
}: ApiKeyInputProps) {
  // Pi API key providers loaded async from main process via IPC
  const [piApiKeyPresets, setPiApiKeyPresets] = useState<Preset[] | undefined>(undefined)
  const [piProviderInfoMap, setPiProviderInfoMap] = useState<Map<string, { placeholder: string }>>(new Map())

  useEffect(() => {
    if (providerType !== 'pi_api_key') return
    let cancelled = false
    ;(async () => {
      const providers = await window.electronAPI.getPiApiKeyProviders()
      if (cancelled) return
      // Build presets with base URLs
      const presetPromises = providers.map(async (p) => ({
        key: p.key,
        label: p.label,
        url: (await window.electronAPI.getPiProviderBaseUrl(p.key)) ?? '',
      }))
      const presets = await Promise.all(presetPromises)
      if (cancelled) return
      presets.push({ key: 'custom', label: 'Custom', url: '' })
      setPiApiKeyPresets(presets)
      setPiProviderInfoMap(new Map(providers.map(p => [p.key, { placeholder: p.placeholder }])))
    })()
    return () => { cancelled = true }
  }, [providerType])

  // Get presets based on provider type
  const presets = getPresetsForProvider(providerType, piApiKeyPresets)
  const defaultPreset = presets[0]

  // Compute initial preset: explicit (Pi piAuthProvider), derived from URL, or default
  const initialPreset = initialValues?.activePreset
    ?? (initialValues?.baseUrl ? getPresetForUrl(initialValues.baseUrl, presets) : defaultPreset.key)

  const [apiKey, setApiKey] = useState(initialValues?.apiKey ?? '')
  const [showValue, setShowValue] = useState(false)
  const [baseUrl, setBaseUrl] = useState(initialValues?.baseUrl ?? defaultPreset.url)
  const [activePreset, setActivePreset] = useState<PresetKey>(initialPreset)
  const [connectionDefaultModel, setConnectionDefaultModel] = useState(initialValues?.connectionDefaultModel ?? '')
  const [modelError, setModelError] = useState<string | null>(null)

  const isDisabled = disabled || status === 'validating'

  // Determine if we're using the default provider preset (hide base URL field)
  const isPiApiKeyFlow = providerType === 'pi_api_key'
  // For Pi API key flow, always show baseUrl field; model field only for Custom
  const isDefaultProviderPreset = !isPiApiKeyFlow
    && (activePreset === 'anthropic' || activePreset === 'openai' || activePreset === 'pi' || activePreset === 'google')
  // Known Pi SDK providers have models in the registry — no need for manual model input
  const isPiKnownProvider = isPiApiKeyFlow && activePreset !== 'custom'

  // Provider-specific placeholders — from IPC-loaded data for Pi, static for others
  const piProviderInfo = useMemo(
    () => isPiApiKeyFlow ? piProviderInfoMap.get(activePreset) : undefined,
    [isPiApiKeyFlow, activePreset, piProviderInfoMap],
  )
  const apiKeyPlaceholder = piProviderInfo?.placeholder
    ?? (providerType === 'google' ? 'AIza...'
    : providerType === 'pi' ? 'pi-...'
    : providerType === 'openai' ? 'sk-...'
    : 'sk-ant-...')

  const handlePresetSelect = (preset: Preset) => {
    setActivePreset(preset.key)
    if (preset.key === 'custom') {
      setBaseUrl('')
    } else {
      setBaseUrl(preset.url)
    }
    setModelError(null)
    // Pre-fill recommended model for Ollama; clear for all others
    // (Default provider presets hide the field entirely, others default to provider model IDs when empty)
    if (preset.key === 'ollama') {
      setConnectionDefaultModel('qwen3-coder')
    } else if (preset.key === 'openrouter' || preset.key === 'vercel') {
      setConnectionDefaultModel(providerType === 'openai' ? COMPAT_OPENAI_DEFAULTS : COMPAT_ANTHROPIC_DEFAULTS)
    } else if (preset.key === 'custom') {
      // Pi API key "Custom" — user must specify model; non-Pi flows pre-fill defaults
      setConnectionDefaultModel(isPiApiKeyFlow ? '' : (providerType === 'openai' ? COMPAT_OPENAI_DEFAULTS : COMPAT_ANTHROPIC_DEFAULTS))
    } else {
      setConnectionDefaultModel('')
    }
  }

  const handleBaseUrlChange = (value: string) => {
    setBaseUrl(value)
    const presetKey = getPresetForUrl(value, presets)
    setActivePreset(presetKey)
    setModelError(null)
    if (!connectionDefaultModel.trim() && !isPiApiKeyFlow) {
      if (presetKey === 'ollama') {
        setConnectionDefaultModel('qwen3-coder')
      } else if (presetKey === 'openrouter' || presetKey === 'vercel' || presetKey === 'custom') {
        setConnectionDefaultModel(providerType === 'openai' ? COMPAT_OPENAI_DEFAULTS : COMPAT_ANTHROPIC_DEFAULTS)
      }
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Always call onSubmit — the hook decides whether an empty key is valid
    // (custom endpoints like Ollama don't require API keys)
    const effectiveBaseUrl = baseUrl.trim()
    const parsedModels = parseModelList(connectionDefaultModel)

    // For Pi API key: known providers use Pi SDK routing (baseUrl is display-only),
    // only "Custom" passes a baseUrl and requires a model
    const isUsingDefaultEndpoint = isDefaultProviderPreset || isPiKnownProvider || !effectiveBaseUrl
    const requiresModel = !isDefaultProviderPreset && !isPiKnownProvider && !!effectiveBaseUrl
    if (requiresModel && parsedModels.length === 0) {
      setModelError('Default model is required for custom endpoints.')
      return
    }

    onSubmit({
      apiKey: apiKey.trim(),
      baseUrl: isUsingDefaultEndpoint ? undefined : effectiveBaseUrl,
      connectionDefaultModel: parsedModels[0],
      models: parsedModels.length > 0 ? parsedModels : undefined,
      piAuthProvider: isPiApiKeyFlow && activePreset !== 'custom' ? activePreset : undefined,
    })
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="space-y-6">
      {/* API Key */}
      <div className="space-y-2">
        <Label htmlFor="api-key">API Key</Label>
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

      {/* Endpoint/Provider Preset Selector - hidden when only one preset (e.g. Codex/OpenAI direct) */}
      {presets.length > 1 && (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="base-url">Endpoint</Label>
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
      )}

      {/* Default Model — hidden for providers with built-in model routing (standard presets + known Pi SDK providers) */}
      {!isDefaultProviderPreset && !isPiKnownProvider && (
        <div className="space-y-2">
          <Label htmlFor="connection-default-model" className="text-muted-foreground font-normal">
            Default Model{' '}
            <span className="text-foreground/30">
              · {(!isDefaultProviderPreset && !(isPiApiKeyFlow && activePreset !== 'custom') && baseUrl.trim()) ? 'required' : 'optional'}
            </span>
          </Label>
          <div className={cn(
            "rounded-md shadow-minimal transition-colors",
            "bg-foreground-2 focus-within:bg-background",
            modelError && "ring-1 ring-destructive/40"
          )}>
            <Input
              id="connection-default-model"
              type="text"
              value={connectionDefaultModel}
              onChange={(e) => {
                setConnectionDefaultModel(e.target.value)
                setModelError(null)
              }}
              placeholder={isPiApiKeyFlow ? "e.g. claude-sonnet-4-5, gpt-4o" : providerType === 'openai' ? "e.g. openai/gpt-5.2-codex, openai/gpt-5.1-codex-mini" : "e.g. anthropic/claude-opus-4.6, anthropic/claude-haiku-4.5"}
              className="border-0 bg-transparent shadow-none"
              disabled={isDisabled}
            />
          </div>
          {modelError && (
            <p className="text-xs text-destructive">{modelError}</p>
          )}
          <p className="text-xs text-foreground/30">
            Comma-separated list. The first model is the default. The last is used for summarization.
          </p>
          {/* Contextual help links for providers that need model format guidance */}
          {activePreset === 'openrouter' && (
            <p className="text-xs text-foreground/30">
              Required for OpenRouter-compatible endpoints.
              <br />
              Format: <code className="text-foreground/40">provider/model-name</code>.{' '}
              <a href="https://openrouter.ai/models" target="_blank" rel="noopener noreferrer" className="text-foreground/50 underline hover:text-foreground/70">
                Browse models
              </a>
            </p>
          )}
          {activePreset === 'vercel' && (
            <p className="text-xs text-foreground/30">
              Required for Vercel AI Gateway endpoints.
              <br />
              Format: <code className="text-foreground/40">provider/model-name</code>.{' '}
              <a href="https://vercel.com/docs/ai-gateway" target="_blank" rel="noopener noreferrer" className="text-foreground/50 underline hover:text-foreground/70">
                View supported models
              </a>
            </p>
          )}
          {activePreset === 'ollama' && (
            <p className="text-xs text-foreground/30">
              Use any model pulled via <code className="text-foreground/40">ollama pull</code>. No API key required.
            </p>
          )}
          {isPiApiKeyFlow && activePreset === 'custom' && (
            <p className="text-xs text-foreground/30">
              Required for custom endpoints. Use the model ID supported by your endpoint.
            </p>
          )}
          {isPiApiKeyFlow && activePreset !== 'custom' && (
            <p className="text-xs text-foreground/30">
              Optional. Leave empty to use the provider's default model.
            </p>
          )}
          {!isPiApiKeyFlow && (activePreset === 'custom' || !activePreset) && (
            <p className="text-xs text-foreground/30">
              Required for custom endpoints. Use the provider-specific model ID.
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
