import * as React from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Pencil, Play, AlertTriangle, Workflow as WorkflowIcon, Plus } from 'lucide-react'
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
      toast.success(`Activated ${workflow.metadata.name}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  if (loadError) {
    return (
      <div className="flex flex-col h-full min-h-0 bg-background">
        <div className="m-5 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          <span>{loadError}</span>
        </div>
      </div>
    )
  }
  if (!workflow) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t('common.loading')}</div>
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-background overflow-auto">
      <div className="px-5 py-4 border-b border-border/30">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-base">{workflow.metadata.avatar?.trim() || '🪄'}</span>
              <h1 className="text-base font-semibold truncate">{workflow.metadata.name}</h1>
              <span className="inline-flex items-center rounded-full bg-foreground/5 px-2 py-0.5 text-[11px] font-medium">
                {isActive ? workflow.metadata.trigger.type : 'inactive'}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{workflow.metadata.description}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" variant="outline" onClick={() => navigate(routes.view.workflowEdit(workflow.slug))}>
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              {t('common.edit')}
            </Button>
            {isActive ? (
              <Button size="sm" onClick={() => setRunDialogOpen(true)}>
                <Play className="h-3.5 w-3.5 mr-1.5" />
                {t('workflows.list.run')}
              </Button>
            ) : (
              <Button size="sm" onClick={() => void handleActivate()} disabled={workflowsLoading}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Activate
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="p-5 flex flex-col gap-5">
        <Section title={t('workflows.info.systemSection')}>
          <dl className="grid grid-cols-[140px_1fr] gap-y-1 text-xs">
            <dt className="text-muted-foreground">{t('workflows.info.slug')}</dt>
            <dd className="font-mono">{workflow.slug}</dd>
            <dt className="text-muted-foreground">{t('workflows.info.path')}</dt>
            <dd className="font-mono truncate">{workflow.path}</dd>
            <dt className="text-muted-foreground">{t('workflows.info.steps')}</dt>
            <dd>{workflow.metadata.steps.length}</dd>
          </dl>
        </Section>

        <Section title={t('workflows.info.stepsSection')}>
          <ol className="flex flex-col gap-2">
            {workflow.metadata.steps.map((step, idx) => (
              <li key={step.id} className="rounded-md border border-border/40 px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-5 shrink-0">{idx + 1}.</span>
                  <span className="font-mono text-xs">{step.id}</span>
                  <span className="text-xs text-muted-foreground">@{step.agent}</span>
                </div>
                {step.description && (
                  <p className="text-xs text-muted-foreground mt-1 ml-7">{step.description}</p>
                )}
              </li>
            ))}
          </ol>
        </Section>

        <Section title={t('workflows.info.recentRunsSection')}>
          {recentRuns.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('workflows.info.noRuns')}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {recentRuns.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => navigate(routes.view.workflowRun(r.id))}
                    className="w-full flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-foreground/5 text-left"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <RunStateDot state={r.state} />
                      <span className="font-mono text-xs">{r.id.slice(0, 8)}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{r.createdAt}</span>
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
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{title}</h2>
      {children}
    </section>
  )
}
