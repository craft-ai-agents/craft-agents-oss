import { useTranslation } from 'react-i18next'
import { Hand, RefreshCw, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { PermissionRisk } from '@craft-agent/core/types'
import type { PermissionRequest as PermissionRequestType } from '../../../../../shared/types'
import type { PermissionResponse } from './types'
import {
  DECISION_ACTION,
  DecisionActions,
  DecisionBody,
  DecisionCard,
  DecisionDetails,
  DecisionFoot,
  DecisionHeader,
  DecisionPreview,
  DecisionSpacer,
  type DecisionTone,
} from './DecisionCard'

interface PermissionRequestProps {
  request: PermissionRequestType
  onResponse: (response: PermissionResponse) => void
  /** When true, the composer slot (InputContainer) draws the card material and ring */
  unstyled?: boolean
}

/**
 * PermissionRequest - Self-contained structured input for permission approval
 *
 * Decision-card anatomy (spec §7.6): hand icon tile + "Permission required", the tool and its
 * description, decision-model risk chips (destructive ring + tile when present), the command in
 * a sunken well (scrollable), then Allow (primary) · Always Allow (secondary, only when there is
 * something to remember) · Deny (ghost).
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
  const tone: DecisionTone = risks.length > 0 ? 'danger' : 'info'

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
    <DecisionCard tone={tone} standalone={!unstyled} data-tutorial="permission-banner">
      {/* Content - grows to fill available space and scrolls before actions disappear */}
      <DecisionBody>
        <DecisionHeader
          tone={tone}
          icon={tone === 'danger' ? <TriangleAlert /> : <Hand />}
          title={t('chat.permissionRequired')}
        />
        <DecisionDetails>
          <p className="text-label text-secondary">
            <span className="font-medium text-foreground">{t('chat.permissionTool')}</span>{' '}
            <span className="font-mono text-mono-ui text-foreground">{request.toolName}</span>
            <br />
            {request.description}
          </p>
          {risks.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1" title={t('chat.permissionRiskHint')}>
              {risks.map((risk) => (
                <span key={risk} className="inline-flex h-5 items-center rounded-full bg-destructive-tint px-2 text-label-sm font-medium text-destructive">
                  {riskLabels[risk]}
                </span>
              ))}
            </div>
          )}

          {/* Command preview */}
          {request.command && (
            <DecisionPreview>{request.command}</DecisionPreview>
          )}
        </DecisionDetails>
      </DecisionBody>

      {/* Action buttons */}
      <DecisionActions>
        <Button
          variant="primary"
          size="lg"
          className={DECISION_ACTION}
          onClick={handleAllow}
          data-tutorial="permission-allow-button"
        >
          {t('chat.permissionAllow')}
        </Button>
        {canRemember && (
          <Button
            variant="secondary"
            size="lg"
            className={DECISION_ACTION}
            onClick={handleAlwaysAllow}
            disabled={!canAlwaysAllow}
            title={canAlwaysAllow ? undefined : 'Always Allow is disabled by managed settings'}
          >
            {t('chat.permissionAlwaysAllow')}
          </Button>
        )}
        <DecisionSpacer />
        <Button
          variant="ghost"
          size="lg"
          className={DECISION_ACTION}
          onClick={handleDeny}
        >
          {t('chat.permissionDeny')}
        </Button>
      </DecisionActions>

      {/* What "Always Allow" does */}
      {canRemember && (
        <DecisionFoot icon={<RefreshCw />}>
          {canAlwaysAllow ? t('chat.permissionAlwaysAllowTip') : '"Always Allow" is disabled by managed settings'}
        </DecisionFoot>
      )}
    </DecisionCard>
  )
}
