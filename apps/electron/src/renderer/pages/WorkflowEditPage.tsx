import * as React from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Save, X, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes } from '../../shared/routes'
import { useWorkflows } from '@/hooks/useWorkflows'
import { useAgents } from '@/hooks/useAgents'
import { Info_Badge } from '@/components/info/Info_Badge'
import { parseWorkflowFile, serializeWorkflow } from '@craft-agent/shared/workflows/parser'
import type { AgentDefinitionDTO, WorkflowDTO } from '../../shared/types'

interface Props {
  workflowSlug: string
  workspaceId: string
}

/**
 * Raw WORKFLOW.md editor. Phase 1 ships source-mode only — round-trips
 * through `parseWorkflowFile` + `serializeWorkflow` so users can edit the
 * full file as text and save back through the existing upsert RPC.
 */
export default function WorkflowEditPage({ workflowSlug, workspaceId }: Props) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const { upsert } = useWorkflows(workspaceId)
  const { allAgents, activeSlugs, loading: agentsLoading, error: agentsError } = useAgents(workspaceId)
  const [text, setText] = React.useState<string>('')
  const [originalSlug, setOriginalSlug] = React.useState<string>('')
  const [parseError, setParseError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        const loaded: WorkflowDTO | null = await window.electronAPI.getWorkflow(workflowSlug)
        if (!mounted) return
        if (!loaded) {
          setLoadError(t('workflows.info.notFound', { slug: workflowSlug }))
          setLoading(false)
          return
        }
        setText(serializeWorkflow(loaded.metadata, loaded.body))
        setOriginalSlug(loaded.slug)
        setLoading(false)
      } catch (err) {
        if (!mounted) return
        setLoadError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      }
    }
    load()
    return () => { mounted = false }
  }, [workflowSlug, t])

  // Live parse so the Save button can disable the moment the file is broken.
  const parsed = React.useMemo(() => {
    if (!text) return null
    return parseWorkflowFile(text)
  }, [text])

  React.useEffect(() => {
    if (!text) { setParseError(null); return }
    setParseError(parsed ? null : t('workflows.editor.parseError'))
  }, [parsed, text, t])

  const agentBySlug = React.useMemo(() => {
    return new Map(allAgents.map((agent) => [agent.slug, agent]))
  }, [allAgents])

  const activeAgentSlugs = React.useMemo(() => new Set(activeSlugs), [activeSlugs])
  const stepAgentIssues = React.useMemo(() => {
    if (agentsLoading || agentsError) return []
    if (!parsed) return []
    return parsed.metadata.steps.flatMap((step) => {
      const agent = agentBySlug.get(step.agent)
      if (!agent) {
        return [{
          stepId: step.id,
          agentSlug: step.agent,
          message: `Step "${step.id}" references @${step.agent}, which is not in the global agent library.`,
        }]
      }
      if (!activeAgentSlugs.has(step.agent)) {
        return [{
          stepId: step.id,
          agentSlug: step.agent,
          message: `Step "${step.id}" uses @${step.agent}, but that agent is not active in this workspace.`,
        }]
      }
      return []
    })
  }, [activeAgentSlugs, agentBySlug, agentsError, agentsLoading, parsed])

  const handleSave = async () => {
    if (!parsed) {
      toast.error(t('workflows.editor.parseError'))
      return
    }
    setSaving(true)
    try {
      await upsert({
        slug: originalSlug,
        metadata: parsed.metadata,
        body: parsed.body,
      })
      toast.success(t('workflows.editor.saved'))
      navigate(routes.view.workflow(originalSlug))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="runneros-glass-route flex h-full items-center justify-center text-sm text-white/50">{t('common.loading')}</div>
  }
  if (loadError) {
    return (
      <div className="m-5 flex items-center gap-2 rounded-[14px] border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
        <AlertTriangle className="h-4 w-4" />
        <span>{loadError}</span>
      </div>
    )
  }

  return (
    <div className="runneros-glass-route h-full overflow-y-auto">
      <div className="runneros-page-wrap">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="runneros-page-title">{t('workflows.editor.title')}</h1>
            <p className="runneros-page-subtitle font-mono">{originalSlug}</p>
          </div>
          <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="border-white/[0.08] bg-white/[0.045] text-white/72 hover:bg-white/[0.08] hover:text-white" onClick={() => navigate(routes.view.workflow(originalSlug))} disabled={saving}>
            <X className="h-3.5 w-3.5 mr-1.5" />
            {t('common.cancel')}
          </Button>
          <Button size="sm" className="border border-[#fb923c]/25 bg-[#f97316]/18 text-white/90 hover:bg-[#f97316]/26" onClick={handleSave} disabled={saving || !!parseError}>
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {saving ? t('workflows.editor.saving') : t('common.save')}
          </Button>
          </div>
        </div>

      <div className="flex min-h-0 flex-col gap-3">
        {parseError && (
          <div className="flex items-center gap-2 rounded-[12px] border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>{parseError}</span>
          </div>
        )}
        {stepAgentIssues.length > 0 && (
          <div className="runneros-card flex flex-col gap-1.5 p-2 text-xs text-white/72">
            {stepAgentIssues.map((issue) => (
              <div key={`${issue.stepId}:${issue.agentSlug}`} className="flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>{issue.message}</span>
              </div>
            ))}
          </div>
        )}
        <div className="grid flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            className="runneros-form-input min-h-[480px] resize-none font-mono text-xs leading-relaxed"
          />
          <WorkflowAgentCapabilitiesPanel
            parsed={parsed}
            agentBySlug={agentBySlug}
            activeAgentSlugs={activeAgentSlugs}
            loading={agentsLoading}
            error={agentsError}
          />
        </div>

        <details className="runneros-card p-3 text-xs text-white/50">
          <summary className="cursor-pointer select-none hover:text-white/82">
            {t('workflows.editor.templatingHelpTitle')}
          </summary>
          <div className="mt-2 rounded-[10px] border border-white/[0.07] bg-black/20 p-3 font-mono text-[11px] leading-relaxed text-white/62">
            <p className="mb-1">{t('workflows.editor.templatingHelpBody')}</p>
            <pre className="whitespace-pre-wrap">{`{{trigger.<input-name>}}     # any declared trigger input
{{steps.<step-id>.output}}    # output of an earlier step (string)`}</pre>
          </div>
        </details>
      </div>
      </div>
    </div>
  )
}

