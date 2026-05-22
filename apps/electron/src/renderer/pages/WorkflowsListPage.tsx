import * as React from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { CircleMinus, History, Pencil, Play, Plus, Trash2, X, Workflow as WorkflowIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
  const [detailWorkflow, setDetailWorkflow] = React.useState<WorkflowDTO | null>(null)
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
    <div className="runneros-glass-route h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-7 py-7">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[28px] font-semibold leading-tight text-white">{t('sidebar.workflows')}</h1>
            <p className="mt-1 max-w-md text-[12px] leading-[18px] text-white/54">{t('workflows.list.subtitle')}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => navigate(routes.view.recentRuns())}
              className="inline-flex h-7 items-center gap-1.5 rounded-[8px] border border-white/[0.08] bg-white/[0.045] px-2.5 text-[11px] font-medium text-white/72 transition-colors hover:bg-white/[0.08] hover:text-white"
            >
              <History className="h-3 w-3" />
              {t('sidebar.workflows.recentRuns')}
            </button>
            <button
              type="button"
              onClick={handleNew}
              className="inline-flex h-7 items-center gap-1.5 rounded-[8px] border border-[#fb923c]/25 bg-[#f97316]/16 px-2.5 text-[11px] font-medium text-white/86 shadow-[0_0_18px_rgba(249,115,22,0.16)] transition-colors hover:bg-[#f97316]/24"
            >
              <Plus className="h-3 w-3" />
              {t('workflows.list.new')}
            </button>
          </div>
        </div>

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
                <div className="rounded-[16px] border border-dashed border-white/[0.15] bg-white/[0.02] px-4 py-8 text-center text-sm text-white/60">
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
                      onOpen={() => setDetailWorkflow(wf)}
                      onRun={() => setRunDialogWorkflow(wf)}
                      onActivate={() => void handleActivate(wf)}
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
                      onOpen={() => setDetailWorkflow(wf)}
                      onRun={() => setRunDialogWorkflow(wf)}
                      onActivate={() => void handleActivate(wf)}
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
      {detailWorkflow && (
        <WorkflowDetailDialog
          workflow={detailWorkflow}
          active={activeSlugSet.has(detailWorkflow.slug)}
          lastRun={lastRunBySlug.get(detailWorkflow.slug)}
          onOpenChange={(open) => { if (!open) setDetailWorkflow(null) }}
          onRun={() => setRunDialogWorkflow(detailWorkflow)}
          onEdit={() => navigate(routes.view.workflowEdit(detailWorkflow.slug))}
          onDelete={() => void handleDelete(detailWorkflow)}
          onActivate={() => void handleActivate(detailWorkflow)}
          onDeactivate={() => void handleDeactivate(detailWorkflow)}
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
  onActivate,
}: {
  workflow: WorkflowDTO
  active: boolean
  lastRun?: WorkflowRunDTO
  onOpen: () => void
  onRun: () => void
  onActivate: () => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onOpen()
      }}
      className="group relative overflow-hidden rounded-[13px] border border-white/[0.07] bg-white/[0.035] p-3 text-left shadow-[0_2px_8px_rgb(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-white/[0.13] hover:bg-white/[0.055] hover:shadow-[0_8px_24px_rgba(0,0,0,0.24)]"
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onOpen()
          }}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] border border-white/[0.08] bg-gradient-to-br from-white/[0.10] to-white/[0.035] font-mono text-[8px] font-semibold uppercase tracking-[0.08em] text-[#fed7aa] shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]"
          aria-label={`Open ${workflow.metadata.name}`}
        >
          {getWorkflowInitials(workflow)}
        </button>
        <div className="min-w-0 flex-1">
          <button type="button" onClick={(event) => {
            event.stopPropagation()
            onOpen()
          }} className="block max-w-full truncate text-left text-sm font-semibold text-white hover:text-[#fed7aa]">
            {workflow.metadata.name}
          </button>
        </div>
        <span className="rounded-full border border-white/[0.09] bg-black/20 px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-white/50">
          {active ? workflow.metadata.trigger.type : 'inactive'}
        </span>
      </div>

      <p className="mt-2 line-clamp-2 min-h-9 text-[11.5px] leading-[18px] text-white/62">{workflow.metadata.description}</p>

      <div className="mt-2.5 flex items-center justify-between gap-3">
        <div>{lastRun ? <RunStateDot state={lastRun.state} /> : <span />}</div>
        <div className="flex items-center gap-1">
          {active ? (
            <IconAction label="Run" onClick={onRun}><Play className="h-3.5 w-3.5" /></IconAction>
          ) : (
            <button type="button" onClick={(event) => {
              event.stopPropagation()
              onActivate()
            }} className="inline-flex h-6 items-center gap-1 rounded-[7px] border border-[#fb923c]/18 bg-[#f97316]/12 px-2 text-[10.5px] font-medium text-[#fed7aa] hover:bg-[#f97316]/20">
              <Plus className="h-3 w-3" />
              Activate
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function WorkflowDetailDialog({
  workflow,
  active,
  lastRun,
  onOpenChange,
  onRun,
  onEdit,
  onDelete,
  onActivate,
  onDeactivate,
}: {
  workflow: WorkflowDTO
  active: boolean
  lastRun?: WorkflowRunDTO
  onOpenChange: (open: boolean) => void
  onRun: () => void
  onEdit: () => void
  onDelete: () => void
  onActivate: () => void
  onDeactivate: () => void
}) {
  const steps = workflow.metadata.steps ?? []
  const inputs = workflow.metadata.trigger.inputs ?? []

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="max-h-[86vh] max-w-3xl overflow-hidden !rounded-[18px] !border !border-white/[0.08] !bg-[#09090c] p-0 !text-white !shadow-[0_28px_90px_rgba(0,0,0,0.62)]">
        <DialogHeader className="border-b border-white/[0.06] bg-[#0b0b0f] px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-white/48">
                <WorkflowIcon className="h-3 w-3" />
                Workflow
              </div>
              <DialogTitle className="truncate text-[20px] font-semibold leading-tight text-white">
                {workflow.metadata.name}
              </DialogTitle>
              <DialogDescription className="mt-1 max-w-2xl text-sm leading-5 text-white/52">
                {workflow.metadata.description}
              </DialogDescription>
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-white/[0.07] bg-white/[0.04] text-white/54 transition-colors hover:bg-white/[0.08] hover:text-white"
              aria-label="Close workflow details"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </DialogHeader>

        <div className="max-h-[calc(86vh-86px)] overflow-y-auto px-5 py-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <InfoTile label="Status" value={active ? 'Active' : 'Inactive'} />
            <InfoTile label="Trigger" value={workflow.metadata.trigger.type} />
            <InfoTile label="Last run" value={lastRun ? lastRun.state : 'None'} />
          </div>

          {inputs.length > 0 && (
            <section className="mt-5">
              <SectionLabel>Inputs</SectionLabel>
              <div className="mt-2 flex flex-wrap gap-2">
                {inputs.map((input) => (
                  <span key={input.name} className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-xs text-white/62">
                    {input.name}{input.required ? ' *' : ''}
                  </span>
                ))}
              </div>
            </section>
          )}

          <section className="mt-5">
            <SectionLabel>Pipeline</SectionLabel>
            <div className="mt-2 space-y-2">
              {steps.map((step, index) => (
                <div key={step.id} className="rounded-[13px] border border-white/[0.065] bg-white/[0.035] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-white">{index + 1}. {step.id}</div>
                      <div className="mt-0.5 truncate font-mono text-[11px] text-white/38">@{step.agent}</div>
                    </div>
                    {step.retries ? (
                      <span className="rounded-full border border-white/[0.08] px-2 py-0.5 text-[10px] text-white/45">
                        {step.retries} retries
                      </span>
                    ) : null}
                  </div>
                  {step.description && (
                    <p className="mt-2 text-xs leading-5 text-white/54">{step.description}</p>
                  )}
                </div>
              ))}
            </div>
          </section>

          {workflow.body.trim() && (
            <section className="mt-5">
              <SectionLabel>Notes</SectionLabel>
              <div className="mt-2 max-h-44 overflow-y-auto rounded-[13px] border border-white/[0.065] bg-black/25 p-3 text-xs leading-5 text-white/54">
                {workflow.body.trim()}
              </div>
            </section>
          )}

          <div className="sticky bottom-0 -mx-5 mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] bg-[#09090c]/95 px-5 py-4 backdrop-blur-xl">
            <div className="flex items-center gap-2">
              {active ? (
                <>
                  <button type="button" onClick={onRun} className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-[#fb923c]/22 bg-[#f97316]/14 px-3 text-xs font-medium text-[#fed7aa] hover:bg-[#f97316]/22">
                    <Play className="h-3.5 w-3.5" />
                    Run
                  </button>
                  <button type="button" onClick={onDeactivate} className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-white/[0.08] bg-white/[0.04] px-3 text-xs font-medium text-white/58 hover:bg-white/[0.08] hover:text-white">
                    <CircleMinus className="h-3.5 w-3.5" />
                    Deactivate
                  </button>
                </>
              ) : (
                <button type="button" onClick={onActivate} className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-[#fb923c]/22 bg-[#f97316]/14 px-3 text-xs font-medium text-[#fed7aa] hover:bg-[#f97316]/22">
                  <Plus className="h-3.5 w-3.5" />
                  Activate
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={onEdit} className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-white/[0.08] bg-white/[0.04] px-3 text-xs font-medium text-white/58 hover:bg-white/[0.08] hover:text-white">
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </button>
              <button type="button" onClick={() => {
                onDelete()
                onOpenChange(false)
              }} className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-red-400/15 bg-red-500/8 px-3 text-xs font-medium text-red-200/70 hover:bg-red-500/14 hover:text-red-100">
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[13px] border border-white/[0.065] bg-white/[0.035] px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/34">{label}</div>
      <div className="mt-1 truncate text-sm font-medium capitalize text-white/76">{value}</div>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/40">{children}</h3>
      <div className="h-px flex-1 bg-white/[0.06]" />
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
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
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
