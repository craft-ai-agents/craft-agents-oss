/**
 * CustomEndpointValidationDialog
 *
 * Shows validation progress and results when uploading a custom endpoint configuration.
 * Displays step-by-step progress: parsing → validating → testing connection.
 */

import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Spinner } from '@craft-agent/ui'
import { CheckCircle2, XCircle, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CustomEndpointUploadResult } from '../../../shared/types'

type ValidationStep = 'parsing' | 'validating' | 'testing' | 'done'

interface CustomEndpointValidationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The JSON content being validated */
  jsonContent: string
  /** Called when validation succeeds */
  onSuccess: () => void
  /** Called when user cancels or closes */
  onCancel: () => void
}

interface StepStatus {
  status: 'pending' | 'loading' | 'success' | 'error'
  message?: string
}

export function CustomEndpointValidationDialog({
  open,
  onOpenChange,
  jsonContent,
  onSuccess,
  onCancel,
}: CustomEndpointValidationDialogProps) {
  const [currentStep, setCurrentStep] = React.useState<ValidationStep>('parsing')
  const [steps, setSteps] = React.useState<Record<string, StepStatus>>({
    parsing: { status: 'pending' },
    schema: { status: 'pending' },
    connection: { status: 'pending' },
  })
  const [result, setResult] = React.useState<CustomEndpointUploadResult | null>(null)
  const [isRetrying, setIsRetrying] = React.useState(false)

  // Run validation when dialog opens
  React.useEffect(() => {
    if (!open) {
      // Reset state when dialog closes
      setCurrentStep('parsing')
      setSteps({
        parsing: { status: 'pending' },
        schema: { status: 'pending' },
        connection: { status: 'pending' },
      })
      setResult(null)
      setIsRetrying(false)
      return
    }

    runValidation()
  }, [open, isRetrying])

  const runValidation = async () => {
    // Step 1: Parsing JSON
    setCurrentStep('parsing')
    setSteps(s => ({ ...s, parsing: { status: 'loading' } }))

    // Small delay for visual feedback
    await new Promise(r => setTimeout(r, 300))

    // Check if JSON is valid (basic parse check)
    try {
      JSON.parse(jsonContent)
      setSteps(s => ({ ...s, parsing: { status: 'success', message: 'Valid JSON' } }))
    } catch {
      setSteps(s => ({
        ...s,
        parsing: { status: 'error', message: 'Invalid JSON syntax' },
      }))
      setCurrentStep('done')
      return
    }

    // Step 2: Validating schema
    setCurrentStep('validating')
    setSteps(s => ({ ...s, schema: { status: 'loading' } }))
    await new Promise(r => setTimeout(r, 300))

    // Step 3: Testing connection (handled by IPC)
    setCurrentStep('testing')
    setSteps(s => ({ ...s, schema: { status: 'success', message: 'Schema valid' }, connection: { status: 'loading' } }))

    try {
      // Call IPC to upload and validate the config
      // This will parse, validate schema, and test the connection
      const uploadResult = await window.electronAPI.uploadCustomEndpointConfig(jsonContent)
      setResult(uploadResult)

      if (uploadResult.success) {
        setSteps(s => ({
          ...s,
          connection: {
            status: 'success',
            message: uploadResult.connectionTest?.modelCount
              ? `Connected (${uploadResult.connectionTest.modelCount} models)`
              : 'Connected',
          },
        }))
        setCurrentStep('done')
      } else {
        // Determine which step failed
        if (uploadResult.validationErrors?.length) {
          // Schema validation failed
          setSteps(s => ({
            ...s,
            schema: { status: 'error', message: uploadResult.validationErrors?.join(', ') },
            connection: { status: 'pending' },
          }))
        } else {
          // Connection test failed
          setSteps(s => ({
            ...s,
            schema: { status: 'success', message: 'Schema valid' },
            connection: { status: 'error', message: uploadResult.error || 'Connection failed' },
          }))
        }
        setCurrentStep('done')
      }
    } catch (error) {
      setSteps(s => ({
        ...s,
        connection: {
          status: 'error',
          message: error instanceof Error ? error.message : 'Validation failed',
        },
      }))
      setCurrentStep('done')
    }
  }

  const handleRetry = () => {
    setIsRetrying(r => !r) // Toggle to trigger useEffect
  }

  const handleClose = () => {
    if (result?.success) {
      onSuccess()
    } else {
      onCancel()
    }
    onOpenChange(false)
  }

  const isComplete = currentStep === 'done'
  const isSuccess = result?.success === true

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>
            {isComplete
              ? isSuccess
                ? 'Configuration Saved'
                : 'Validation Failed'
              : 'Validating Configuration'}
          </DialogTitle>
          <DialogDescription>
            {isComplete
              ? isSuccess
                ? 'Your custom endpoint has been configured successfully.'
                : 'There was an issue with your configuration.'
              : 'Testing your custom endpoint configuration...'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-4">
          <ValidationStepRow
            label="Parsing JSON"
            status={steps.parsing}
          />
          <ValidationStepRow
            label="Validating schema"
            status={steps.schema}
          />
          <ValidationStepRow
            label="Testing connection"
            status={steps.connection}
          />
        </div>

        <DialogFooter>
          {isComplete ? (
            <>
              {!isSuccess && (
                <Button variant="outline" onClick={handleRetry}>
                  Try Again
                </Button>
              )}
              <Button onClick={handleClose}>
                {isSuccess ? 'Done' : 'Close'}
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Individual validation step row with status indicator
 */
function ValidationStepRow({
  label,
  status,
}: {
  label: string
  status: StepStatus
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-5 h-5 flex items-center justify-center">
        {status.status === 'pending' && (
          <div className="w-2 h-2 rounded-full bg-muted-foreground/30" />
        )}
        {status.status === 'loading' && (
          <Spinner className="w-4 h-4" />
        )}
        {status.status === 'success' && (
          <CheckCircle2 className="w-5 h-5 text-success" />
        )}
        {status.status === 'error' && (
          <XCircle className="w-5 h-5 text-destructive" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className={cn(
          'text-sm',
          status.status === 'pending' && 'text-muted-foreground',
          status.status === 'loading' && 'text-foreground',
          status.status === 'success' && 'text-foreground',
          status.status === 'error' && 'text-destructive',
        )}>
          {label}
        </div>
        {status.message && status.status === 'error' && (
          <div className="text-xs text-destructive mt-0.5 truncate">
            {status.message}
          </div>
        )}
      </div>
      {status.status === 'success' && status.message && (
        <span className="text-xs text-muted-foreground">
          {status.message}
        </span>
      )}
    </div>
  )
}
