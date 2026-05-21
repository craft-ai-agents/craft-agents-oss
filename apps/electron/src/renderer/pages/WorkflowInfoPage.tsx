import * as React from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Pencil, Play, AlertTriangle, Workflow as WorkflowIcon, Plus, CircleMinus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes } from '../../shared/routes'
import { useWorkflowRuns } from '@/hooks/useWorkflowRuns'
import { useWorkflows } from '@/hooks/useWorkflows'
import { WorkflowRunInputDialog } from './WorkflowRunInputDialog'
import { RunStateDot } from './WorkflowsListPage'
import type { WorkflowDTO } from '../../shared/types'

interface Props {
  workflowSlug: string
  workspaceId: string
}

export default function WorkflowInfoPage({ workflowSlug, workspaceId }: Props) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const [workflow, setWorkflow] = React.useState<WorkflowDTO | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [runDialogOpen, setRunDialogOpen] = React.useState(false)
  const { runs } = useWorkflowRuns(workspaceId)
  const { activeSlugs, loading: workflowsLoading, setActive } = useWorkflows(workspaceId)

  React.useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        const loaded = await window.electronAPI.getWorkflow(workflowSlug)
        if (!mounted) return
        if (!loaded) {
          setLoadError(t('workflows.info.notFound', { slug: workflowSlug }))
          setWorkflow(null)
        } else {
          setWorkflow(loaded)
          setLoadError(null)
        }
      } catch (err) {
        if (!mounted) return
        setLoadError(err instanceof Error ? err.message : String(err))
      }
    }
    load()
    const cleanup = window.electronAPI.onWorkflowsChanged(() => load())
    return () => { mounted = false; cleanup() }
  }, [workflowSlug, t])

  const recentRuns = React.useMemo(() => runs.filter((r) => r.workflowSlug === workflowSlug).slice(0, 5), [runs, workflowSlug])
  const isActive = workflow ? activeSlugs.includes(workflow.slug) : false

  const handleActivate = async () => {
    if (!workflow) return
    try {
      await setActive(workflow.slug, true)
      toast.success(t('workflows.list.activated', { name: workflow.metadata.name }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleDeactivate = async () => {
    if (!workflow) return
    try {
      await setActive(workflow.slug, false)
      toast.success(t('workflows.list.deactivated', { name: workflow.metadata.name }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  if (loadError) {
    return (
      <div className="runneros-glass-route h-full">
        <div className="m-5 flex items-center gap-2 rounded-[14px] border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          <AlertTriangle className="h-4 w-4" />
          <span>{loadError}</span>
        </div>
      </div>
    )
  }
  if (!workflow) {
    return <div className="runneros-glass-route flex h-full items-center justify-center text-sm text-white/50">{t('common.loading')}</div>
  }

  return (
    <div className="runneros-glass-route h-full overflow-y-auto">
      <div className="runneros-page-wrap">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="runneros-page-title truncate">{workflow.metadata.name}</h1>
              <span className="inline-flex items-center rounded-full border border-white/[0.08] bg-white/[0.045] px-2 py-0.5 text-[11px] font-medium text-white/58">
                {isActive ? workflow.metadata.trigger.type : 'inactive'}
              </span>
            </div>
            <p className="runneros-page-subtitle">{workflow.metadata.description}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" variant="outline" className="border-white/[0.08] bg-white/[0.045] text-white/72 hover:bg-white/[0.08] hover:text-white" onClick={() => navigate(routes.view.workflowEdit(workflow.slug))}>
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              {t('common.edit')}
            </Button>
            {isActive ? (
              <>
                <Button size="sm" variant="outline" className="border-white/[0.08] bg-white/[0.045] text-white/72 hover:bg-white/[0.08] hover:text-white" onClick={() => void handleDeactivate()} disabled={workflowsLoading}>
                  <CircleMinus className="h-3.5 w-3.5 mr-1.5" />
                  {t('workflows.list.deactivate')}
                </Button>
                <Button size="sm" className="border border-[#fb923c]/25 bg-[#f97316]/18 text-white/90 hover:bg-[#f97316]/26" onClick={() => setRunDialogOpen(true)}>
                  <Play className="h-3.5 w-3.5 mr-1.5" />
                  {t('workflows.list.run')}
                </Button>
              </>
            ) : (
              <Button size="sm" className="border border-[#fb923c]/25 bg-[#f97316]/18 text-white/90 hover:bg-[#f97316]/26" onClick={() => void handleActivate()} disabled={workflowsLoading}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                {t('workflows.list.activate')}
              </Button>
            )}
          </div>
        </div>

      <div className="flex flex-col gap-5">
        <Section title={t('workflows.info.systemSection')}>
          <dl className="runneros-card grid grid-cols-[140px_1fr] gap-y-1 p-3 text-xs">
            <dt className="text-white/38">{t('workflows.info.slug')}</dt>
            <dd className="font-mono text-white/68">{workflow.slug}</dd>
            <dt className="text-white/38">{t('workflows.info.path')}</dt>
            <dd className="truncate font-mono text-white/68">{workflow.path}</dd>
            <dt className="text-white/38">{t('workflows.info.steps')}</dt>
            <dd className="text-white/68">{workflow.metadata.steps.length}</dd>
          </dl>
        </Section>

        <Section title={t('workflows.info.stepsSection')}>
          <ol className="flex flex-col gap-2">
            {workflow.metadata.steps.map((step, idx) => (
              <li key={step.id} className="runneros-card px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="w-5 shrink-0 text-xs text-white/38">{idx + 1}.</span>
                  <span className="font-mono text-xs text-white/72">{step.id}</span>
                  <span className="text-xs text-white/42">@{step.agent}</span>
                </div>
                {step.description && (
                  <p className="ml-7 mt-1 text-xs text-white/45">{step.description}</p>
                )}
              </li>
            ))}
          </ol>
        </Section>

        <Section title={t('workflows.info.recentRunsSection')}>
          {recentRuns.length === 0 ? (
            <p className="runneros-card px-3 py-2 text-xs text-white/45">{t('workflows.info.noRuns')}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {recentRuns.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => navigate(routes.view.workflowRun(r.id))}
                    className="runneros-card runneros-card-hover flex w-full items-center justify-between gap-3 px-2 py-1.5 text-left"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <RunStateDot state={r.state} />
                      <span className="font-mono text-xs text-white/68">{r.id.slice(0, 8)}</span>
                    </div>
                    <span className="text-xs text-white/42">{r.createdAt}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {runDialogOpen && (
        <WorkflowRunInputDialog
          open={runDialogOpen}
          onOpenChange={setRunDialogOpen}
          workflow={workflow}
          workspaceId={workspaceId}
        />
      )}
      <WorkflowIcon className="hidden" aria-hidden />
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/45">{title}</h2>
      {children}
    </section>
  )
}
