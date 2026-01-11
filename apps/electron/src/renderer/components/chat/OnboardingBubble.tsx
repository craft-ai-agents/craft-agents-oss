import * as React from 'react'
import { cn } from '@/lib/utils'
import { Markdown } from '@/components/markdown'
import { Button } from '@/components/ui/button'
import type { Message } from '../../../shared/types'
import type { QuickAction, SourceNeedingAuth } from '@craft-agent/shared/sessions'

interface OnboardingBubbleProps {
  message: Message
  /** Callback when user clicks a quick action button */
  onQuickAction?: (prompt: string) => void
  /** Callback when user wants to connect sources */
  onConnectSources?: (sources: SourceNeedingAuth[]) => void
}

/**
 * OnboardingBubble - Displays onboarding messages in the chat
 *
 * Renders welcome messages, source auth hints, and quick action buttons.
 * These appear at the start of new sessions to guide users.
 */
export function OnboardingBubble({
  message,
  onQuickAction,
  onConnectSources,
}: OnboardingBubbleProps) {
  const { onboardingWidget, onboardingData, content } = message

  // Quick actions widget - render action buttons
  if (onboardingWidget === 'quick-actions' && onboardingData?.actions) {
    const actions = onboardingData.actions as QuickAction[]
    return (
      <div className="flex flex-wrap gap-2 py-2">
        {actions.map((action) => (
          <Button
            key={action.id}
            variant="outline"
            size="sm"
            className="text-xs h-7 px-3 rounded-full border-border/50 hover:border-border hover:bg-accent/50"
            onClick={() => onQuickAction?.(action.prompt)}
          >
            {action.label}
          </Button>
        ))}
      </div>
    )
  }

  // Source auth widget - show sources needing authentication
  if (onboardingWidget === 'source-auth' && onboardingData?.sources) {
    const sources = onboardingData.sources as SourceNeedingAuth[]
    return (
      <div className="flex items-center gap-3 py-2">
        <div className="text-sm text-muted-foreground flex-1">
          <Markdown>{content}</Markdown>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="text-xs h-7 px-3 rounded-full border-border/50 hover:border-border hover:bg-accent/50 shrink-0"
          onClick={() => onConnectSources?.(sources)}
        >
          Connect
        </Button>
      </div>
    )
  }

  // Default: render as markdown text (welcome message)
  if (!content) return null

  return (
    <div className="py-1">
      <div className="text-sm text-muted-foreground">
        <Markdown>{content}</Markdown>
      </div>
    </div>
  )
}

/**
 * Memoized version for performance
 */
export const MemoizedOnboardingBubble = React.memo(OnboardingBubble, (prev, next) => {
  return (
    prev.message.id === next.message.id &&
    prev.message.content === next.message.content &&
    prev.message.onboardingWidget === next.message.onboardingWidget
  )
})
