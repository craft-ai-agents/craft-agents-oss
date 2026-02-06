/**
 * ApiKeyInput - Reusable API key entry form control
 *
 * Renders a password input for the API key, a preset selector for Base URL,
 * and an optional multi-model input field (tag/chip input for adding multiple models).
 *
 * Does NOT include layout wrappers or action buttons — the parent
 * controls placement via the form ID ("api-key-form") for submit binding.
 *
 * Used in: Onboarding CredentialsStep, Settings API dialog
 */

import { useState, useRef, useCallback, type KeyboardEvent } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
} from "@/components/ui/styled-dropdown"
import { cn } from "@/lib/utils"
import { Check, ChevronDown, Eye, EyeOff, X } from "lucide-react"

export type ApiKeyStatus = 'idle' | 'validating' | 'success' | 'error'

export interface ApiKeySubmitData {
  apiKey: string
  baseUrl?: string
  customModel?: string
  customModels?: string[]
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
}

type PresetKey = 'anthropic' | 'openrouter' | 'vercel' | 'ollama' | 'custom'

interface Preset {
  key: PresetKey
  label: string
  url: string
}

const PRESETS: Preset[] = [
  { key: 'anthropic', label: 'Anthropic', url: 'https://api.anthropic.com' },
  { key: 'openrouter', label: 'OpenRouter', url: 'https://openrouter.ai/api' },
  { key: 'vercel', label: 'Vercel AI Gateway', url: 'https://ai-gateway.vercel.sh' },
  { key: 'ollama', label: 'Ollama', url: 'http://localhost:11434' },
  { key: 'custom', label: 'Custom', url: '' },
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
}: ApiKeyInputProps) {
  const [apiKey, setApiKey] = useState('')
  const [showValue, setShowValue] = useState(false)
  const [baseUrl, setBaseUrl] = useState(PRESETS[0].url)
  const [activePreset, setActivePreset] = useState<PresetKey>('anthropic')
  const [customModels, setCustomModels] = useState<string[]>([])
  const [modelInput, setModelInput] = useState('')
  const modelInputRef = useRef<HTMLInputElement>(null)

  const isDisabled = disabled || status === 'validating'

  const handlePresetSelect = (preset: Preset) => {
    setActivePreset(preset.key)
    if (preset.key === 'custom') {
      setBaseUrl('')
    } else {
      setBaseUrl(preset.url)
    }
    // Pre-fill recommended model for Ollama; clear for all others
    if (preset.key === 'ollama') {
      setCustomModels(['qwen3-coder'])
      setModelInput('')
    } else {
      setCustomModels([])
      setModelInput('')
    }
  }

  const handleBaseUrlChange = (value: string) => {
    setBaseUrl(value)
    setActivePreset(getPresetForUrl(value))
  }

  const addModel = useCallback((model: string) => {
    const trimmed = model.trim()
    if (trimmed && !customModels.includes(trimmed)) {
      setCustomModels(prev => [...prev, trimmed])
    }
    setModelInput('')
  }, [customModels])

  const removeModel = useCallback((model: string) => {
    setCustomModels(prev => prev.filter(m => m !== model))
  }, [])

  const handleModelKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (modelInput.trim()) {
        addModel(modelInput)
      }
    } else if (e.key === 'Backspace' && !modelInput && customModels.length > 0) {
      // Remove last model when backspacing on empty input
      setCustomModels(prev => prev.slice(0, -1))
    }
  }, [modelInput, customModels, addModel])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // If there's text in the model input, add it as a model before submitting
    const finalModels = [...customModels]
    if (modelInput.trim()) {
      const trimmed = modelInput.trim()
      if (!finalModels.includes(trimmed)) {
        finalModels.push(trimmed)
      }
    }

    const effectiveBaseUrl = baseUrl.trim()
    const isDefault = effectiveBaseUrl === PRESETS[0].url || !effectiveBaseUrl
    onSubmit({
      apiKey: apiKey.trim(),
      baseUrl: isDefault ? undefined : effectiveBaseUrl,
      // First model is the default/active model (backward compat)
      customModel: finalModels[0] || undefined,
      customModels: finalModels.length > 0 ? finalModels : undefined,
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

      {/* Custom Models (optional) — hidden for Anthropic since it uses its own model routing */}
      {activePreset !== 'anthropic' && (
        <div className="space-y-2">
          <Label htmlFor="custom-model" className="text-muted-foreground font-normal">
            Models <span className="text-foreground/30">· optional, press Enter to add</span>
          </Label>
          {/* Model tags */}
          {customModels.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {customModels.map((model) => (
                <span
                  key={model}
                  className="inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded-md bg-foreground/8 text-xs font-medium text-foreground/80"
                >
                  {model}
                  <button
                    type="button"
                    onClick={() => removeModel(model)}
                    disabled={isDisabled}
                    className="inline-flex items-center justify-center size-4 rounded hover:bg-foreground/10 text-foreground/40 hover:text-foreground/70 transition-colors"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          {/* Model input */}
          <div className={cn(
            "rounded-md shadow-minimal transition-colors",
            "bg-foreground-2 focus-within:bg-background"
          )}>
            <Input
              ref={modelInputRef}
              id="custom-model"
              type="text"
              value={modelInput}
              onChange={(e) => setModelInput(e.target.value)}
              onKeyDown={handleModelKeyDown}
              placeholder={customModels.length > 0 ? "Add another model..." : "e.g. openai/gpt-5, qwen3-coder"}
              className="border-0 bg-transparent shadow-none"
              disabled={isDisabled}
            />
          </div>
          {/* Contextual help links for providers that need model format guidance */}
          {activePreset === 'openrouter' && (
            <p className="text-xs text-foreground/30">
              Leave empty for Claude models. Add non-Claude models to switch between them.
              <br />
              Format: <code className="text-foreground/40">provider/model-name</code>.{' '}
              <a href="https://openrouter.ai/models" target="_blank" rel="noopener noreferrer" className="text-foreground/50 underline hover:text-foreground/70">
                Browse models
              </a>
            </p>
          )}
          {activePreset === 'vercel' && (
            <p className="text-xs text-foreground/30">
              Leave empty for Claude models. Add non-Claude models to switch between them.
              <br />
              Format: <code className="text-foreground/40">provider/model-name</code>.{' '}
              <a href="https://vercel.com/docs/ai-gateway" target="_blank" rel="noopener noreferrer" className="text-foreground/50 underline hover:text-foreground/70">
                View supported models
              </a>
            </p>
          )}
          {activePreset === 'ollama' && (
            <p className="text-xs text-foreground/30">
              Add models pulled via <code className="text-foreground/40">ollama pull</code>. No API key required.
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
