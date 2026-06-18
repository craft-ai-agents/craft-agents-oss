/**
 * LocalModelStep — Onboarding step for local model configuration (Ollama).
 *
 * Shows endpoint URL and model fields only — no API key input.
 * Pre-filled with Ollama defaults (localhost:11434, qwen3-coder).
 */

import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { StepFormLayout, BackButton, ContinueButton } from "./primitives"

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

  const isDisabled = status === 'validating'

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
          <BackButton onClick={onBack} disabled={isDisabled} />
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
              onChange={(e) => setBaseUrl(e.target.value)}
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
              onChange={(e) => {
                setModel(e.target.value)
                setModelError(null)
              }}
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
