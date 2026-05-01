import * as React from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Square, RotateCcw, AlertTriangle, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useNavigation } from '@/contexts/NavigationContext'
import { useAppShellContext } from '@/context/AppShellContext'
import { StructuredInput } from '@/components/app-shell/input/StructuredInput'
import { routes } from '../../shared/routes'
import { useWorkflowRuns } from '@/hooks/useWorkflowRuns'
import { useAgents } from '@/hooks/useAgents'
import { WorkflowRunInputDialog } from './WorkflowRunInputDialog'
import type { AdminApprovalResponse, PermissionResponse, StructuredInputState, StructuredResponse } from '@/components/app-shell/input/structured/types'
import type {
  CredentialResponse,
  WorkflowDTO,
  WorkflowMetadataDTO,
  WorkflowRunDTO,
  WorkflowRunStep,
  WorkflowRunStepState,
} from '../../shared/types'

interface Props {
  runId: string
  workspaceId: string
}

const PREVIEW_LIMIT = 120
const DETAIL_PREVIEW_LIMIT = 2000
const TOKEN_RE = /\{\{\s*([^}]+?)\s*\}\}/g

type WorkflowStepDefinition = WorkflowMetadataDTO['steps'][number]
type LooseRecord = Record<string, unknown>

export default function WorkflowRunPage({ runId, workspaceId }: Props) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const { runs, cancel } = useWorkflowRuns(workspaceId)
  const { allAgents } = useAgents(workspaceId)
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

  const workflowSnapshot = run.workflowSnapshot
  const snapshotMetadata = workflowSnapshot?.metadata
  const snapshotSteps = snapshotMetadata?.steps ?? []
  const snapshotName = snapshotMetadata?.name ?? run.workflowSlug
  const runSteps = run.steps ?? []
  const agentNameBySlug = new Map(allAgents.map((agent) => [agent.slug, agent.metadata.name]))

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

      <div className="p-5 flex flex-col gap-5 max-w-5xl">
        <Section title="Run snapshot">
          <div className="rounded-md border border-border/40 bg-foreground/[0.02] px-3 py-3">
            <KeyValueGrid
              items={[
                ['Run ID', run.id],
                ['Workflow', run.workflowSlug],
                ['Workspace', run.workspaceId],
                ['State', run.state],
                ['Trigger', run.trigger?.type],
                ['Fired', run.trigger?.firedAt],
                ['Created', run.createdAt],
                ['Updated', run.updatedAt],
                ['Completed', run.completedAt],
                ['Snapshot name', snapshotMetadata?.name],
                ['Snapshot description', snapshotMetadata?.description],
                ['Snapshot steps', snapshotSteps.length],
                ['Body chars', typeof workflowSnapshot?.body === 'string' ? workflowSnapshot.body.length : undefined],
              ]}
            />
            <DetailBlock title="Trigger inputs" value={run.trigger?.inputs} defaultOpen={hasCompactObject(run.trigger?.inputs)} />
            <DetailBlock title="Snapshot metadata" value={snapshotMetadata} />
            {workflowSnapshot?.body && (
              <DetailBlock title="Snapshot body" value={workflowSnapshot.body} />
            )}
          </div>
        </Section>

        <Section title="Steps">
          {runSteps.map((step, idx) => (
            <StepCard
              key={step.id}
              step={step}
              index={idx}
              stepDef={snapshotSteps[idx]}
              priorSteps={runSteps.slice(0, idx)}
              run={run}
              agentNameBySlug={agentNameBySlug}
              onOpenSession={(sid) => navigate(routes.view.allSessions(sid))}
            />
          ))}
        </Section>
      </div>

      {workflow && (
        <WorkflowRunInputDialog
          open={rerunOpen}
          onOpenChange={setRerunOpen}
          workflow={workflow}
          workspaceId={workspaceId}
          initialInputs={run.trigger?.inputs ?? {}}
        />
      )}
    </div>
  )
}

