import * as React from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { CircleMinus, History, Pencil, Play, Plus, Trash2, Workflow as WorkflowIcon } from 'lucide-react'
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
  const { allWorkflows, activeWorkflows, activeSlugs, loading, error, remove, setActive } = useWorkflows(workspaceId)
  const { runs } = useWorkflowRuns(workspaceId)
  const [runDialogWorkflow, setRunDialogWorkflow] = React.useState<WorkflowDTO | null>(null)
  const activeSlugSet = React.useMemo(() => new Set(activeSlugs), [activeSlugs])
  const inactiveWorkflows = React.useMemo(
    () => allWorkflows.filter((wf) => !activeSlugSet.has(wf.slug)),
    [activeSlugSet, allWorkflows],
  )

  const lastRunBySlug = React.useMemo(() => {
    const map = new Map<string, WorkflowRunDTO>()
    for (const run of runs) {
      const existing = map.get(run.workflowSlug)
      if (!existing || (run.createdAt ?? '') > (existing.createdAt ?? '')) map.set(run.workflowSlug, run)
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

  const handleActivate = async (workflow: WorkflowDTO) => {
    try {
      await setActive(workflow.slug, true)
      toast.success(t('workflows.list.activated', { name: workflow.metadata.name }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleDeactivate = async (workflow: WorkflowDTO) => {
    try {
      await setActive(workflow.slug, false)
      toast.success(t('workflows.list.deactivated', { name: workflow.metadata.name }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_12%_0%,rgba(249,115,22,0.18),transparent_30%),#08080b]">
      <div className="flex items-center justify-between gap-4 border-b border-white/[0.06] px-8 py-7">
        <div className="min-w-0">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-[#fdba74]">
            <WorkflowIcon className="h-3 w-3" />
            Execution layer
          </div>
          <div className="flex items-center gap-3">
            <WorkflowIcon className="h-6 w-6 text-[#fb923c]" />
            <h1 className="text-[28px] font-semibold leading-tight text-white">{t('sidebar.workflows')}</h1>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/52">{t('workflows.list.subtitle')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(routes.view.recentRuns())}
            className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-white/[0.07] bg-white/[0.035] px-2.5 text-[11px] font-medium text-white/52 transition-colors hover:bg-white/[0.07] hover:text-white/78"
          >
            <History className="h-3.5 w-3.5" />
            {t('sidebar.workflows.recentRuns')}
          </button>
          <Button size="sm" onClick={handleNew} className="rounded-[10px] bg-[#f97316] text-white hover:bg-[#fb923c]">
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {t('workflows.list.new')}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-8 py-7">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-white/50">{t('common.loading')}</div>
        ) : error ? (
          <div className="rounded-[14px] border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>
        ) : activeWorkflows.length === 0 && inactiveWorkflows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-white/48">
            <WorkflowIcon className="h-9 w-9 opacity-60" />
            <div>
              <p className="text-sm font-medium text-white">{t('workflows.list.emptyTitle')}</p>
              <p className="mt-1 text-xs">{t('workflows.list.emptyDesc')}</p>
            </div>
            <Button size="sm" onClick={handleNew}>{t('workflows.list.create')}</Button>
          </div>
        ) : (
          <div className="space-y-8">
            <WorkflowSection title="Active in this workspace" count={activeWorkflows.length}>
              {activeWorkflows.length === 0 ? (
                <div className="rounded-[16px] border border-white/[0.08] bg-white/[0.03] px-4 py-8 text-center text-sm text-white/45">
                  No workflows are active in this workspace.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                  {activeWorkflows.map((wf) => (
                    <WorkflowCard
                      key={wf.slug}
                      workflow={wf}
                      active
                      lastRun={lastRunBySlug.get(wf.slug)}
                      onOpen={() => navigate(routes.view.workflow(wf.slug))}
                      onRun={() => setRunDialogWorkflow(wf)}
                      onEdit={() => navigate(routes.view.workflowEdit(wf.slug))}
                      onDelete={() => void handleDelete(wf)}
                      onActivate={() => void handleActivate(wf)}
                      onDeactivate={() => void handleDeactivate(wf)}
                    />
                  ))}
                </div>
              )}
            </WorkflowSection>

            {inactiveWorkflows.length > 0 && (
              <WorkflowSection title="Library" count={inactiveWorkflows.length} suffix="inactive">
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                  {inactiveWorkflows.map((wf) => (
                    <WorkflowCard
                      key={wf.slug}
                      workflow={wf}
                      active={false}
                      lastRun={lastRunBySlug.get(wf.slug)}
                      onOpen={() => navigate(routes.view.workflow(wf.slug))}
                      onRun={() => setRunDialogWorkflow(wf)}
                      onEdit={() => navigate(routes.view.workflowEdit(wf.slug))}
                      onDelete={() => void handleDelete(wf)}
                      onActivate={() => void handleActivate(wf)}
                      onDeactivate={() => void handleDeactivate(wf)}
                    />
                  ))}
                </div>
              </WorkflowSection>
            )}
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

function WorkflowSection({ title, count, suffix, children }: { title: string; count: number; suffix?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-white/42">{title}</h2>
        <div className="h-px flex-1 bg-white/[0.06]" />
        <span className="text-[11px] text-white/32">{count}{suffix ? ` ${suffix}` : ''}</span>
      </div>
      {children}
    </section>
  )
}

function WorkflowCard({
  workflow,
  active,
  lastRun,
  onOpen,
  onRun,
  onEdit,
  onDelete,
  onActivate,
  onDeactivate,
}: {
  workflow: WorkflowDTO
  active: boolean
  lastRun?: WorkflowRunDTO
  onOpen: () => void
  onRun: () => void
  onEdit: () => void
  onDelete: () => void
  onActivate: () => void
  onDeactivate: () => void
}) {
  return (
    <div className="group relative overflow-hidden rounded-[14px] border border-white/[0.075] bg-white/[0.035] p-3 pr-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#fb923c]/35 hover:bg-white/[0.06] hover:shadow-[0_14px_42px_rgba(0,0,0,0.30),0_0_28px_rgba(249,115,22,0.10)]">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#fb923c]/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] border border-white/[0.08] bg-gradient-to-br from-white/[0.10] to-white/[0.035] font-mono text-[8px] font-semibold uppercase tracking-[0.08em] text-[#fed7aa] shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]"
          aria-label={`Open ${workflow.metadata.name}`}
        >
          {getWorkflowInitials(workflow)}
        </button>
        <div className="min-w-0 flex-1">
          <button type="button" onClick={onOpen} className="block max-w-full truncate text-left text-sm font-semibold text-white hover:text-[#fed7aa]">
            {workflow.metadata.name}
          </button>
          <div className="mt-1 truncate font-mono text-[11px] text-white/30">{workflow.slug}</div>
        </div>
        <span className="rounded-full border border-white/[0.07] bg-black/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">
          {active ? workflow.metadata.trigger.type : 'inactive'}
        </span>
      </div>

      <p className="mt-3 line-clamp-2 min-h-10 text-xs leading-5 text-white/50">{workflow.metadata.description}</p>

      <div className="mt-3 flex items-center justify-between gap-3">
        <div>{lastRun ? <RunStateDot state={lastRun.state} /> : <span className="text-xs text-white/30">No runs yet</span>}</div>
        <div className="flex items-center gap-1">
          {active ? (
            <>
              <IconAction label="Run" onClick={onRun}><Play className="h-3.5 w-3.5" /></IconAction>
              <IconAction label="Deactivate" onClick={onDeactivate}><CircleMinus className="h-3.5 w-3.5" /></IconAction>
            </>
          ) : (
            <button type="button" onClick={onActivate} className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-[#fb923c]/25 bg-[#f97316]/18 px-2.5 text-xs font-medium text-[#fed7aa] hover:bg-[#f97316]/26">
              <Plus className="h-3.5 w-3.5" />
              Activate
            </button>
          )}
          <IconAction label="Edit" onClick={onEdit}><Pencil className="h-3.5 w-3.5" /></IconAction>
          <IconAction label="Delete" onClick={onDelete} danger><Trash2 className="h-3.5 w-3.5" /></IconAction>
        </div>
      </div>
    </div>
  )
}

function getWorkflowInitials(workflow: WorkflowDTO) {
  const source = workflow.metadata.name || workflow.slug
  return source
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || 'WF'
}

function IconAction({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-[9px] border border-white/[0.07] bg-white/[0.035] transition-colors hover:bg-white/[0.08] ${danger ? 'text-red-300/80 hover:text-red-200' : 'text-white/55 hover:text-white'}`}
    >
      {children}
    </button>
  )
}

export function RunStateDot({ state }: { state: WorkflowRunState }) {
  const color = (() => {
    switch (state) {
      case 'running': return 'bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.45)] animate-pulse'
      case 'succeeded': return 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.35)]'
      case 'failed': return 'bg-red-400 shadow-[0_0_12px_rgba(248,113,113,0.35)]'
      case 'interrupted': return 'bg-orange-400'
      case 'cancelled': return 'bg-zinc-400'
      case 'paused': return 'bg-blue-400'
      case 'queued':
      case 'created':
      default: return 'bg-zinc-300'
    }
  })()
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      <span className="text-xs capitalize text-white/42">{state}</span>
    </span>
  )
}
