import { useTranslation } from 'react-i18next'
import { ShieldAlert, Check, X, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { PermissionRisk } from '@craft-agent/core/types'
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
 * - Action buttons: Allow, Always Allow (only when there is something to remember), Deny
 */
export function PermissionRequest({ request, onResponse, unstyled = false }: PermissionRequestProps) {
  const { t } = useTranslation()
  const canAlwaysAllow = request.canAlwaysAllow !== false
  // Decision-model risk badges (opt-in, informational). Literal keys keep the i18n coverage check effective.
  const riskLabels: Record<PermissionRisk, string> = {
    deletes: t('chat.permissionRisk.deletes'),
    sends: t('chat.permissionRisk.sends'),
    publishes: t('chat.permissionRisk.publishes'),
    credentials: t('chat.permissionRisk.credentials'),
    system: t('chat.permissionRisk.system'),
    spends: t('chat.permissionRisk.spends'),
  }

  // Risks a newer server may send that this client has no label for are left out.
  const risks = (request.risks ?? []).filter((risk) => Object.hasOwn(riskLabels, risk))
  const canRemember = request.canRemember !== false

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
    <div
      className={cn(
        'overflow-hidden h-full flex flex-col bg-info/5',
        unstyled
          ? 'border-0'
          : 'border border-info/30 rounded-[8px] shadow-middle'
      )}
      data-tutorial="permission-banner"
    >
      {/* Content - grows to fill available space and scrolls before actions disappear */}
      <div className="p-4 space-y-3 flex-1 min-h-0 flex flex-col overflow-y-auto">
        <div className="space-y-2 pb-1">
          <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <ShieldAlert className="h-3.5 w-3.5 text-info" />
            <span>{t('chat.permissionRequired')}</span>
          </div>
          <div className="text-xs leading-[18px] text-muted-foreground">
            <span className="font-medium text-foreground">{t('chat.permissionTool')}</span> {request.toolName}
            <br />
            {request.description}
          </div>
          {risks.length > 0 && (
            <div className="flex flex-wrap gap-1" title={t('chat.permissionRiskHint')}>
              {risks.map((risk) => (
                <span key={risk} className="rounded-[4px] bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                  {riskLabels[risk]}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Command preview */}
        {request.command && (
          <div className="bg-foreground/5 rounded-md p-3 font-mono text-xs text-foreground/90 whitespace-pre-wrap break-all max-h-24 overflow-y-auto">
            {request.command}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 border-t border-border/50">
        <Button
          size="sm"
          variant="default"
          className="h-7 gap-1.5"
          onClick={handleAllow}
          data-tutorial="permission-allow-button"
        >
          <Check className="h-3.5 w-3.5" />
          {t('chat.permissionAllow')}
        </Button>
        {canRemember && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 border border-foreground/10 hover:bg-foreground/5 active:bg-foreground/10"
            onClick={handleAlwaysAllow}
            disabled={!canAlwaysAllow}
            title={canAlwaysAllow ? undefined : 'Always Allow is disabled by managed settings'}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t('chat.permissionAlwaysAllow')}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 text-destructive hover:text-destructive border border-dashed border-destructive/50 hover:bg-destructive/10 hover:border-destructive/70 active:bg-destructive/20"
          onClick={handleDeny}
        >
          <X className="h-3.5 w-3.5" />
          {t('chat.permissionDeny')}
        </Button>

        {/* Tip text */}
        {canRemember && (
          <span className="min-w-0 flex-1 basis-full text-[10px] text-muted-foreground sm:basis-auto sm:text-right">
            {canAlwaysAllow
              ? t('chat.permissionAlwaysAllowTip')
              : '"Always Allow" is disabled by managed settings'}
          </span>
        )}
      </div>
    </div>
  )
}
