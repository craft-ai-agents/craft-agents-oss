/**
 * AutomationActionPreview
 *
 * Compact action list for expanded rows in AutomationCard and AutomationsListPanel.
 * Shows MessageSquare icon + truncated prompt text.
 *
 * For the full-size info page with index numbering and @mention highlighting,
 * use AutomationActionRow instead.
 */

import { MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AutomationAction } from './types'

export interface AutomationActionPreviewProps {
  actions: AutomationAction[]
  className?: string
}

export function AutomationActionPreview({ actions, className }: AutomationActionPreviewProps) {
  return (
    <div className={cn('space-y-1', className)}>
      {actions.map((action, i) => (
        <div key={i} className="flex items-start gap-2 text-xs">
          <MessageSquare className="h-3 w-3 text-foreground/50 mt-0.5 shrink-0" />
          <span className="text-foreground/70 break-words line-clamp-2">{action.prompt}</span>
        </div>
      ))}
    </div>
  )
}
