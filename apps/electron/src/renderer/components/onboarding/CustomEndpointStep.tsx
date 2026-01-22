/**
 * CustomEndpointStep - Upload configuration for custom API endpoints
 *
 * Allows users to upload a JSON configuration file to connect to
 * OpenRouter, Ollama, or other compatible APIs.
 */

import { useState } from "react"
import { cn } from "@/lib/utils"
import { Upload, CheckCircle2, XCircle, Settings2, ExternalLink } from "lucide-react"
import { Spinner } from "@craft-agent/ui"
import { StepFormLayout, BackButton, ContinueButton, type StepIconVariant } from "./primitives"
import { Button } from "@/components/ui/button"
import type { CustomEndpointUploadResult } from "../../../shared/types"

export type CustomEndpointStatus = 'idle' | 'validating' | 'success' | 'error'

interface CustomEndpointStepProps {
  status: CustomEndpointStatus
  errorMessage?: string
  onUploadConfig: (jsonContent: string) => Promise<CustomEndpointUploadResult>
  onBack: () => void
  onContinue: () => void
}

function getIcon(status: CustomEndpointStatus): React.ReactNode {
  switch (status) {
    case 'idle': return <Settings2 />
    case 'validating': return <Spinner className="text-2xl" />
    case 'success': return <CheckCircle2 />
    case 'error': return <XCircle />
  }
}

function getIconVariant(status: CustomEndpointStatus): StepIconVariant {
  switch (status) {
    case 'idle': return 'primary'
    case 'validating': return 'loading'
    case 'success': return 'success'
    case 'error': return 'error'
  }
}

const STATUS_CONTENT: Record<CustomEndpointStatus, { title: string; description: string }> = {
  idle: {
    title: 'Custom Endpoint',
    description: 'Upload a JSON configuration file to connect to compatible APIs.',
  },
  validating: {
    title: 'Validating...',
    description: 'Testing connection to your custom endpoint...',
  },
  success: {
    title: 'Connected!',
    description: 'Your custom endpoint is configured and ready.',
  },
  error: {
    title: 'Configuration failed',
    description: '', // Will use errorMessage prop
  },
}

export function CustomEndpointStep({
  status,
  errorMessage,
  onUploadConfig,
  onBack,
  onContinue,
}: CustomEndpointStepProps) {
  const [isUploading, setIsUploading] = useState(false)
  const [validationErrors, setValidationErrors] = useState<string[]>([])

  // Handle file upload
  const handleUpload = async () => {
    // Open file picker for JSON files
    const result = await window.electronAPI.openFileDialog()
    if (!result || result.length === 0) return

    const filePath = result[0]
    if (!filePath.endsWith('.json')) {
      setValidationErrors(['Please select a JSON file'])
      return
    }

    setIsUploading(true)
    setValidationErrors([])

    try {
      // Read the file content
      const content = await window.electronAPI.readFile(filePath)

      // Upload and validate the config
      const uploadResult = await onUploadConfig(content)

      if (!uploadResult.success) {
        // Show validation or connection errors
        if (uploadResult.validationErrors?.length) {
          setValidationErrors(uploadResult.validationErrors)
        } else if (uploadResult.error) {
          setValidationErrors([uploadResult.error])
        }
      }
    } catch (error) {
      setValidationErrors([error instanceof Error ? error.message : 'Failed to read config file'])
    } finally {
      setIsUploading(false)
    }
  }

  const content = STATUS_CONTENT[status]

  // Show connection success state
  if (status === 'success') {
    return (
      <StepFormLayout
        icon={getIcon(status)}
        iconVariant={getIconVariant(status)}
        title={content.title}
        description={content.description}
        actions={
          <ContinueButton onClick={onContinue}>
            Continue
          </ContinueButton>
        }
      />
    )
  }

  // Show error state with retry option
  if (status === 'error') {
    return (
      <StepFormLayout
        icon={getIcon(status)}
        iconVariant={getIconVariant(status)}
        title={content.title}
        description={errorMessage || 'Something went wrong. Please try again.'}
        actions={
          <>
            <BackButton onClick={onBack} />
            <ContinueButton onClick={handleUpload}>
              Try Again
            </ContinueButton>
          </>
        }
      />
    )
  }

  // Show validating state
  if (status === 'validating') {
    return (
      <StepFormLayout
        icon={getIcon(status)}
        iconVariant={getIconVariant(status)}
        title={content.title}
        description={content.description}
        actions={
          <BackButton onClick={onBack} disabled>Cancel</BackButton>
        }
      />
    )
  }

  // Idle state - show upload UI
  return (
    <StepFormLayout
      icon={getIcon(status)}
      iconVariant={getIconVariant(status)}
      title={content.title}
      description={content.description}
      actions={
        <>
          <BackButton onClick={onBack} disabled={isUploading} />
          <ContinueButton onClick={handleUpload} disabled={isUploading}>
            {isUploading ? (
              <>
                <Spinner className="size-4 mr-1.5" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="size-4 mr-1.5" />
                Upload Config
              </>
            )}
          </ContinueButton>
        </>
      }
    >
      {/* Info card about config format */}
      <div className={cn(
        "rounded-xl p-4 text-left",
        "bg-foreground-2 shadow-minimal"
      )}>
        <div className="space-y-3">
          <div className="text-sm">
            <p className="text-muted-foreground">
              Create a JSON file with your endpoint configuration:
            </p>
            <pre className="mt-2 p-3 rounded-md bg-foreground/5 text-xs font-mono overflow-x-auto">
{`{
  "baseUrl": "https://openrouter.ai/api",
  "apiKey": "sk-or-v1-your-key",
  "models": {
    "sonnet": "anthropic/claude-sonnet-4"
  }
}`}
            </pre>
          </div>

          <a
            href="#"
            onClick={(e) => {
              e.preventDefault()
              window.electronAPI.openUrl('https://agents.craft.do/docs/reference/config/custom-endpoint')
            }}
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <ExternalLink className="size-3.5" />
            View full documentation
          </a>
        </div>
      </div>

      {/* Validation errors */}
      {validationErrors.length > 0 && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {validationErrors.map((error, i) => (
            <p key={i}>{error}</p>
          ))}
        </div>
      )}
    </StepFormLayout>
  )
}
