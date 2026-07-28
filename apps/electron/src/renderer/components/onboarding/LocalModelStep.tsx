/**
 * LocalModelStep — Onboarding step for local model configuration (Ollama).
 *
 * Shows endpoint URL and model fields only — no API key input.
 * Pre-filled with Ollama defaults (localhost:11434, qwen3-coder).
 * Includes an auto-discovery button that detects running Ollama instances.
 */

import { useState, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { StepFormLayout, BackButton, ContinueButton } from "./primitives"
import { Loader2, Zap, WifiOff, Search, CheckCircle2 } from "lucide-react"

export interface LocalModelSubmitData {
  baseUrl: string
  model: string
  models: string[]
}

interface LocalModelStepProps {
  onSubmit: (data: LocalModelSubmitData) => void
  onBack: () => void
  status?: 'idle' | 'validating' | 'success' | 'error'
  errorMessage?: string
}

function parseModelList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

/** Response shape from GET http://localhost:11434/api/tags */
interface OllamaTagsResponse {
  models: Array<{
    name: string
    modified_at: string
    size: number
    digest: string
    details?: {
      format: string
      family: string
      families: string[]
      parameter_size: string
      quantization_level: string
    }
  }>
}

type DiscoveryStatus = 'idle' | 'searching' | 'found' | 'not-found' | 'error'

export function LocalModelStep({
  onSubmit,
  onBack,
  status = 'idle',
  errorMessage,
}: LocalModelStepProps) {
  const { t } = useTranslation()
  const [baseUrl, setBaseUrl] = useState('http://localhost:11434')
  const [model, setModel] = useState('qwen3-coder')
  const [modelError, setModelError] = useState<string | null>(null)
  const [discoveryStatus, setDiscoveryStatus] = useState<DiscoveryStatus>('idle')
  const [discoveryMessage, setDiscoveryMessage] = useState<string | null>(null)

  const isDisabled = status === 'validating'
  const isDiscovering = discoveryStatus === 'searching'

  const handleDiscover = useCallback(async () => {
    setDiscoveryStatus('searching')
    setDiscoveryMessage(null)

    try {
      const response = await fetch('http://localhost:11434/api/tags', {
        signal: AbortSignal.timeout(3000),
      })

      if (!response.ok) {
        setDiscoveryStatus('not-found')
        setDiscoveryMessage(`Ollama responded with status ${response.status}`)
        return
      }

      const data: OllamaTagsResponse = await response.json()

      if (!data.models || data.models.length === 0) {
        setDiscoveryStatus('not-found')
        setDiscoveryMessage('Ollama is running but no models are installed.')
        return
      }

      // Sort: most recently modified first
      const sorted = [...data.models].sort(
        (a, b) => new Date(b.modified_at).getTime() - new Date(a.modified_at).getTime(),
      )
      const modelNames = sorted.map((m) => m.name)
      const primaryModel = modelNames[0]

      // Auto-fill
      setBaseUrl('http://localhost:11434')
      setModel(primaryModel)
      setModelError(null)
      setDiscoveryStatus('found')
      setDiscoveryMessage(`Found ${modelNames.length} model(s) — using "${primaryModel}"`)
    } catch (err) {
      setDiscoveryStatus('error')
      if (err instanceof DOMException && err.name === 'AbortError') {
        setDiscoveryMessage('Request timed out. Ensure Ollama is running on port 11434.')
      } else {
        const msg = err instanceof Error ? err.message : 'Connection failed'
        setDiscoveryMessage(`Could not reach Ollama: ${msg}`)
      }
    }
  }, [])

  /** Reset discovery state when user manually edits any field */
  const handleUrlChange = useCallback((value: string) => {
    setBaseUrl(value)
    if (discoveryStatus === 'found' || discoveryStatus === 'not-found') {
      setDiscoveryStatus('idle')
      setDiscoveryMessage(null)
    }
  }, [discoveryStatus])

  const handleModelChange = useCallback((value: string) => {
    setModel(value)
    setModelError(null)
    if (discoveryStatus === 'found' || discoveryStatus === 'not-found') {
      setDiscoveryStatus('idle')
      setDiscoveryMessage(null)
    }
  }, [discoveryStatus])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedUrl = baseUrl.trim()
    const parsedModels = parseModelList(model)

    if (!trimmedUrl) {
      setModelError(t('onboarding.localModel.endpointRequired'))
      return
    }
    if (parsedModels.length === 0) {
      setModelError(t('onboarding.localModel.modelRequired'))
      return
    }

    setModelError(null)
    onSubmit({
      baseUrl: trimmedUrl,
      model: parsedModels[0],
      models: parsedModels,
    })
  }

  return (
    <StepFormLayout
      title={t("onboarding.localModel.title")}
      description={t("onboarding.localModel.description")}
      actions={
        <>
          <BackButton onClick={onBack} disabled={isDisabled || isDiscovering} />
          <ContinueButton
            type="submit"
            form="local-model-form"
            disabled={false}
            loading={status === 'validating'}
            loadingText="Connecting..."
          />
        </>
      }
    >
      <form id="local-model-form" onSubmit={handleSubmit} className="space-y-6">
        {/* ── Discover Ollama ────────────────────────────────────── */}
        <div className="rounded-xl border border-dashed px-4 py-3.5 transition-colors"
          style={{
            borderColor: discoveryStatus === 'found'
              ? 'color-mix(in oklch, var(--ds-success) 30%, transparent)'
              : discoveryStatus === 'error'
                ? 'color-mix(in oklch, var(--ds-error) 30%, transparent)'
                : 'color-mix(in oklch, var(--foreground) 12%, transparent)',
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className="flex size-8 shrink-0 items-center justify-center rounded-lg"
                style={{
                  background: discoveryStatus === 'found'
                    ? 'color-mix(in oklch, var(--ds-success) 12%, transparent)'
                    : discoveryStatus === 'error'
                      ? 'color-mix(in oklch, var(--ds-error) 12%, transparent)'
                      : 'color-mix(in oklch, var(--foreground) 5%, transparent)',
                }}
              >
                {discoveryStatus === 'searching' ? (
                  <Loader2 className="size-4 animate-spin" style={{ color: 'var(--ds-info)' }} />
                ) : discoveryStatus === 'found' ? (
                  <CheckCircle2 className="size-4" style={{ color: 'var(--ds-success)' }} />
                ) : discoveryStatus === 'error' ? (
                  <WifiOff className="size-4" style={{ color: 'var(--ds-error)' }} />
                ) : (
                  <Zap className="size-4" style={{ color: 'color-mix(in oklch, var(--foreground) 35%, transparent)' }} />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-medium leading-snug" style={{ color: 'var(--foreground)' }}>
                  Auto-detect Ollama
                </p>
                <p className="text-[11px] leading-snug mt-0.5" style={{ color: 'color-mix(in oklch, var(--foreground) 35%, transparent)' }}>
                  {discoveryMessage ?? 'Ping localhost:11434 and fetch installed models'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleDiscover}
              disabled={isDiscovering}
              className="inline-flex items-center gap-1.5 shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-all duration-150 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: discoveryStatus === 'found'
                  ? 'color-mix(in oklch, var(--ds-success) 12%, transparent)'
                  : 'color-mix(in oklch, var(--foreground) 6%, transparent)',
                color: discoveryStatus === 'found'
                  ? 'var(--ds-success)'
                  : 'var(--foreground)',
              }}
            >
              <Search className="size-3" />
              {isDiscovering ? 'Scanning…' : discoveryStatus === 'found' ? 'Found' : 'Discover'}
            </button>
          </div>
        </div>

        {/* Endpoint URL */}
        <div className="space-y-2">
          <Label htmlFor="local-base-url">{t("onboarding.localModel.endpoint")}</Label>
          <div className={cn(
            "rounded-md shadow-minimal transition-colors",
            "bg-foreground-2 focus-within:bg-background"
          )}>
            <Input
              id="local-base-url"
              type="text"
              value={baseUrl}
              onChange={(e) => handleUrlChange(e.target.value)}
              placeholder={t("onboarding.localModel.endpointPlaceholder")}
              className="border-0 bg-transparent shadow-none"
              disabled={isDisabled}
              autoFocus
            />
          </div>
          <p className="text-xs text-foreground/30">
            {t("onboarding.localModel.endpointHelper")}
          </p>
        </div>

        {/* Model */}
        <div className="space-y-2">
          <Label htmlFor="local-model">
            {t("onboarding.localModel.model")}{' '}
            <span className="text-foreground/30">· {t("onboarding.localModel.required")}</span>
          </Label>
          <div className={cn(
            "rounded-md shadow-minimal transition-colors",
            "bg-foreground-2 focus-within:bg-background",
            modelError && "ring-1 ring-destructive/40"
          )}>
            <Input
              id="local-model"
              type="text"
              value={model}
              onChange={(e) => handleModelChange(e.target.value)}
              placeholder={t("onboarding.localModel.modelPlaceholder")}
              className="border-0 bg-transparent shadow-none"
              disabled={isDisabled}
            />
          </div>
          {modelError && (
            <p className="text-xs text-destructive">{modelError}</p>
          )}
          <p className="text-xs text-foreground/30">
            {t("onboarding.localModel.modelHelper")}
          </p>
        </div>

        {/* Error message */}
        {status === 'error' && errorMessage && (
          <p className="text-sm text-destructive">{errorMessage}</p>
        )}
      </form>
    </StepFormLayout>
  )
}
