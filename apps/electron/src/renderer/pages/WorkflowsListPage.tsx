import * as React from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Workflow as WorkflowIcon, Plus, Pencil, Trash2, Play, MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes } from '../../shared/routes'
import { useWorkflows } from '@/hooks/useWorkflows'
import { useWorkflowRuns } from '@/hooks/useWorkflowRuns'
import { WorkflowRunInputDialog } from './WorkflowRunInputDialog'
import type { WorkflowDTO, WorkflowRunDTO, WorkflowRunState } from '../../shared/types'

interface WorkflowsListPageProps {
  workspaceId: string
}

const NEW_WORKFLOW_BODY = `# New Workflow

Describe what this workflow does and any tips for running it.
`

const NEW_WORKFLOW_TEMPLATE = (slug: string) =>
  `---
name: ${slug.replace(/-/g, ' ')}
description: Describe this workflow.
trigger:
  type: manual
  inputs:
    - name: topic
      type: string
      required: true
steps:
  - id: research
    agent: researcher
    input: |
      Research "{{trigger.topic}}". Return a numbered list of findings.
---
${NEW_WORKFLOW_BODY}`

export default function WorkflowsListPage({ workspaceId }: WorkflowsListPageProps) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const { allWorkflows, loading, error, remove } = useWorkflows(workspaceId)
  const { runs } = useWorkflowRuns(workspaceId)
  const [runDialogWorkflow, setRunDialogWorkflow] = React.useState<WorkflowDTO | null>(null)

  // Most-recent run per workflow slug, for the "Last run" column.
  const lastRunBySlug = React.useMemo(() => {
    const map = new Map<string, WorkflowRunDTO>()
    for (const run of runs) {
      const existing = map.get(run.workflowSlug)
      if (!existing || (run.createdAt ?? '') > (existing.createdAt ?? '')) {
        map.set(run.workflowSlug, run)
      }
    }
    return map
  }, [runs])

  const handleNew = async () => {
    const name = window.prompt(t('workflows.list.newSlugPrompt'))
    if (!name) return
    const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
    if (!slug) {
      toast.error(t('workflows.list.invalidSlug'))
      return
    }
    try {
      const text = NEW_WORKFLOW_TEMPLATE(slug)
      const { parseWorkflowFile } = await import('@craft-agent/shared/workflows/parser')
      const parsed = parseWorkflowFile(text)
      if (!parsed) {
        toast.error(t('workflows.editor.parseError'))
        return
      }
      await window.electronAPI.upsertWorkflow({
        slug,
        metadata: parsed.metadata,
        body: parsed.body,
        activateInWorkspaceId: workspaceId,
      })
      navigate(routes.view.workflowEdit(slug))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleDelete = async (workflow: WorkflowDTO) => {
    if (!window.confirm(t('workflows.list.deleteConfirm', { name: workflow.metadata.name }))) return
    try {
      const ok = await remove(workflow.slug)
      if (ok) toast.success(t('workflows.list.deleted', { name: workflow.metadata.name }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border/30">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <WorkflowIcon className="h-4 w-4 text-muted-foreground" />
            <h1 className="text-base font-semibold">{t('sidebar.workflows')}</h1>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{t('workflows.list.subtitle')}</p>
        </div>
        <Button size="sm" onClick={handleNew}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          {t('workflows.list.new')}
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">{t('common.loading')}</div>
        ) : error ? (
          <div className="m-5 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
        ) : allWorkflows.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center text-muted-foreground">
            <WorkflowIcon className="h-8 w-8 opacity-50" />
            <div>
              <p className="text-sm font-medium text-foreground">{t('workflows.list.emptyTitle')}</p>
              <p className="text-xs mt-1">{t('workflows.list.emptyDesc')}</p>
            </div>
            <Button size="sm" onClick={handleNew}>{t('workflows.list.create')}</Button>
          </div>
        ) : (
          <div className="p-4">
            <div className="overflow-hidden rounded-md border border-border/40">
              <table className="w-full text-sm">
                <thead className="bg-foreground/[0.03] text-xs text-muted-foreground">
                  <tr>
                    <th className="text-left font-medium px-3 py-2">{t('workflows.list.col.name')}</th>
                    <th className="text-left font-medium px-3 py-2">{t('workflows.list.col.description')}</th>
                    <th className="text-left font-medium px-3 py-2 w-28">{t('workflows.list.col.trigger')}</th>
                    <th className="text-left font-medium px-3 py-2 w-28">{t('workflows.list.col.lastRun')}</th>
                    <th className="text-right font-medium px-3 py-2 w-32">{t('workflows.list.col.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {allWorkflows.map((wf) => {
                    const lastRun = lastRunBySlug.get(wf.slug)
                    return (
                      <tr key={wf.slug} className="border-t border-border/30">
                        <td className="px-3 py-2 min-w-0">
                          <button
                            type="button"
                            onClick={() => navigate(routes.view.workflow(wf.slug))}
                            className="flex items-center gap-2 text-left hover:underline"
                          >
                            <span className="text-sm">{wf.metadata.avatar?.trim() || '🪄'}</span>
                            <span className="font-medium truncate">{wf.metadata.name}</span>
                          </button>
                          <div className="text-xs text-muted-foreground truncate ml-6 font-mono">{wf.slug}</div>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground truncate max-w-[420px]">
                          {wf.metadata.description}
                        </td>
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center rounded-full bg-foreground/5 px-2 py-0.5 text-[11px] font-medium">
                            {wf.metadata.trigger.type}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {lastRun ? <RunStateDot state={lastRun.state} /> : <span className="text-xs text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => setRunDialogWorkflow(wf)}
                              className="h-7 px-2 inline-flex items-center gap-1 rounded-md hover:bg-foreground/5 text-xs"
                              aria-label={`Run ${wf.metadata.name}`}
                            >
                              <Play className="h-3 w-3" />
                              {t('workflows.list.run')}
                            </button>
                            <button
                              type="button"
                              onClick={() => navigate(routes.view.workflowEdit(wf.slug))}
                              className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-foreground/5"
                              aria-label={`Edit ${wf.metadata.name}`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDelete(wf)}
                              className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-foreground/5 text-destructive"
                              aria-label={`Delete ${wf.metadata.name}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {runDialogWorkflow && (
        <WorkflowRunInputDialog
          open={!!runDialogWorkflow}
          onOpenChange={(open) => { if (!open) setRunDialogWorkflow(null) }}
          workflow={runDialogWorkflow}
          workspaceId={workspaceId}
        />
      )}
    </div>
  )
}

export function RunStateDot({ state }: { state: WorkflowRunState }) {
  const color = (() => {
    switch (state) {
      case 'running': return 'bg-amber-500 animate-pulse'
      case 'succeeded': return 'bg-emerald-500'
      case 'failed': return 'bg-red-500'
      case 'interrupted': return 'bg-orange-500'
      case 'cancelled': return 'bg-zinc-400'
      case 'paused': return 'bg-blue-500'
      case 'queued':
      case 'created':
      default: return 'bg-zinc-300'
    }
  })()
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      <span className="text-xs text-muted-foreground capitalize">{state}</span>
    </span>
  )
}

// Avoid a "MoreHorizontal not used" lint warning if we ever drop the menu
// but keep the import grouped for parity with other tables.
void MoreHorizontal
