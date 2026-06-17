import * as React from 'react'
import { CircleHelp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Message } from '../../../shared/types'

interface AskRequestCardProps {
  message: Message
  sessionId: string
  /** Send the user's pick back to resume the turn (choice=null = skip/dismiss). */
  onRespondToAsk?: (sessionId: string, requestId: string, choice: string | null) => void
  /** Interactive only when no later user message exists (i.e. still awaiting an answer). */
  isInteractive?: boolean
}

/**
 * AskRequestCard — renders an agent multiple-choice question (authRequestType === 'ask').
 *
 * Pending + interactive: the question plus one button per option (and a skip). Tapping an
 * option calls onRespondToAsk, which resumes the conversation with that option as the user's
 * next message. Otherwise (answered, or a later user message exists) it collapses to a muted
 * one-liner. Styled to match the task launcher card (neutral, app-aligned).
 */
export function AskRequestCard({ message, sessionId, onRespondToAsk, isInteractive = true }: AskRequestCardProps) {
  const { authRequestId, authQuestion, authOptions, authStatus } = message
  const options = authOptions ?? []
  const pending = authStatus === 'pending'

  const pick = React.useCallback((choice: string | null) => {
    if (!authRequestId || !onRespondToAsk) return
    onRespondToAsk(sessionId, authRequestId, choice)
  }, [authRequestId, onRespondToAsk, sessionId])

  // Collapsed view: answered, non-interactive, or no responder wired.
  if (!pending || !isInteractive || !onRespondToAsk) {
    return (
      <div className="mt-2 w-fit max-w-full rounded-[10px] border border-border/50 bg-background px-3 py-2 text-[13px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <CircleHelp className="h-3.5 w-3.5 shrink-0" />
          {authQuestion}
        </span>
      </div>
    )
  }

  return (
    <div className="mt-2 w-full max-w-[28rem] rounded-[12px] border border-border/50 bg-background shadow-middle px-3 py-2.5 space-y-2.5">
      <div className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
        <CircleHelp className="h-4 w-4 shrink-0 text-foreground/60" />
        <span>{authQuestion}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => pick(opt)}
            className="flex items-center rounded-[8px] border border-border bg-background px-3 py-2 text-left text-[13px] text-foreground transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {opt}
          </button>
        ))}
      </div>
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs text-muted-foreground"
          onClick={() => pick(null)}
        >
          跳过
        </Button>
      </div>
    </div>
  )
}

export const MemoizedAskRequestCard = React.memo(AskRequestCard)
