/**
 * AutomationActionRow
 *
 * Inline display of a single automation action (prompt).
 * Used within the "Then" section of AutomationInfoPage.
 */

import { MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AutomationAction } from './types'

export interface AutomationActionRowProps {
  action: AutomationAction
  index: number
  className?: string
}

/**
 * Highlight @mentions in prompt strings
 */
function PromptText({ text }: { text: string }) {
  if (!text) return <span className="text-sm text-muted-foreground italic">Empty prompt</span>
  const parts = text.split(/(@\w[\w-]*)/g)
  return (
    <span className="text-sm break-words">
      {parts.map((part, i) =>
        part.startsWith('@') ? (
          <span key={i} className="text-accent font-medium">{part}</span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  )
}

export function AutomationActionRow({ action, index, className }: AutomationActionRowProps) {
  return (
    <div className={cn('flex items-start gap-3 px-4 py-3', className)}>
      {/* Index + icon — h-5 matches the first line height of text-sm content */}
      <div className="flex items-center gap-2 shrink-0 h-5 mt-[3px]">
        <span className="text-xs text-muted-foreground tabular-nums w-4 text-right">
          {index + 1}.
        </span>
        <MessageSquare className="h-3.5 w-3.5 text-foreground/50" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <PromptText text={action.prompt} />
      </div>
    </div>
  )
}
