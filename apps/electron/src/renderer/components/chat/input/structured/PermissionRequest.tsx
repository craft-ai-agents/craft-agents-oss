import { Shield, Check, X, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { PermissionRequest as PermissionRequestType } from '../../../../../shared/types'
import type { PermissionResponse } from './types'

interface PermissionRequestProps {
  request: PermissionRequestType
  onResponse: (response: PermissionResponse) => void
  /** When true, removes container styling (shadow, rounded) - used when wrapped by InputContainer */
  unstyled?: boolean
}

/**
 * PermissionRequest - Self-contained structured input for permission approval
 *
 * Shows:
 * - Shield icon + "Permission Required" header
 * - Tool name badge
 * - Description of what the tool wants to do
 * - Command preview (scrollable)
 * - Action buttons: Allow, Always Allow, Deny
 */
export function PermissionRequest({ request, onResponse, unstyled = false }: PermissionRequestProps) {
  const handleAllow = () => {
    onResponse({ type: 'permission', allowed: true, alwaysAllow: false })
  }

  const handleAlwaysAllow = () => {
    onResponse({ type: 'permission', allowed: true, alwaysAllow: true })
  }

  const handleDeny = () => {
    onResponse({ type: 'permission', allowed: false, alwaysAllow: false })
  }

  return (
    <div className={cn(
      'bg-[#fffcf5] dark:bg-[#1a1608] overflow-hidden h-full flex flex-col',
      unstyled ? 'border-0' : 'border border-amber-500/30 rounded-[8px] shadow-middle'
    )}>
      {/* Content - grows to fill available space */}
      <div className="p-4 space-y-3 flex-1 min-h-0 flex flex-col">
        {/* Header with shield icon */}
        <div className="flex items-start gap-3">
          <div className="shrink-0 mt-0.5">
            <Shield className="h-5 w-5 text-amber-500" />
          </div>
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">Permission Required</span>
              <span className="text-xs text-muted-foreground">({request.toolName})</span>
            </div>
            <p className="text-xs text-muted-foreground">{request.description}</p>
          </div>
        </div>

        {/* Command preview */}
        {request.command && (
          <div className="bg-foreground/5 rounded-md p-3 font-mono text-xs text-foreground/90 whitespace-pre-wrap break-all max-h-24 overflow-y-auto">
            {request.command}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-border/50">
        <Button
          size="sm"
          variant="default"
          className="h-7 gap-1.5"
          onClick={handleAllow}
        >
          <Check className="h-3.5 w-3.5" />
          Allow
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 border border-foreground/10 hover:bg-foreground/5 active:bg-foreground/10"
          onClick={handleAlwaysAllow}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Always Allow
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 text-red-600 dark:text-red-400 hover:text-red-600 dark:hover:text-red-400 border border-dashed border-red-500/50 hover:bg-red-500/10 hover:border-red-500/70 active:bg-red-500/20"
          onClick={handleDeny}
        >
          <X className="h-3.5 w-3.5" />
          Deny
        </Button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Tip text */}
        <span className="text-[10px] text-muted-foreground">
          "Always Allow" remembers this command for the session
        </span>
      </div>
    </div>
  )
}
