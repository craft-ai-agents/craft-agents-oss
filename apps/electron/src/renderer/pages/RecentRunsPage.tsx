import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { History } from 'lucide-react'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes } from '../../shared/routes'
import { useWorkflowRuns } from '@/hooks/useWorkflowRuns'
import { useWorkflows } from '@/hooks/useWorkflows'
import { RunStateDot } from './WorkflowsListPage'

interface Props {
  workspaceId: string
}

export default function RecentRunsPage({ workspaceId }: Props) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const { runs, loading, error } = useWorkflowRuns(workspaceId)
  const { allWorkflows } = useWorkflows(workspaceId)

  const nameBySlug = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const wf of allWorkflows) map.set(wf.slug, wf.metadata.name)
    return map
  }, [allWorkflows])

  // Phase 1 has no pagination; cap at 100 newest to keep render predictable.
  const top = React.useMemo(() => runs.slice(0, 100), [runs])

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border/30">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            <h1 className="text-base font-semibold">{t('sidebar.workflows.recentRuns')}</h1>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{t('workflows.recentRuns.subtitle')}</p>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">{t('common.loading')}</div>
        ) : error ? (
          <div className="m-5 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
        ) : top.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">{t('workflows.recentRuns.empty')}</div>
        ) : (
          <div className="p-4">
            <div className="overflow-hidden rounded-md border border-border/40">
              <table className="w-full text-sm">
                <thead className="bg-foreground/[0.03] text-xs text-muted-foreground">
                  <tr>
                    <th className="text-left font-medium px-3 py-2">{t('workflows.recentRuns.col.workflow')}</th>
                    <th className="text-left font-medium px-3 py-2 w-28">{t('workflows.recentRuns.col.runId')}</th>
                    <th className="text-left font-medium px-3 py-2 w-24">{t('workflows.recentRuns.col.trigger')}</th>
                    <th className="text-left font-medium px-3 py-2 w-32">{t('workflows.recentRuns.col.state')}</th>
                    <th className="text-left font-medium px-3 py-2 w-44">{t('workflows.recentRuns.col.started')}</th>
                    <th className="text-left font-medium px-3 py-2 w-24">{t('workflows.recentRuns.col.duration')}</th>
                  </tr>
                </thead>
                <tbody>
                  {top.map((r) => {
                    const startedMs = r.createdAt ? Date.parse(r.createdAt) : 0
                    const completedMs = r.completedAt ? Date.parse(r.completedAt) : 0
                    const durationMs = startedMs && completedMs ? Math.max(0, completedMs - startedMs) : 0
                    return (
                      <tr key={r.id} className="border-t border-border/30 hover:bg-foreground/[0.02] cursor-pointer" onClick={() => navigate(routes.view.workflowRun(r.id))}>
                        <td className="px-3 py-2 truncate">{nameBySlug.get(r.workflowSlug) ?? r.workflowSlug}</td>
                        <td className="px-3 py-2 font-mono text-xs">{r.id.slice(0, 8)}</td>
                        <td className="px-3 py-2 text-xs">{r.trigger.type}</td>
                        <td className="px-3 py-2"><RunStateDot state={r.state} /></td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{r.createdAt}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{durationMs ? `${Math.round(durationMs / 1000)}s` : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
