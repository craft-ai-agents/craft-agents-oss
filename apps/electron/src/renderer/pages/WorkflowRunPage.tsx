import * as React from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Square, RotateCcw, AlertTriangle, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes } from '../../shared/routes'
import { useWorkflowRuns } from '@/hooks/useWorkflowRuns'
import { WorkflowRunInputDialog } from './WorkflowRunInputDialog'
import type {
  WorkflowDTO,
  WorkflowRunDTO,
  WorkflowRunStep,
  WorkflowRunStepState,
} from '../../shared/types'

interface Props {
  runId: string
  workspaceId: string
}

const PREVIEW_LIMIT = 120

export default function WorkflowRunPage({ runId, workspaceId }: Props) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const { runs, cancel } = useWorkflowRuns(workspaceId)
  const [hydratedRun, setHydratedRun] = React.useState<WorkflowRunDTO | null>(null)
  const [hydrateError, setHydrateError] = React.useState<string | null>(null)
  const [workflow, setWorkflow] = React.useState<WorkflowDTO | null>(null)
  const [rerunOpen, setRerunOpen] = React.useState(false)
  const [now, setNow] = React.useState(() => Date.now())

  // Hydrate on mount; live updates flow through useWorkflowRuns broadcast.
  React.useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        const r = await window.electronAPI.getWorkflowRun(workspaceId, runId)
        if (!mounted) return
        if (!r) {
          setHydrateError(t('workflows.run.notFound'))
          return
        }
        setHydratedRun(r)
      } catch (err) {
        if (!mounted) return
        setHydrateError(err instanceof Error ? err.message : String(err))
      }
    }
    load()
    return () => { mounted = false }
  }, [workspaceId, runId, t])

  // Prefer the version pushed via broadcast (live), fall back to the
  // hydrated one taken at mount.
  const run: WorkflowRunDTO | null = React.useMemo(() => {
    const live = runs.find((r) => r.id === runId)
    return live ?? hydratedRun
  }, [runs, runId, hydratedRun])

  // Tick once a second so the elapsed-time header refreshes while running.
  React.useEffect(() => {
    if (!run || run.state !== 'running') return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [run])

  // Resolve the workflow snapshot's slug to a live WorkflowDTO so the Rerun
  // dialog has access to the input schema. We fetch the *current* version of
  // the workflow — by design re-runs use the latest definition, not the
  // run's frozen snapshot.
  React.useEffect(() => {
    if (!run) return
    let mounted = true
    window.electronAPI.getWorkflow(run.workflowSlug).then((wf) => {
      if (mounted) setWorkflow(wf)
    }).catch(() => {})
    return () => { mounted = false }
  }, [run])

  const handleCancel = async () => {
    if (!run) return
    try {
      await cancel(run.id)
      toast.success(t('workflows.run.cancelled'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  if (hydrateError) {
    return (
      <div className="m-5 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" />
        <span>{hydrateError}</span>
      </div>
    )
  }
  if (!run) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t('common.loading')}</div>
  }

  const startedAtMs = run.createdAt ? Date.parse(run.createdAt) : 0
  const completedAtMs = run.completedAt ? Date.parse(run.completedAt) : (run.state === 'running' ? now : startedAtMs)
  const elapsedMs = startedAtMs ? Math.max(0, completedAtMs - startedAtMs) : 0
  const elapsedLabel = formatElapsed(elapsedMs)

  const snapshotName = run.workflowSnapshot.metadata.name

  return (
    <div className="flex flex-col h-full min-h-0 bg-background overflow-auto">
      <div className="px-5 py-4 border-b border-border/30">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => navigate(routes.view.workflow(run.workflowSlug))}
              className="text-base font-semibold truncate hover:underline"
            >
              {snapshotName}
            </button>
            <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
              <span>{t('workflows.run.runIdLabel')} <span className="font-mono">{run.id.slice(0, 8)}</span></span>
              <span>{t('workflows.run.state')}: <span className="capitalize">{run.state}</span></span>
              <span>{t('workflows.run.elapsed')}: {elapsedLabel}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {run.state === 'running' && (
              <Button size="sm" variant="outline" onClick={handleCancel}>
                <Square className="h-3.5 w-3.5 mr-1.5" />
                {t('workflows.run.cancel')}
              </Button>
            )}
            <Button size="sm" onClick={() => setRerunOpen(true)} disabled={!workflow}>
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              {t('workflows.run.rerun')}
            </Button>
          </div>
        </div>
      </div>

      <div className="p-5 flex flex-col gap-3 max-w-3xl">
        {run.steps.map((step, idx) => (
          <StepCard
            key={step.id}
            step={step}
            index={idx}
            agentSlug={run.workflowSnapshot.metadata.steps[idx]?.agent ?? '?'}
            onOpenSession={(sid) => navigate(routes.view.allSessions(sid))}
          />
        ))}
      </div>

      {workflow && (
        <WorkflowRunInputDialog
          open={rerunOpen}
          onOpenChange={setRerunOpen}
          workflow={workflow}
          workspaceId={workspaceId}
          initialInputs={run.trigger.inputs}
        />
      )}
    </div>
  )
}

function StepCard({
  step,
  index,
  agentSlug,
  onOpenSession,
}: {
  step: WorkflowRunStep
  index: number
  agentSlug: string
  onOpenSession: (sessionId: string) => void
}) {
  const { t } = useTranslation()
  const preview = formatOutputPreview(step.output)
  return (
    <div className={`rounded-md border px-3 py-3 ${stepBorder(step.state)}`}>
      <div className="flex items-center gap-2">
        <StepIcon state={step.state} />
        <span className="text-xs text-muted-foreground w-5 shrink-0">{index + 1}.</span>
        <span className="font-mono text-sm">{step.id}</span>
        <span className="text-xs text-muted-foreground">@{agentSlug}</span>
        <span className="text-[11px] text-muted-foreground capitalize ml-auto">{step.state}</span>
      </div>
      {preview && (
        <div className="mt-1.5 ml-7 text-xs text-muted-foreground whitespace-pre-wrap break-words">
          {preview}
        </div>
      )}
      {step.state === 'failed' && step.error && (
        <div className="mt-1.5 ml-7 text-xs text-destructive">
          <span className="font-mono">{step.error.code}</span>: {step.error.message}
        </div>
      )}
      {step.sessionId && (
        <button
          type="button"
          onClick={() => onOpenSession(step.sessionId!)}
          className="mt-1.5 ml-7 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="h-3 w-3" />
          {t('workflows.run.viewSession')}
        </button>
      )}
    </div>
  )
}

function StepIcon({ state }: { state: WorkflowRunStepState }) {
  switch (state) {
    case 'running':
      return <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
    case 'succeeded':
      return <span className="h-2 w-2 rounded-full bg-emerald-500" />
    case 'failed':
      return <span className="h-2 w-2 rounded-full bg-red-500" />
    case 'skipped':
      return <span className="h-2 w-2 rounded-full border border-zinc-400" />
    case 'awaiting-human':
      return <span className="text-[11px]">⏸</span>
    case 'queued':
    default:
      return <span className="h-2 w-2 rounded-full bg-zinc-300" />
  }
}

function stepBorder(state: WorkflowRunStepState): string {
  switch (state) {
    case 'running': return 'border-amber-500/30 bg-amber-500/[0.03]'
    case 'succeeded': return 'border-emerald-500/30 bg-emerald-500/[0.03]'
    case 'failed': return 'border-red-500/30 bg-red-500/[0.03]'
    case 'skipped': return 'border-border/40 opacity-70'
    default: return 'border-border/40'
  }
}

function formatOutputPreview(output: unknown): string | null {
  if (output == null) return null
  const text = typeof output === 'string' ? output : JSON.stringify(output)
  if (!text) return null
  return text.length > PREVIEW_LIMIT ? text.slice(0, PREVIEW_LIMIT) + '…' : text
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return '0s'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  if (m < 60) return `${m}m ${rem}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}
