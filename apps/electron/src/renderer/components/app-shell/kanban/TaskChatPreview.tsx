import { ArrowUp, Workflow } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SessionStatus } from '@/config/session-status-config'
import { StatusBadge } from './StatusBadge'
import { ModelChip } from './ModelChip'
import { SubtaskRow } from './SubtaskRow'
import type { KanbanProject, KanbanSubtask } from './types'

interface TaskChatPreviewProps {
  title: string
  project?: KanbanProject
  status?: SessionStatus
  /** Orchestrator model id for the task. */
  model: string
  /** The user's opening request. */
  userMessage: string
  /** Orchestrator's intro before it spawns subtasks. */
  assistantIntro: string
  /** Subtasks the orchestrator spawned (each routed to a best-fit model). */
  subtasks: KanbanSubtask[]
  /** Optional closing note after the subtask panel. */
  assistantFollowUp?: string
}

/**
 * The body of the focused, chat-only task window (no board, no sidebar).
 *
 * Presentational: header + a scrollable transcript that shows Task mode acting
 * as an orchestrator — it spawns subtasks and routes each to a best-fit model —
 * plus a non-functional input bar. Fed mock content by the playground.
 */
export function TaskChatPreview({
  title,
  project,
  status,
  model,
  userMessage,
  assistantIntro,
  subtasks,
  assistantFollowUp,
}: TaskChatPreviewProps) {
  return (
    <div className="flex h-full flex-col bg-background">
      {/* Title bar: project dot + title + status badge */}
      <div className="flex items-center gap-2 border-b border-border/50 px-4 py-3">
        {project && (
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: project.color }}
            aria-hidden
          />
        )}
        <span className="truncate text-sm font-medium text-foreground">{title}</span>
        {status && <StatusBadge status={status} className="ml-auto" />}
      </div>

      {/* Transcript */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          {/* User message */}
          <div className="flex justify-end">
            <div className="max-w-[80%] rounded-2xl bg-foreground/[0.06] px-3.5 py-2 text-sm text-foreground">
              {userMessage}
            </div>
          </div>

          {/* Task-mode orchestrator tag */}
          <div className="flex items-center gap-2 text-[11px] text-foreground/55">
            <Workflow className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
            <span className="font-medium">Task mode · orchestrator</span>
            <ModelChip model={model} />
          </div>

          {/* Orchestrator intro */}
          <p className="text-sm leading-relaxed text-foreground/90">{assistantIntro}</p>

          {/* Spawned subtasks panel */}
          {subtasks.length > 0 && (
            <div className="rounded-lg border border-border/60 bg-card p-3">
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Spawned subtasks
              </div>
              <div className="divide-y divide-border/40">
                {subtasks.map(subtask => (
                  <SubtaskRow key={subtask.id} subtask={subtask} />
                ))}
              </div>
            </div>
          )}

          {/* Follow-up */}
          {assistantFollowUp && (
            <p className="text-sm leading-relaxed text-foreground/90">{assistantFollowUp}</p>
          )}
        </div>
      </div>

      {/* Input bar (presentational) */}
      <div className="border-t border-border/50 px-4 py-3">
        <div className="mx-auto flex max-w-2xl items-center gap-2 rounded-xl border border-border/60 bg-card px-3 py-2">
          <ModelChip model={model} className="shrink-0" />
          <span className="flex-1 truncate text-sm text-foreground/40">Reply to this task…</span>
          <span
            className={cn(
              'grid h-7 w-7 shrink-0 place-items-center rounded-full',
              'bg-primary text-primary-foreground'
            )}
            aria-hidden
          >
            <ArrowUp className="h-4 w-4" strokeWidth={2} />
          </span>
        </div>
      </div>
    </div>
  )
}
