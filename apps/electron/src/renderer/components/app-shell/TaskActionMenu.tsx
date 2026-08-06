import * as React from 'react'
import { useTranslation } from "react-i18next"
import { useSetAtom } from 'jotai'
import { ChevronDown, Square, ArrowUpRight, CheckCircle2, XCircle, AlertTriangle, X } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from '@/components/ui/styled-dropdown'
import { Spinner } from '@craft-agent/ui'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { BackgroundTask } from './ActiveTasksBar'
import { backgroundTasksAtomFamily } from '@/atoms/sessions'

/** Terminal data for overlay display */
export interface TerminalOverlayData {
  command: string
  output: string
  description?: string
  toolType: 'bash' | 'grep' | 'glob'
}

/** Format elapsed time in a compact way */
function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
}

/** Shorten task ID for compact display (show first 8 chars) */
function shortenId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}...` : id
}

export interface TaskActionMenuProps {
  /** Background task data */
  task: BackgroundTask
  /** Session ID for opening preview windows */
  sessionId: string
  /** Callback when kill button is clicked */
  onKillTask: (taskId: string) => void
  /** Callback to insert message into input field */
  onInsertMessage?: (text: string) => void
  /** Callback to show terminal output overlay */
  onShowTerminalOverlay?: (data: TerminalOverlayData) => void
  /** Additional class name */
  className?: string
}

/**
 * TaskActionMenu - Dropdown menu for background task actions
 *
 * Provides contextual actions for background tasks:
 * - View Output: Opens task output in terminal overlay
 * - Dismiss: Hides the renderer-only chip without stopping the task
 * - Stop Task: Kills shell tasks (agent tasks show warning)
 */
export function TaskActionMenu({ task, sessionId, onKillTask, onInsertMessage, onShowTerminalOverlay, className }: TaskActionMenuProps) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const setTasks = useSetAtom(backgroundTasksAtomFamily(sessionId))

  const isTerminal = task.status === 'completed'
    || task.status === 'failed'
    || task.status === 'stopped'
    || task.status === 'orphaned'

  // Wall-clock timer for RUNNING tasks. The async-by-default agent path emits no
  // task_progress events, so deriving elapsed from startTime (rather than relying
  // on elapsedSeconds) keeps the chip ticking for every task type. Terminal chips
  // freeze their elapsed at completedAt.
  const [localElapsed, setLocalElapsed] = React.useState(() => {
    return Math.floor((Date.now() - task.startTime) / 1000)
  })

  React.useEffect(() => {
    if (task.status !== 'running') return
    const interval = setInterval(() => {
      setLocalElapsed(Math.floor((Date.now() - task.startTime) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [task.status, task.startTime])

  const displayElapsed = isTerminal
    ? Math.max(0, Math.floor(((task.completedAt ?? Date.now()) - task.startTime) / 1000))
    : Math.max(localElapsed, task.elapsedSeconds)

  // Prefer the human-readable intent over the opaque task ID for the chip label.
  const taskLabel = task.intent?.trim() ?? ''

  const handleViewOutput = async () => {
    try {
      // Fetch task output via IPC (reads the file stored on task_completed).
      const output = await window.electronAPI.getTaskOutput(task.id)

      if (onShowTerminalOverlay) {
        // Preferred path: show in the terminal overlay.
        onShowTerminalOverlay({
          command: task.intent || `${task.type} task`,
          output: output || t('chat.noOutputYet'),
          description: task.intent,
          toolType: 'bash', // Use 'bash' for both shell and agent tasks
        })
      } else if (output) {
        // Fallback when no overlay handler is wired: copy the full output to the
        // clipboard so it's still retrievable. (Running tasks have no output yet.)
        await navigator.clipboard?.writeText(output)
        toast.success(t('toast.taskOutputCopied', 'Task output copied to clipboard'))
      } else {
        toast.info(t('chat.noOutputYet'))
      }
      setOpen(false)
    } catch (err) {
      toast.error(t('toast.failedToLoadTaskOutput'))
    }
  }

  const handleStopTask = () => {
    onKillTask(task.id)
    setOpen(false)
  }

  // Manually remove this chip from the bar. The chip is renderer-only state, so
  // dismissing it just hides the indicator — it never kills the underlying task
  // (shells use Stop for that). This is the escape hatch for a chip that got
  // stuck 'running' because its task_completed was lost.
  const handleDismiss = () => {
    setTasks((prev) => prev.filter((t) => t.id !== task.id))
    setOpen(false)
  }

  // Status → icon + tint. Running shows the spinner; terminal/orphaned states
  // are visually distinct so a chip never falsely reads as "still running".
  const statusTint = cn(
    "bg-white dark:bg-white/10",
    "hover:bg-white/80 dark:hover:bg-white/15",
    "data-[state=open]:bg-white/80 dark:data-[state=open]:bg-white/15",
    task.status === 'failed' && "bg-destructive/10 hover:bg-destructive/15 dark:bg-destructive/15",
    (task.status === 'orphaned' || task.status === 'stale') && "bg-amber-500/10 hover:bg-amber-500/15 dark:bg-amber-500/15",
  )

  const StatusIcon = () => {
    switch (task.status) {
      case 'completed':
        return <CheckCircle2 className="h-3.5 w-3.5 text-green-600 dark:text-green-500" />
      case 'failed':
        return <XCircle className="h-3.5 w-3.5 text-destructive" />
      case 'stopped':
        return <Square className="h-3 w-3 opacity-60" />
      case 'orphaned':
      case 'stale':
        return <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-500" />
      default:
        return <Spinner className="text-xs" />
    }
  }

  const statusLabel: Record<string, string> = {
    completed: t('chat.taskStatusDone', 'done'),
    failed: t('chat.taskStatusFailed', 'failed'),
    stopped: t('chat.taskStatusStopped', 'stopped'),
    orphaned: t('chat.taskStatusOrphaned', 'orphaned'),
    stale: t('common.unknown'),
  }

  const chipTitle = task.status === 'orphaned'
    ? t('chat.taskOrphanedHint', 'This background task was terminated when its turn ended.')
    : task.status === 'stale'
      ? t('chat.taskStaleHint')
      : t("chat.clickForTaskActions")

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "h-[30px] pl-2.5 pr-2 text-xs font-medium rounded-[8px]",
            "flex items-center gap-1.5 shrink-0 select-none",
            "transition-all shadow-minimal cursor-pointer",
            statusTint,
            className
          )}
          title={chipTitle}
        >
          {/* Status icon */}
          <div className="flex items-center justify-center shrink-0">
            <StatusIcon />
          </div>

          {/* Type badge */}
          <span className="opacity-60">
            {task.type === 'workflow'
              ? t('chat.taskTypeWorkflow')
              : task.type === 'agent'
                ? t('chat.taskTypeAgent')
                : t('chat.taskTypeShell')}
          </span>

          {/* Intent (the actual task description) — falls back to the shortened
              task ID only when no intent was captured. Truncated so a long intent
              can't blow up the chip; full text shown on hover. */}
          {taskLabel ? (
            <span className="opacity-80 truncate max-w-[220px]" title={taskLabel}>
              {taskLabel}
            </span>
          ) : (
            <span className="font-mono opacity-80">
              {shortenId(task.id)}
            </span>
          )}

          {/* Workflow fan-out progress: live count of completed sub-agents. */}
          {task.type === 'workflow' && (task.agentsCompleted ?? 0) > 0 && (
            <span
              className="opacity-60 tabular-nums"
              title={t('chat.workflowAgentsDone', { count: task.agentsCompleted ?? 0 })}
            >
              {t('chat.workflowAgentsDone', { count: task.agentsCompleted ?? 0 })}
            </span>
          )}

          {/* Elapsed time, or terminal status word */}
          {task.status === 'running' ? (
            <span className="opacity-60 tabular-nums">
              {formatElapsed(displayElapsed)}
            </span>
          ) : (
            <span className="opacity-70">
              {statusLabel[task.status] ?? task.status}
            </span>
          )}

          {/* Dropdown indicator */}
          <ChevronDown className="h-3.5 w-3.5 opacity-60 ml-auto" />
        </button>
      </DropdownMenuTrigger>
      <StyledDropdownMenuContent align="start" sideOffset={4}>
        {/* View Output - Primary action */}
        <StyledDropdownMenuItem onClick={handleViewOutput}>
          <ArrowUpRight />
          {t('chat.viewOutput')}
        </StyledDropdownMenuItem>

        {/* Dismiss - remove the chip (renderer-only; does not kill the task) */}
        <StyledDropdownMenuItem onClick={handleDismiss}>
          <X />
          {t('common.dismiss')}
        </StyledDropdownMenuItem>

        {/* Stop Task - Only show for shell tasks (inserts kill command into input) */}
        {task.type === 'shell' && (
          <>
            <StyledDropdownMenuSeparator />
            <StyledDropdownMenuItem onClick={handleStopTask}>
              <Square />
              {t('chat.stopTask')}
            </StyledDropdownMenuItem>
          </>
        )}
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}
