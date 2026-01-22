/**
 * ViewCustomEndpointConfigDialog
 *
 * Displays the current custom endpoint configuration with masked API key.
 * Allows users to clear the configuration.
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
import { Globe, Key, Cpu } from 'lucide-react'
import type { CustomEndpointConfigInfo } from '../../../shared/types'

interface ViewCustomEndpointConfigDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called when config is cleared */
  onClear: () => void
}

export function ViewCustomEndpointConfigDialog({
  open,
  onOpenChange,
  onClear,
}: ViewCustomEndpointConfigDialogProps) {
  const [config, setConfig] = React.useState<CustomEndpointConfigInfo | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isClearing, setIsClearing] = React.useState(false)

  // Load config when dialog opens
  React.useEffect(() => {
    if (!open) {
      setConfig(null)
      setIsLoading(true)
      return
    }

    loadConfig()
  }, [open])

  const loadConfig = async () => {
    setIsLoading(true)
    try {
      const result = await window.electronAPI.getCustomEndpointConfig()
      setConfig(result)
    } catch (error) {
      console.error('Failed to load custom endpoint config:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleClear = async () => {
    setIsClearing(true)
    try {
      await window.electronAPI.clearCustomEndpointConfig()
      onClear()
      onOpenChange(false)
    } catch (error) {
      console.error('Failed to clear custom endpoint config:', error)
    } finally {
      setIsClearing(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Custom Endpoint Configuration</DialogTitle>
          <DialogDescription>
            Your current API endpoint settings
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Spinner className="w-6 h-6" />
          </div>
        ) : config?.hasConfig ? (
          <div className="space-y-4 py-2">
            {/* Base URL */}
            <ConfigRow
              icon={<Globe className="w-4 h-4" />}
              label="API Endpoint"
              value={config.baseUrl || '—'}
            />

            {/* API Key (masked) */}
            <ConfigRow
              icon={<Key className="w-4 h-4" />}
              label="API Key"
              value={config.maskedApiKey || 'Not configured'}
              isMasked
            />

            {/* Models */}
            {config.models && (config.models.sonnet || config.models.opus || config.models.haiku) && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Cpu className="w-4 h-4" />
                  <span>Models</span>
                </div>
                <div className="ml-6 space-y-1.5">
                  {config.models.sonnet && (
                    <ModelRow tier="Sonnet" model={config.models.sonnet} />
                  )}
                  {config.models.opus && (
                    <ModelRow tier="Opus" model={config.models.opus} />
                  )}
                  {config.models.haiku && (
                    <ModelRow tier="Haiku" model={config.models.haiku} />
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="py-8 text-center text-muted-foreground">
            No custom endpoint configured
          </div>
        )}

        <DialogFooter>
          {config?.hasConfig && (
            <Button
              variant="destructive"
              onClick={handleClear}
              disabled={isClearing}
            >
              {isClearing ? (
                <>
                  <Spinner className="mr-1.5" />
                  Clearing...
                </>
              ) : (
                'Clear Configuration'
              )}
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Configuration row with icon, label, and value
 */
function ConfigRow({
  icon,
  label,
  value,
  isMasked,
}: {
  icon: React.ReactNode
  label: string
  value: string
  isMasked?: boolean
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="text-muted-foreground mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className={`text-sm font-mono truncate ${isMasked ? 'text-muted-foreground' : ''}`}>
          {value}
        </div>
      </div>
    </div>
  )
}

/**
 * Model tier row
 */
function ModelRow({ tier, model }: { tier: string; model: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{tier}</span>
      <span className="font-mono truncate max-w-[250px]">{model}</span>
    </div>
  )
}
