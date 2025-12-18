import { Shield, Check, X, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { PermissionRequest } from '../../../shared/types'

interface PermissionBannerProps {
  request: PermissionRequest
  onRespond: (allowed: boolean, alwaysAllow: boolean) => void
}

/**
 * PermissionBanner - Shows when agent needs approval for a bash command
 * Displays command and offers Yes/No/Always options
 */
export function PermissionBanner({ request, onRespond }: PermissionBannerProps) {
  return (
    <div className="mx-4 mb-4 p-4 rounded-lg border border-amber-500/50 bg-amber-500/10">
      <div className="flex items-start gap-3">
        <Shield className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 space-y-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">Permission Required</span>
              <span className="text-xs text-muted-foreground">({request.toolName})</span>
            </div>
            <p className="text-xs text-muted-foreground">{request.description}</p>
          </div>

          {/* Command preview */}
          <div className="bg-background/50 rounded-md p-2 font-mono text-xs text-foreground/90 whitespace-pre-wrap break-all">
            {request.command}
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="default"
              className="h-7 gap-1.5"
              onClick={() => onRespond(true, false)}
            >
              <Check className="h-3.5 w-3.5" />
              Allow
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 border border-foreground/10 hover:bg-background active:bg-background"
              onClick={() => onRespond(true, true)}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Always Allow
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 text-red-700 dark:text-red-300 hover:text-red-700 dark:hover:text-red-300 border border-dashed border-red-500/50 hover:bg-red-500/20 hover:border-red-500/70 active:bg-red-500/30"
              onClick={() => onRespond(false, false)}
            >
              <X className="h-3.5 w-3.5" />
              Deny
            </Button>
          </div>

          <p className="text-[10px] text-muted-foreground break-words">
            Tip: "Always Allow" remembers this command type for the current session
          </p>
        </div>
      </div>
    </div>
  )
}
