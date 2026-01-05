import { Shield, Check, X, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { PermissionRequest } from '../../../shared/types'

interface PermissionBannerProps {
  request: PermissionRequest
  onRespond: (allowed: boolean, alwaysAllow: boolean) => void
}

/**
 * PermissionBanner - Shows when agent needs approval for a tool
 * Replaces the input field with command preview and approval buttons
 * Uses same container styling as input field (rounded-[8px] shadow-middle bg-background)
 */
export function PermissionBanner({ request, onRespond }: PermissionBannerProps) {
  return (
    <div className="rounded-[8px] border shadow-middle overflow-hidden py-2 bg-info/5 border-info/30">
      <div className="p-4 space-y-3">
        {/* Header with shield icon */}
        <div className="flex items-start gap-3">
          <div className="shrink-0 mt-0.5">
            <Shield className="h-5 w-5 text-info" />
          </div>
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">
                Permission Required
              </span>
              <span className="text-xs text-muted-foreground">({request.toolName})</span>
            </div>
            <p className="text-xs text-muted-foreground">{request.description}</p>
          </div>
        </div>

        {/* Command preview - max 3 lines, scrollable if longer */}
        <div className="bg-foreground/5 rounded-md p-3 font-mono text-xs text-foreground/90 whitespace-pre-wrap break-all max-h-24 overflow-y-auto">
          {request.command}
        </div>
      </div>

      {/* Action buttons - bottom bar matching input field footer */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-border/50">
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
          className="h-7 gap-1.5 border border-foreground/10 hover:bg-foreground/5 active:bg-foreground/10"
          onClick={() => onRespond(true, true)}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Always Allow
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 text-destructive hover:text-destructive border border-dashed border-destructive/50 hover:bg-destructive/10 hover:border-destructive/70 active:bg-destructive/20"
          onClick={() => onRespond(false, false)}
        >
          <X className="h-3.5 w-3.5" />
          Deny
        </Button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Tip text on the right */}
        <span className="text-[10px] text-muted-foreground">
          "Always Allow" remembers this command for the session
        </span>
      </div>
    </div>
  )
}