function StepCard({
  step,
  index,
  stepDef,
  priorSteps,
  run,
  agentNameBySlug,
  onOpenSession,
}: {
  step: WorkflowRunStep
  index: number
  stepDef?: WorkflowStepDefinition
  priorSteps: WorkflowRunStep[]
  run: WorkflowRunDTO
  agentNameBySlug: Map<string, string>
  onOpenSession: (sessionId: string) => void
}) {
  const { t } = useTranslation()
  const { pendingPermissions, pendingCredentials, onRespondToPermission, onRespondToCredential } = useAppShellContext()
  const preview = formatOutputPreview(step.output)
  const looseStep = step as unknown as LooseRecord
  const pendingPermission = step.sessionId ? pendingPermissions.get(step.sessionId)?.[0] : undefined
  const pendingCredential = step.sessionId ? pendingCredentials.get(step.sessionId)?.[0] : undefined
  const structuredInput = React.useMemo<StructuredInputState | undefined>(() => {
    if (pendingPermission) {
      if (pendingPermission.type === 'admin_approval') {
        return {
          type: 'admin_approval',
          data: {
            appName: pendingPermission.appName || pendingPermission.toolName || 'System action',
            reason: pendingPermission.reason || pendingPermission.description,
            impact: pendingPermission.impact,
            command: pendingPermission.command || '',
            requiresSystemPrompt: pendingPermission.requiresSystemPrompt ?? true,
            rememberForMinutes: pendingPermission.rememberForMinutes ?? 10,
          },
        }
      }
      return { type: 'permission', data: pendingPermission }
    }
    if (pendingCredential) {
      return { type: 'credential', data: pendingCredential }
    }
    return undefined
  }, [pendingPermission, pendingCredential])

  const handleStructuredResponse = React.useCallback((response: StructuredResponse) => {
    if ((response.type === 'permission' || response.type === 'admin_approval') && pendingPermission && onRespondToPermission) {
      if (response.type === 'permission') {
        const permissionResponse = response as PermissionResponse
        onRespondToPermission(
          pendingPermission.sessionId,
          pendingPermission.requestId,
          permissionResponse.allowed,
          permissionResponse.alwaysAllow,
        )
        return
      }

      const adminResponse = response as AdminApprovalResponse
      onRespondToPermission(
        pendingPermission.sessionId,
        pendingPermission.requestId,
        adminResponse.approved,
        false,
        { rememberForMinutes: adminResponse.rememberForMinutes },
      )
      return
    }

    if (response.type === 'credential' && pendingCredential && onRespondToCredential) {
      onRespondToCredential(
        pendingCredential.sessionId,
        pendingCredential.requestId,
        response as CredentialResponse,
      )
    }
  }, [onRespondToCredential, onRespondToPermission, pendingCredential, pendingPermission])

  const agentSlug = firstString(
    looseStep.agentSlug,
    looseStep.agent,
    stepDef?.agent,
    '?',
  )
  const agentName = firstString(
    looseStep.agentName,
    getNestedString(looseStep, ['spawnedFromAgent', 'agentName']),
    agentSlug ? agentNameBySlug.get(agentSlug) : undefined,
  )
  const resolvedInput = firstString(
    looseStep.resolvedInput,
    looseStep.resolvedPrompt,
    looseStep.prompt,
    looseStep.input,
  ) ?? (
    stepDef?.input && canResolveStepInput(stepDef.input, priorSteps)
      ? resolveStepInput(stepDef.input, run, priorSteps)
      : null
  )
  const maxAttempts = Math.max(1, (stepDef?.retries ?? 0) + 1)
  const timing = formatTiming(step.startedAt, step.completedAt)
  const outputKind = stepDef?.outputSchema ? 'Structured output' : 'Raw output'
  const rawOutput = firstValue(looseStep.rawOutput, looseStep.rawAssistantText, looseStep.raw)
  const structuredOutput = firstValue(looseStep.structuredOutput, looseStep.parsedOutput)

  return (
    <div className={`rounded-md border px-3 py-3 ${stepBorder(step.state)}`}>
      <div className="flex items-center gap-2 min-w-0">
        <StepIcon state={step.state} />
        <span className="text-xs text-muted-foreground w-5 shrink-0">{index + 1}.</span>
        <span className="font-mono text-sm truncate">{step.id}</span>
        <span className="text-xs text-muted-foreground truncate">
          @{agentSlug}{agentName && agentName !== agentSlug ? ` - ${agentName}` : ''}
        </span>
        <span className="text-[11px] text-muted-foreground capitalize ml-auto">{step.state}</span>
      </div>

      <div className="mt-2 ml-7">
        <KeyValueGrid
          compact
          items={[
            ['Attempts', `${step.attempts ?? 0}/${maxAttempts}`],
            ['Retries', stepDef?.retries ?? 0],
            ['Started', step.startedAt],
            ['Completed', step.completedAt],
            ['Timing', timing],
            ['Timeout', stepDef?.timeout != null ? `${stepDef.timeout}s` : undefined],
            ['Failure', stepDef?.onFailure],
            ['Completion', formatCompletionSummary(step.completion)],
            ['Session', step.sessionId],
          ]}
        />
      </div>

      {stepDef?.description && (
        <div className="mt-1.5 ml-7 text-xs text-muted-foreground whitespace-pre-wrap break-words">
          {stepDef.description}
        </div>
      )}
      {preview && !isDetailOpenByDefault(step.output) && (
        <div className="mt-1.5 ml-7 text-xs text-muted-foreground whitespace-pre-wrap break-words">
          {preview}
        </div>
      )}
      {step.state === 'failed' && step.error && (
        <div className="mt-2 ml-7 text-xs text-destructive">
          <span className="font-mono">{step.error.code}</span>: {step.error.message}
        </div>
      )}
      {structuredInput && (
        <div className="mt-3 ml-7 max-w-2xl min-h-[220px] rounded-md border border-info/30 bg-info/5 p-2">
          <StructuredInput
            state={structuredInput}
            onResponse={handleStructuredResponse}
            unstyled
          />
        </div>
      )}
      <div className="mt-2 ml-7 flex flex-col gap-1.5">
        <DetailBlock title="Resolved input / prompt" value={resolvedInput} defaultOpen={!!resolvedInput && step.state !== 'queued'} />
        {stepDef?.input && stepDef.input !== resolvedInput && (
          <DetailBlock title="Input template" value={stepDef.input} />
        )}
        {stepDef?.outputSchema && (
          <DetailBlock title="Output schema" value={stepDef.outputSchema} />
        )}
        {stepDef?.completion && (
          <DetailBlock title="Completion contract" value={stepDef.completion} />
        )}
        <DetailBlock title="Raw output" value={rawOutput} defaultOpen={isDetailOpenByDefault(rawOutput)} />
        <DetailBlock title="Structured output" value={structuredOutput} defaultOpen={isDetailOpenByDefault(structuredOutput)} />
        <DetailBlock title={outputKind} value={step.output} defaultOpen={isDetailOpenByDefault(step.output)} />
        <DetailBlock title="Completion evidence" value={step.completion} defaultOpen={step.state === 'failed' && !!step.completion} />
        <DetailBlock title="Error" value={step.error} defaultOpen={step.state === 'failed'} />
        <DetailBlock title="Step record" value={step} />
      </div>
      {step.sessionId && (
        <button
          type="button"
          onClick={() => onOpenSession(step.sessionId!)}
          className="mt-2 ml-7 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{title}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  )
}

function KeyValueGrid({
  items,
  compact = false,
}: {
  items: Array<[string, unknown]>
  compact?: boolean
}) {
  const visible = items
    .map(([label, value]) => [label, formatScalar(value)] as const)
    .filter(([, value]) => value != null && value !== '')

  if (visible.length === 0) return null

  return (
    <dl className={`grid ${compact ? 'grid-cols-[92px_minmax(0,1fr)]' : 'grid-cols-[130px_minmax(0,1fr)]'} gap-x-3 gap-y-1 text-xs`}>
      {visible.map(([label, value]) => (
        <React.Fragment key={label}>
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words font-mono text-foreground/85">{value}</dd>
        </React.Fragment>
      ))}
    </dl>
  )
}

function DetailBlock({
  title,
  value,
  defaultOpen = false,
}: {
  title: string
  value: unknown
  defaultOpen?: boolean
}) {
  if (value == null || value === '') return null
  const text = formatDetail(value)
  if (!text) return null
  const display = text.length > DETAIL_PREVIEW_LIMIT
    ? `${text.slice(0, DETAIL_PREVIEW_LIMIT)}\n... truncated ${text.length - DETAIL_PREVIEW_LIMIT} chars`
    : text

  return (
    <details className="text-xs text-muted-foreground" open={defaultOpen}>
      <summary className="cursor-pointer select-none hover:text-foreground">
        {title} <span className="font-mono text-[11px] text-muted-foreground/80">{text.length} chars</span>
      </summary>
      <pre className="mt-1.5 max-h-80 overflow-auto rounded-md border border-border/40 bg-background/70 p-2 font-mono text-[11px] leading-relaxed text-foreground/85 whitespace-pre-wrap break-words">
        {display}
      </pre>
    </details>
  )
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
  return text.length > PREVIEW_LIMIT ? text.slice(0, PREVIEW_LIMIT) + '...' : text
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

function formatTiming(startedAt: string | undefined, completedAt: string | undefined): string | undefined {
  if (!startedAt) return undefined
  const started = Date.parse(startedAt)
  const completed = completedAt ? Date.parse(completedAt) : Date.now()
  if (!Number.isFinite(started) || !Number.isFinite(completed)) return undefined
  return formatElapsed(Math.max(0, completed - started))
}

function formatCompletionSummary(completion: WorkflowRunStep['completion']): string | undefined {
  if (!completion) return undefined
  const parts = [
    completion.satisfied ? 'satisfied' : 'not satisfied',
    `${completion.outputChars} chars`,
  ]
  if (completion.toolUseCount !== undefined) {
    parts.push(`${completion.toolUseCount} tools`)
  }
  return parts.join(' · ')
}

function formatScalar(value: unknown): string | undefined {
  if (value == null) return undefined
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return formatDetail(value)
}

function formatDetail(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function isDetailOpenByDefault(value: unknown): boolean {
  if (value == null) return false
  if (typeof value !== 'string') return true
  return value.length > PREVIEW_LIMIT || value.includes('\n')
}

function hasCompactObject(value: unknown): boolean {
  return !!value && typeof value === 'object' && Object.keys(value as LooseRecord).length > 0
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value
  }
  return undefined
}

function firstValue(...values: unknown[]): unknown {
  for (const value of values) {
    if (value != null && value !== '') return value
  }
  return undefined
}

function getNestedString(record: LooseRecord, path: string[]): string | undefined {
  let current: unknown = record
  for (const part of path) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as LooseRecord)[part]
  }
  return typeof current === 'string' && current.trim() ? current : undefined
}

function canResolveStepInput(template: string, priorSteps: WorkflowRunStep[]): boolean {
  const available = new Set(priorSteps.filter((step) => step.state === 'succeeded').map((step) => step.id))
  for (const match of template.matchAll(TOKEN_RE)) {
    const expr = match[1] ?? ''
    const parts = expr.split('.').map((part) => part.trim()).filter(Boolean)
    if (parts[0] === 'steps' && parts[1] && !available.has(parts[1])) return false
  }
  return true
}

function resolveStepInput(
  template: string,
  run: WorkflowRunDTO,
  priorSteps: WorkflowRunStep[],
): string {
  const steps: Record<string, { output: unknown }> = {}
  for (const step of priorSteps) {
    if (step.state === 'succeeded') steps[step.id] = { output: step.output }
  }

  return template.replace(TOKEN_RE, (_match, expr: string) => {
    const parts = expr.split('.').map((part) => part.trim()).filter(Boolean)
    const head = parts[0]
    if (head === 'trigger') return stringifyTemplateValue(dotWalk(run.trigger?.inputs, parts.slice(1)))
    if (head === 'run') {
      if (parts[1] === 'id') return run.id
      if (parts[1] === 'startedAt') return run.createdAt
      return ''
    }
    if (head === 'steps') {
      const stepId = parts[1]
      if (!stepId || parts[2] !== 'output') return ''
      return stringifyTemplateValue(dotWalk(steps[stepId]?.output, parts.slice(3)))
    }
    return ''
  })
}

function dotWalk(root: unknown, parts: string[]): unknown {
  let current = root
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as LooseRecord)[part]
  }
  return current
}

function stringifyTemplateValue(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}
