import * as React from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Check, ExternalLink, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { routes } from '../../shared/routes'
import { useNavigation } from '@/contexts/NavigationContext'
import { useDeepResearchRuns } from '@/hooks/useDeepResearchRuns'
import type { DeepResearchRunDTO } from '../../shared/types'

interface Props {
  runId: string
  workspaceId: string
}

export default function DeepResearchRunPage({ runId, workspaceId }: Props) {
  const { navigate } = useNavigation()
  const { runs, approve, cancel } = useDeepResearchRuns(workspaceId)
  const [hydratedRun, setHydratedRun] = React.useState<DeepResearchRunDTO | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let mounted = true
    window.electronAPI.getDeepResearchRun(workspaceId, runId).then((run) => {
      if (!mounted) return
      if (!run) setError('Deep research run not found.')
      else setHydratedRun(run)
    }).catch((err) => {
      if (mounted) setError(err instanceof Error ? err.message : String(err))
    })
    return () => { mounted = false }
  }, [workspaceId, runId])

  const run = React.useMemo(() => runs.find((item) => item.id === runId) ?? hydratedRun, [hydratedRun, runId, runs])

  const handleApprove = async () => {
    try {
      await approve(runId)
      toast.success('Plan approved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleCancel = async () => {
    try {
      await cancel(runId)
      toast.success('Run cancelled')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  if (error) {
    return (
      <div className="m-5 flex items-center gap-2 rounded-[14px] border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
        <AlertTriangle className="h-4 w-4" />
        <span>{error}</span>
      </div>
    )
  }

  if (!run) {
    return <div className="runneros-glass-route flex h-full items-center justify-center text-sm text-white/50">Loading...</div>
  }

  return (
    <div className="runneros-glass-route h-full overflow-y-auto">
      <div className="runneros-page-wrap">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="runneros-page-title truncate">{run.title}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-white/48">
              <span>Deep Research</span>
              <span>State: <StateLabel state={run.state} /></span>
              <span className="font-mono">{run.id.slice(0, 8)}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {run.state === 'awaiting_plan_approval' && (
              <Button size="sm" onClick={handleApprove}>
                <Check className="mr-1.5 h-3.5 w-3.5" />
                Approve plan
              </Button>
            )}
            {run.state === 'running' && (
              <Button size="sm" variant="outline" className="border-white/[0.08] bg-white/[0.045] text-white/72 hover:bg-white/[0.08] hover:text-white" onClick={handleCancel}>
                <Square className="mr-1.5 h-3.5 w-3.5" />
                Cancel
              </Button>
            )}
            {run.outputId && (
              <Button size="sm" variant="outline" className="border-white/[0.08] bg-white/[0.045] text-white/72 hover:bg-white/[0.08] hover:text-white" onClick={() => navigate(routes.view.output(run.outputId!))}>
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                Open report
              </Button>
            )}
          </div>
        </div>

        <section className="mb-5 rounded-[10px] border border-white/[0.08] bg-white/[0.035] p-4">
          <div className="text-sm font-medium text-white/85">Topic</div>
          <p className="mt-2 text-sm leading-6 text-white/68">{run.topic}</p>
          {run.error && <p className="mt-3 text-sm text-red-300">{run.error}</p>}
        </section>

        <section className="mb-5 rounded-[10px] border border-white/[0.08] bg-white/[0.035] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-sm font-medium text-white/85">Plan</div>
            <div className="text-xs text-white/45">{run.planPolicy === 'auto' ? 'Auto mode' : 'Approve mode'}</div>
          </div>
          <div className="space-y-3">
            {run.plan.steps.map((step, index) => (
              <div key={step.id} className="rounded-[8px] border border-white/[0.06] bg-black/10 p-3">
                <div className="flex items-center gap-2 text-sm text-white/82">
                  <span className="font-mono text-xs text-white/42">{index + 1}</span>
                  <span>{step.title}</span>
                  <span className="text-xs text-white/35">{step.kind}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-white/58">{step.instructions}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[10px] border border-white/[0.08] bg-white/[0.035] p-4">
          <div className="mb-3 text-sm font-medium text-white/85">Execution</div>
          <div className="space-y-3">
            {run.steps.map((step) => (
              <div key={step.id} className="rounded-[8px] border border-white/[0.06] bg-black/10 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm text-white/78">{step.title}</div>
                  <StateLabel state={step.state} />
                </div>
                {step.output && <p className="mt-2 line-clamp-6 whitespace-pre-wrap text-xs leading-5 text-white/56">{step.output}</p>}
                {step.error && <p className="mt-2 text-xs text-red-300">{step.error}</p>}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

function StateLabel({ state }: { state: string }) {
  const tone = state === 'succeeded'
    ? 'text-emerald-300'
    : state === 'failed' || state === 'cancelled'
      ? 'text-red-300'
      : state === 'running'
        ? 'text-sky-300'
        : 'text-amber-300'
  return <span className={tone}>{state.replaceAll('_', ' ')}</span>
}
