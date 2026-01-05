/**
 * PlanCard - Inline plan message component
 *
 * Displays a plan submitted by the agent for user review.
 * Uses the same markdown rendering and max height as TurnCard responses.
 * Includes an "Accept Plan" button that disables Safe Mode and submits
 * "Plan approved, please execute." to begin implementation.
 */

import * as React from 'react'
import { useState } from 'react'
import { Check, ListTodo, ChevronRight, ChevronDown, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Markdown } from '@/components/markdown'
import type { Message } from '../../../shared/types'

// ============================================================================
// Size Configuration (matches TurnCard)
// ============================================================================

const SIZE_CONFIG = {
  fontSize: 'text-[13px]',
  iconSize: 'w-3 h-3',
} as const

// ============================================================================
// Types
// ============================================================================

export interface PlanCardProps {
  /** The plan message */
  message: Message
  /** Session ID for scoping the approve-plan event */
  sessionId?: string
  /** Callback to open file in editor */
  onOpenFile?: (path: string) => void
  /** Callback to open URL */
  onOpenUrl?: (url: string) => void
  /** Callback to open plan content in Monaco editor */
  onPopOut?: (text: string) => void
  /** Whether a user message has been sent after this plan (hides the approve footer) */
  hasUserResponse?: boolean
}

// ============================================================================
// PlanCard Component
// ============================================================================

export function PlanCard({
  message,
  sessionId,
  onOpenFile,
  onOpenUrl,
  onPopOut,
  hasUserResponse = false,
}: PlanCardProps) {
  const [isExpanded, setIsExpanded] = useState(true)

  // Accept the plan: disable safe mode and submit "Plan approved, please execute." message
  // This uses the craft:approve-plan event which is handled by FreeFormInput
  // The sessionId ensures only the correct session processes this event
  const handleAcceptPlan = () => {
    window.dispatchEvent(new CustomEvent('craft:approve-plan', {
      detail: { text: 'Plan approved, please execute.', sessionId }
    }))
  }

  const MAX_HEIGHT = 540

  return (
    <div className="bg-background shadow-minimal rounded-[8px] overflow-hidden">
      {/* Header with plan indicator */}
      <div
        className={cn(
          "px-4 py-2 border-b border-border/30 flex items-center gap-2 bg-success/5 cursor-pointer",
          SIZE_CONFIG.fontSize
        )}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <ListTodo className={cn(SIZE_CONFIG.iconSize, "text-success")} />
        <span className="font-medium text-success">Plan</span>
        <div className="flex-1" />
        {isExpanded ? (
          <ChevronDown className={cn(SIZE_CONFIG.iconSize, "text-muted-foreground")} />
        ) : (
          <ChevronRight className={cn(SIZE_CONFIG.iconSize, "text-muted-foreground")} />
        )}
      </div>

      {/* Content area */}
      {isExpanded && (
        <>
          <div
            className="pl-[22px] pr-4 py-3 text-sm overflow-y-auto"
            style={{ maxHeight: MAX_HEIGHT }}
          >
            <Markdown
              mode="minimal"
              onUrlClick={onOpenUrl}
              onFileClick={onOpenFile}
            >
              {message.content}
            </Markdown>
          </div>

          {/* Footer with View as Markdown on left, Accept Plan on right - only shown until user responds */}
          {!hasUserResponse && (
            <div className={cn(
              "pl-4 pr-2.5 py-2 border-t border-border/30 flex items-center justify-between bg-muted/20",
              SIZE_CONFIG.fontSize
            )}>
              {/* Left side - View as Markdown */}
              {onPopOut ? (
                <button
                  onClick={() => onPopOut(message.content)}
                  className={cn(
                    "flex items-center gap-1.5 transition-colors",
                    "text-muted-foreground hover:text-foreground",
                    "focus:outline-none focus-visible:underline"
                  )}
                >
                  <ExternalLink className={SIZE_CONFIG.iconSize} />
                  <span>View as Markdown</span>
                </button>
              ) : (
                <div />
              )}

              {/* Right side - Accept Plan */}
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  Type your feedback in chat or
                </span>
                <button
                  type="button"
                  onClick={handleAcceptPlan}
                  className="h-[28px] pl-2.5 pr-2.5 text-xs font-medium rounded-[6px] flex items-center gap-1.5 transition-all bg-success/5 text-success hover:bg-success/10 shadow-tinted"
                  style={{ '--shadow-color': '34, 136, 82' } as React.CSSProperties}
                >
                  <Check className="h-3.5 w-3.5" />
                  <span>Accept Plan</span>
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