type ParsedWorkflow = NonNullable<ReturnType<typeof parseWorkflowFile>>

interface WorkflowAgentCapabilitiesPanelProps {
  parsed: ParsedWorkflow | null
  agentBySlug: Map<string, AgentDefinitionDTO>
  activeAgentSlugs: Set<string>
  loading: boolean
  error: string | null
}

function WorkflowAgentCapabilitiesPanel({
  parsed,
  agentBySlug,
  activeAgentSlugs,
  loading,
  error,
}: WorkflowAgentCapabilitiesPanelProps) {
  const steps = parsed?.metadata.steps ?? []

  return (
    <aside className="runneros-card p-3 text-xs">
      <div className="mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-white/45">
          Agent capabilities
        </h2>
        <p className="mt-1 text-[11px] leading-relaxed text-white/42">
          Read-only hints from saved agents used by this workflow.
        </p>
      </div>

      {loading && (
        <p className="text-white/45">Loading agents...</p>
      )}
      {error && (
        <div className="flex items-center gap-2 rounded-[10px] border border-red-500/30 bg-red-500/10 p-2 text-red-300">
          <AlertTriangle className="h-3.5 w-3.5" />
          <span>{error}</span>
        </div>
      )}
      {!loading && !error && !parsed && (
        <p className="text-white/45">Fix the workflow syntax to preview step agents.</p>
      )}
      {!loading && !error && parsed && steps.length === 0 && (
        <p className="text-white/45">No steps declared.</p>
      )}
      {!loading && !error && parsed && steps.length > 0 && (
        <ol className="flex flex-col gap-2">
          {steps.map((step, index) => {
            const agent = agentBySlug.get(step.agent)
            const isActive = activeAgentSlugs.has(step.agent)
            return (
              <li key={step.id} className="rounded-[11px] border border-white/[0.07] bg-white/[0.035] p-2.5">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 w-5 shrink-0 text-white/38">{index + 1}.</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <code className="font-mono text-[11px] text-white/72">{step.id}</code>
                      <code className="font-mono text-[11px] text-white/42">@{step.agent}</code>
                      {!agent && <Info_Badge color="destructive">missing</Info_Badge>}
                      {agent && !isActive && <Info_Badge color="warning">inactive</Info_Badge>}
                    </div>
                    {agent ? (
                      <AgentCapabilitySummary agent={agent} />
                    ) : (
                      <p className="mt-2 text-[11px] leading-relaxed text-white/45">
                        Add this agent to the global library, or change the step to an existing active agent.
                      </p>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </aside>
  )
}

function AgentCapabilitySummary({ agent }: { agent: AgentDefinitionDTO }) {
  const hasCapabilities = Boolean(
    agent.metadata.inputs ||
    agent.metadata.outputs ||
    (agent.metadata.tags?.length ?? 0) > 0
  )

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-white/84">
          {agent.metadata.avatar?.trim() && <span className="mr-1.5">{agent.metadata.avatar.trim()}</span>}
          {agent.metadata.name}
        </div>
        {agent.metadata.description && (
          <p className="mt-0.5 text-[11px] leading-relaxed text-white/45">
            {agent.metadata.description}
          </p>
        )}
      </div>

      {hasCapabilities ? (
        <dl className="grid grid-cols-[52px_1fr] gap-x-2 gap-y-1.5 text-[11px] leading-relaxed">
          {agent.metadata.inputs && (
            <>
              <dt className="text-white/38">Takes</dt>
              <dd>{agent.metadata.inputs}</dd>
            </>
          )}
          {agent.metadata.outputs && (
            <>
              <dt className="text-white/38">Makes</dt>
              <dd>{agent.metadata.outputs}</dd>
            </>
          )}
          {agent.metadata.tags && agent.metadata.tags.length > 0 && (
            <>
              <dt className="text-white/38">Tags</dt>
              <dd className="flex flex-wrap gap-1">
                {agent.metadata.tags.map((tag) => (
                  <Info_Badge key={tag} color="muted" className="px-2 py-0.5 text-[11px]">
                    #{tag}
                  </Info_Badge>
                ))}
              </dd>
            </>
          )}
        </dl>
      ) : (
        <p className="text-[11px] text-white/45">No capabilities declared for this agent.</p>
      )}
    </div>
  )
}
