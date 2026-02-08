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

import { useEffect, useState } from "react"
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
  /** Optional prefilled API key (used when editing existing settings) */
  initialApiKey?: string
  /** Optional prefilled base URL (used when editing existing settings) */
  initialBaseUrl?: string
  /** Optional prefilled custom model (used when editing existing settings) */
  initialCustomModel?: string
}

type PresetKey = 'anthropic' | 'openrouter' | 'vercel' | 'ollama' | 'idea' | 'custom'

interface Preset {
  key: PresetKey
  label: string
  url: string
}

// Import and re-export IDEA constants from shared package
import { IDEA_BASE_URL, IDEA_API_KEY } from "@craft-agent/shared/config/config-defaults-schema"
export { IDEA_BASE_URL, IDEA_API_KEY }


const PRESETS: Preset[] = [
  { key: 'anthropic', label: 'Anthropic', url: 'https://api.anthropic.com' },
  { key: 'openrouter', label: 'OpenRouter', url: 'https://openrouter.ai/api' },
  { key: 'vercel', label: 'Vercel AI Gateway', url: 'https://ai-gateway.vercel.sh' },
  { key: 'ollama', label: 'Ollama', url: 'http://localhost:11434' },
  { key: 'idea', label: 'ByteDance IDEA', url: IDEA_BASE_URL },
  { key: 'custom', label: 'Custom', url: '' },
]

