/**
 * HookActionPreview
 *
 * Compact action list for expanded rows in HookCard and HooksListPanel.
 * Shows Terminal/MessageSquare icon + truncated command/prompt text.
 *
 * For the full-size info page with index numbering, $VAR highlighting,
 * and timeout display, use HookActionRow instead.
 */

import { Terminal, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { HookDefinition } from './types'

export interface HookActionPreviewProps {
  actions: HookDefinition[]
  className?: string
}

export function HookActionPreview({ actions, className }: HookActionPreviewProps) {
  return (
    <div className={cn('space-y-1', className)}>
      {actions.map((action, i) => (
        <div key={i} className="flex items-start gap-2 text-xs">
          {action.type === 'command' ? (
            <>
              <Terminal className="h-3 w-3 text-foreground/50 mt-0.5 shrink-0" />
              <code className="font-mono text-foreground/70 break-all line-clamp-2">{action.command}</code>
            </>
          ) : (
            <>
              <MessageSquare className="h-3 w-3 text-foreground/50 mt-0.5 shrink-0" />
              <span className="text-foreground/70 break-words line-clamp-2">{action.prompt}</span>
            </>
          )}
        </div>
      ))}
    </div>
  )
}
