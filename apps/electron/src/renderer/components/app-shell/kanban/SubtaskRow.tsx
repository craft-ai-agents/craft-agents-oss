import { CheckCircle2, Circle, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Spinner } from '@craft-agent/ui'
import { cn } from '@/lib/utils'
import { ModelChip } from './ModelChip'
import type { KanbanSubtask, SubtaskRunState } from './types'

/** Run-state glyph for a spawned subtask: done / running / pending / failed. */
function RunStateIcon({ runState }: { runState: SubtaskRunState }) {
  const { t } = useTranslation()
  switch (runState) {
    case 'done':
      return (
        <CheckCircle2
          className="h-3.5 w-3.5 shrink-0"
          style={{ color: 'var(--success)' }}
          aria-label={t('common.done')}
        />
      )
    case 'running':
      return <Spinner className="text-sm text-[color:var(--info)] shrink-0" />
    case 'failed':
      return (
        <XCircle
          className="h-3.5 w-3.5 shrink-0 text-red-500"
          strokeWidth={2}
          aria-label={t('common.failed')}
        />
      )
    case 'pending':
    default:
      return (
        <Circle
          className="h-3.5 w-3.5 shrink-0 text-foreground/30"
          strokeWidth={1.5}
          aria-label={t('common.pending')}
        />
      )
  }
}

interface SubtaskRowProps {
  subtask: KanbanSubtask
  className?: string
  /** When set, the row becomes a button that opens the subtask's session window. */
  onClick?: () => void
}

/** One spawned-subtask row: run-state icon + title + the model it was routed to. */
export function SubtaskRow({ subtask, className, onClick }: SubtaskRowProps) {
  const isDone = subtask.runState === 'done'
  const interactive = !!onClick
  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={
        interactive
          ? e => {
              e.stopPropagation()
              onClick?.()
            }
          : undefined
      }
      onKeyDown={
        interactive
          ? e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                onClick?.()
              }
            }
          : undefined
      }
      className={cn(
        'flex items-center gap-2 py-1',
        interactive &&
          '-mx-1 cursor-pointer rounded px-1 transition-colors hover:bg-foreground/[0.05] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50',
        className
      )}
    >
      <RunStateIcon runState={subtask.runState} />
      <span className={cn('flex-1 truncate text-xs', isDone ? 'text-foreground/45 line-through' : 'text-foreground/80')}>
        {subtask.title}
      </span>
      <ModelChip model={subtask.model} short className="w-20 shrink-0" />
    </div>
  )
}