export const IDEA_MODELS = [
  { id: 'kimi-k2.5', name: 'Kimi K2.5', description: 'Default' },
  { id: 'gemini-3-flash-priority-new', name: 'Gemini 3 Flash', description: 'Fast' },
  { id: 'gemini-3-pro-priority-new', name: 'Gemini 3 Pro', description: 'High quality' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Stable' },
  { id: 'gpt-5', name: 'GPT-5', description: 'OpenAI latest' },
  { id: 'gpt-5-high', name: 'GPT-5 High', description: 'Higher quality' },
  { id: 'gpt-5-medium', name: 'GPT-5 Medium', description: 'Balanced' },
  { id: 'gpt-5-low', name: 'GPT-5 Low', description: 'Fast' },
  { id: 'gpt-5-codex', name: 'GPT-5 Codex', description: 'Code optimized' },
  { id: 'gpt-4o', name: 'GPT-4o', description: 'Multimodal' },
  { id: 'eu/gpt-5.2', name: 'EU GPT-5.2', description: 'EU region' },
  { id: 'eu/gpt-5.2-high', name: 'EU GPT-5.2 High', description: 'EU high quality' },
  { id: 'eu/gpt-5.2-codex', name: 'EU GPT-5.2 Codex', description: 'EU code optimized' },
  { id: 'eu/gpt-5.1', name: 'EU GPT-5.1', description: 'EU region' },
  { id: 'eu/gpt-5.1-high', name: 'EU GPT-5.1 High', description: 'EU high quality' },
  { id: 'eu/gpt-5.1-codex-high', name: 'EU GPT-5.1 Codex High', description: 'EU code optimized' },
  { id: 'eu/gpt-5', name: 'EU GPT-5', description: 'EU region' },
  { id: 'kimi-k2', name: 'Kimi K2', description: 'Moonshot AI' },
  { id: 'kimi-k2-thinking', name: 'Kimi K2 Thinking', description: 'With reasoning' },
  { id: 'kimi-k2.5', name: 'Kimi K2.5', description: 'Moonshot latest' },
  { id: 'deepseek-v3', name: 'DeepSeek V3', description: 'DeepSeek' },
  { id: 'deepseek-v3.1', name: 'DeepSeek V3.1', description: 'DeepSeek improved' },
  { id: 'deepseek-v3.2', name: 'DeepSeek V3.2', description: 'DeepSeek latest' },
  { id: 'doubao-seed-1.6', name: 'Doubao Seed 1.6', description: 'ByteDance Doubao' },
  { id: 'doubao-seed-1.6-flash', name: 'Doubao Seed 1.6 Flash', description: 'Fast' },
  { id: 'doubao-seed-1.6-thinking', name: 'Doubao Seed 1.6 Thinking', description: 'With reasoning' },
  { id: 'doubao-seed-code', name: 'Doubao Seed Code', description: 'Code optimized' },
  { id: 'doubao-1.5-pro-256k', name: 'Doubao 1.5 Pro 256K', description: 'Long context' },
  { id: 'glm-4.6', name: 'GLM 4.6', description: 'Zhipu AI' },
  { id: 'glm-4.7', name: 'GLM 4.7', description: 'Zhipu AI' },
]

function getPresetForUrl(url: string): PresetKey {
  const match = PRESETS.find(p => p.key !== 'custom' && p.url === url)
  return match?.key ?? 'custom'
}

export function ApiKeyInput({
  status,
  errorMessage,
  onSubmit,
  formId = "api-key-form",
  disabled,
  initialApiKey,
  initialBaseUrl,
  initialCustomModel,
}: ApiKeyInputProps) {
  const [apiKey, setApiKey] = useState(initialApiKey ?? '')
  const [showValue, setShowValue] = useState(false)
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl?.trim() || PRESETS[0].url)
  const [activePreset, setActivePreset] = useState<PresetKey>(getPresetForUrl(initialBaseUrl?.trim() || PRESETS[0].url))
  const [customModel, setCustomModel] = useState(initialCustomModel ?? '')

  const isDisabled = disabled || status === 'validating'

  // When settings reopen, hydrate the form from the latest saved API setup.
  useEffect(() => {
    const hydratedBaseUrl = initialBaseUrl?.trim() || PRESETS[0].url
    setApiKey(initialApiKey ?? '')
    setBaseUrl(hydratedBaseUrl)
    setActivePreset(getPresetForUrl(hydratedBaseUrl))
    setCustomModel(initialCustomModel ?? '')
  }, [initialApiKey, initialBaseUrl, initialCustomModel])

  const handlePresetSelect = (preset: Preset) => {
    setActivePreset(preset.key)
    if (preset.key === 'custom') {
      setBaseUrl('')
    } else {
      setBaseUrl(preset.url)
    }
    // Pre-fill recommended model for Ollama and IDEA; clear for all others
    // (Anthropic hides the field entirely, others default to Claude model IDs when empty)
    if (preset.key === 'ollama') {
      setCustomModel('qwen3-coder')
    } else if (preset.key === 'idea') {
      setCustomModel(IDEA_MODELS[0].id) // Default to first model (gemini-3-flash-priority)
      setApiKey(IDEA_API_KEY) // Auto-fill hardcoded IDEA API key
    } else {
      setCustomModel('')
    }
  }

  const handleBaseUrlChange = (value: string) => {
    setBaseUrl(value)
    setActivePreset(getPresetForUrl(value))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Always call onSubmit — the hook decides whether an empty key is valid
    // (custom endpoints like Ollama don't require API keys)
    const effectiveBaseUrl = baseUrl.trim()
    const isDefault = effectiveBaseUrl === PRESETS[0].url || !effectiveBaseUrl
    onSubmit({
      apiKey: apiKey.trim(),
      baseUrl: isDefault ? undefined : effectiveBaseUrl,
      customModel: customModel.trim() || undefined,
    })
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="space-y-6">
      {/* API Key — hidden for IDEA since it uses hardcoded key */}
      {activePreset !== 'idea' && (
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
              placeholder="sk-ant-..."
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
      )}

      {/* Base URL with Preset Dropdown */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="base-url">Base URL</Label>
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={isDisabled}
              className="flex h-6 items-center gap-1 rounded-[6px] bg-background shadow-minimal pl-2.5 pr-2 text-[12px] font-medium text-foreground/50 hover:bg-foreground/5 hover:text-foreground focus:outline-none"
            >
              {PRESETS.find(p => p.key === activePreset)?.label}
              <ChevronDown className="size-2.5 opacity-50" />
            </DropdownMenuTrigger>
            <StyledDropdownMenuContent align="end" className="z-floating-menu">
              {PRESETS.map((preset) => (
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
      </div>

      {/* Model selector for IDEA — dropdown with predefined models */}
      {activePreset === 'idea' && (
        <div className="space-y-2">
          <Label className="text-muted-foreground font-normal">Model</Label>
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={isDisabled}
              className={cn(
                "flex w-full h-10 items-center justify-between rounded-md px-3 text-sm",
                "bg-foreground-2 shadow-minimal hover:bg-background transition-colors"
              )}
            >
              <span>{IDEA_MODELS.find(m => m.id === customModel)?.name || customModel}</span>
              <ChevronDown className="size-4 opacity-50" />
            </DropdownMenuTrigger>
            <StyledDropdownMenuContent align="start" className="z-floating-menu w-[var(--radix-dropdown-menu-trigger-width)] max-h-[300px] overflow-y-auto">
              {IDEA_MODELS.map((model) => (
                <StyledDropdownMenuItem
                  key={model.id}
                  onClick={() => setCustomModel(model.id)}
                  className="justify-between"
                >
                  <div>
                    <div className="font-medium">{model.name}</div>
                    <div className="text-xs text-muted-foreground">{model.description}</div>
                  </div>
                  <Check className={cn("size-4 ml-2", customModel === model.id ? "opacity-100" : "opacity-0")} />
                </StyledDropdownMenuItem>
              ))}
            </StyledDropdownMenuContent>
          </DropdownMenu>
          <p className="text-xs text-foreground/30">
            Select a model from the available options. You can switch models later in the chat.
          </p>
        </div>
      )}

      {/* Custom Model (optional) — hidden for Anthropic and IDEA */}
      {activePreset !== 'anthropic' && activePreset !== 'idea' && (
        <div className="space-y-2">
          <Label htmlFor="custom-model" className="text-muted-foreground font-normal">
            Model <span className="text-foreground/30">· optional</span>
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
              placeholder="e.g. openai/gpt-5, qwen3-coder"
              className="border-0 bg-transparent shadow-none"
              disabled={isDisabled}
            />
          </div>
          {/* Contextual help links for providers that need model format guidance */}
          {activePreset === 'openrouter' && (
            <p className="text-xs text-foreground/30">
              Leave empty for Claude models. Only set for non-Claude models.
              <br />
              Format: <code className="text-foreground/40">provider/model-name</code>.{' '}
              <a href="https://openrouter.ai/models" target="_blank" rel="noopener noreferrer" className="text-foreground/50 underline hover:text-foreground/70">
                Browse models
              </a>
            </p>
          )}
          {activePreset === 'vercel' && (
            <p className="text-xs text-foreground/30">
              Leave empty for Claude models. Only set for non-Claude models.
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
          {(activePreset === 'custom' || !activePreset) && (
            <p className="text-xs text-foreground/30">
              Defaults to Anthropic model names (Opus, Sonnet, Haiku) when empty
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
