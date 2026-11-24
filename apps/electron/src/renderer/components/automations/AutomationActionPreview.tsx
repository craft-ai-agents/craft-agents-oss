/**
 * AutomationActionPreview
 *
 * Compact action list for expanded rows in AutomationCard and AutomationsListPanel.
 * Shows MessageSquare/Webhook icon + truncated text.
 *
 * For the full-size info page with index numbering and @mention highlighting,
 * use AutomationActionRow instead.
 */

import { cn } from '@/lib/utils'
import type { AutomationAction } from './types'
import { ActionTypeIcon } from './ActionTypeIcon'
import { DEFAULT_SCRIPT_RUNTIME, DEFAULT_WEBHOOK_METHOD } from './constants'

export interface AutomationActionPreviewProps {
  actions: AutomationAction[]
  className?: string
}

export function AutomationActionPreview({ actions, className }: AutomationActionPreviewProps) {
  return (
    <div className={cn('space-y-1', className)}>
      {actions.map((action, i) => (
        <div key={i} className="flex items-start gap-2 text-label-sm">
          <ActionTypeIcon type={action.type} className="mt-0.5 size-3 shrink-0" />
          <span className="line-clamp-2 break-words text-secondary">
            {action.type === 'webhook'
              ? `${action.method ?? DEFAULT_WEBHOOK_METHOD} ${action.url}`
              : action.type === 'script'
                ? `${action.runtime ?? DEFAULT_SCRIPT_RUNTIME} ${action.script}`
                : action.prompt}
          </span>
        </div>
      ))}
    </div>
  )
}
