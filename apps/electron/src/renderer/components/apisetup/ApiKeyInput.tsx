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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { Eye, EyeOff } from "lucide-react"

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
}

type PresetKey = 'anthropic' | 'openrouter' | 'vercel' | 'custom'

interface Preset {
  key: PresetKey
  label: string
  url: string
}

const PRESETS: Preset[] = [
  { key: 'anthropic', label: 'Anthropic', url: 'https://api.anthropic.com' },
  { key: 'openrouter', label: 'OpenRouter', url: 'https://openrouter.ai/api' },
  { key: 'vercel', label: 'Vercel AI Gateway', url: 'https://gateway.ai.vercel.app/v1' },
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
  const [customModel, setCustomModel] = useState('')

  const isDisabled = disabled || status === 'validating'

  const handlePresetSelect = (preset: Preset) => {
    setActivePreset(preset.key)
    if (preset.key === 'custom') {
      setBaseUrl('')
    } else {
      setBaseUrl(preset.url)
    }
  }

  const handleBaseUrlChange = (value: string) => {
    setBaseUrl(value)
    setActivePreset(getPresetForUrl(value))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (apiKey.trim()) {
      // Don't send baseUrl if it's the Anthropic default
      const effectiveBaseUrl = baseUrl.trim()
      const isDefault = effectiveBaseUrl === PRESETS[0].url || !effectiveBaseUrl
      onSubmit({
        apiKey: apiKey.trim(),
        baseUrl: isDefault ? undefined : effectiveBaseUrl,
        customModel: customModel.trim() || undefined,
      })
    }
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="space-y-4">
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
          <Select
            value={activePreset}
            onValueChange={(value) => handlePresetSelect(PRESETS.find(p => p.key === value)!)}
            disabled={isDisabled}
          >
            <SelectTrigger className="h-6 w-auto gap-1.5 border-0 bg-transparent px-2 text-[11px] font-medium text-foreground/50 shadow-none hover:text-foreground focus:ring-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRESETS.map((preset) => (
                <SelectItem key={preset.key} value={preset.key}>
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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

      {/* Custom Model (optional) */}
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
        <p className="text-xs text-foreground/30">
          Defaults to Anthropic model names (Opus, Sonnet, Haiku) when empty
        </p>
      </div>

      {/* Error message */}
      {status === 'error' && errorMessage && (
        <p className="text-sm text-destructive">{errorMessage}</p>
      )}
    </form>
  )
}
