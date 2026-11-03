import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil, Play } from 'lucide-react'
import { toast } from 'sonner'
import { Spinner } from '@craft-agent/ui'
import { Markdown } from '@/components/markdown'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useOpenTaskEditor } from '@/hooks/useOpenTaskEditor'
import { taskBriefFromSpec, type TaskBriefContent } from './task-brief'

function BriefSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-label-sm font-semibold text-secondary">{label}</h3>
      {children}
    </section>
  )
}

interface TaskBriefProps {
  brief: TaskBriefContent
  /** Compact transcript column (its top padding is 16px, not 24px) */
  compact?: boolean
  /** The run call is in flight */
  starting?: boolean
  onRun?: () => void
  onEdit?: () => void
  onOpenUrl?: (url: string) => void
  onOpenFile?: (path: string) => void
}

/** An unrun task's goal, acceptance criteria and subtasks, with Run and Edit. */
export function TaskBrief({ brief, compact = false, starting = false, onRun, onEdit, onOpenUrl, onOpenFile }: TaskBriefProps) {
  const { t } = useTranslation()
  return (
    // The top padding clears the scroll area's 32px top fade together with the column's own,
    // since the brief always starts at the top (a message rarely does)
    <div className={cn('flex min-w-0 select-text flex-col gap-5 break-words text-copy text-foreground', compact ? 'pt-4' : 'pt-2')}>
      <BriefSection label={t('tasks.goal')}>
        <Markdown onUrlClick={onOpenUrl} onFileClick={onOpenFile}>{brief.goal}</Markdown>
      </BriefSection>
      {brief.acceptanceCriteria && (
        <BriefSection label={t('tasks.acceptanceCriteria')}>
          <Markdown onUrlClick={onOpenUrl} onFileClick={onOpenFile}>{brief.acceptanceCriteria}</Markdown>
        </BriefSection>
      )}
      {brief.subtasks.length > 0 && (
        <BriefSection label={t('kanban.subtasks')}>
          <ol className="flex flex-col gap-1">
            {brief.subtasks.map((title, index) => (
              <li key={index} className="flex gap-2.5">
                <span className="w-4 shrink-0 text-right tabular-nums text-tertiary">{index + 1}</span>
                <span className="min-w-0">{title}</span>
              </li>
            ))}
          </ol>
        </BriefSection>
      )}
      {(onRun || onEdit) && (
        <div className="flex flex-wrap items-center gap-2">
          {onRun && (
            <Button variant="primary" onClick={onRun} disabled={starting}>
              {starting ? <Spinner className="text-label" /> : <Play />}
              {starting ? t('tasks.starting') : t('tasks.runTask')}
            </Button>
          )}
          {onEdit && (
            <Button variant="secondary" onClick={onEdit}>
              <Pencil />
              {t('tasks.editTask')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

interface TaskBriefStateProps {
  workspaceId: string
  /** The task's orchestrator session */
  sessionId: string
  taskSlug: string
  title?: string
  compact?: boolean
  onOpenUrl?: (url: string) => void
  onOpenFile?: (path: string) => void
  /** Shown when the task has no readable spec */
  fallback: React.ReactNode
}

/**
 * The brief of a task session that hasn't run yet (its orchestrator has no messages until a
 * run's verification), read from task.yaml. Nothing shows while it loads, since the new-chat
 * empty state would flash first.
 */
export function TaskBriefState({ workspaceId, sessionId, taskSlug, title, compact, onOpenUrl, onOpenFile, fallback }: TaskBriefStateProps) {
  const { t } = useTranslation()
  const openTaskEditor = useOpenTaskEditor()
  const taskKey = `${workspaceId}/${taskSlug}`
  const [loaded, setLoaded] = React.useState<{ taskKey: string; brief: TaskBriefContent | null } | null>(null)
  const [starting, setStarting] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    window.electronAPI
      .getTask(workspaceId, taskSlug)
      .then(res => {
        if (!cancelled) setLoaded({ taskKey, brief: taskBriefFromSpec(res.spec) })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ taskKey, brief: null })
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId, taskSlug, taskKey])

  // Same call as the board tile's Run: the runner refuses a second run of the same task, and
  // its reason is the toast's description.
  const handleRun = React.useCallback(() => {
    setStarting(true)
    window.electronAPI
      .runTask(workspaceId, { slug: taskSlug, orchestratorSessionId: sessionId })
      .then(() => toast.success(t('tasks.toastStarted')))
      .catch((err: unknown) => {
        toast.error(t('tasks.toastRunFailed'), { description: err instanceof Error ? err.message : String(err) })
      })
      .finally(() => setStarting(false))
  }, [workspaceId, taskSlug, sessionId, t])

  const handleEdit = React.useCallback(() => openTaskEditor(sessionId, taskSlug, title), [openTaskEditor, sessionId, taskSlug, title])

  if (loaded?.taskKey !== taskKey) return null
  if (!loaded.brief) return <>{fallback}</>
  return (
    <TaskBrief
      brief={loaded.brief}
      compact={compact}
      starting={starting}
      onRun={handleRun}
      onEdit={handleEdit}
      onOpenUrl={onOpenUrl}
      onOpenFile={onOpenFile}
    />
  )
}
