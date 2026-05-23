import { randomUUID } from 'node:crypto'
import {
  createOutputBundle,
} from '@craft-agent/shared/outputs'
import type { CreateSessionOptions } from '@craft-agent/shared/protocol'
import {
  readDeepResearchRun,
  markRunningDeepResearchRunsInterrupted,
  writeDeepResearchRun,
  type DeepResearchDepth,
  type DeepResearchLoopBudget,
  type DeepResearchPlan,
  type DeepResearchPlanPolicy,
  type DeepResearchPlanStep,
  type DeepResearchReportFormat,
  type DeepResearchRunSnapshot,
  type DeepResearchSourceProfile,
  type DeepResearchSourceReadiness,
  type DeepResearchStepRun,
  type StartDeepResearchRunInput,
} from '@craft-agent/shared/deep-research'

export type DeepResearchRunnerEvent =
  | { type: 'run.created' | 'run.updated' | 'run.completed'; run: DeepResearchRunSnapshot }
  | { type: 'outputs.updated'; workspaceId: string }

export interface DeepResearchRunnerDeps {
  createSession: (workspaceId: string, options: CreateSessionOptions) => Promise<{ id: string }>
  sendMessage: (sessionId: string, prompt: string) => Promise<void>
  getLastAssistantText: (sessionId: string) => string
  getSessionToolUseSummary: (sessionId: string) => { count: number; names: string[] }
  abortSession: (sessionId: string) => Promise<void>
  getWorkspaceRootPath: (workspaceId: string) => string
  resolveSourceReadiness: (workspaceId: string, requestedSlugs: string[]) => DeepResearchSourceReadiness
  resolveSourceProfiles: (workspaceId: string, sourceSlugs: string[]) => DeepResearchSourceProfile[]
  emit?: (event: DeepResearchRunnerEvent) => void
}

interface ActiveDeepResearchRun {
  snapshot: DeepResearchRunSnapshot
  abort: AbortController
  currentSessionId?: string
}

function nowIso(): string {
  return new Date().toISOString()
}

function cleanTopic(topic: string): string {
  return topic.trim().replace(/\s+/g, ' ')
}

function titleFromTopic(topic: string): string {
  const cleaned = cleanTopic(topic)
  if (cleaned.length <= 80) return cleaned
  return `${cleaned.slice(0, 77).trim()}...`
}

function uniqueStrings(values: string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean))).sort()
}

function loopBudgetForDepth(depth: DeepResearchDepth): DeepResearchLoopBudget {
  if (depth === 'quick') return { depth, maxSearchRounds: 2, maxPagesToOpen: 5, minFollowUpRounds: 1 }
  if (depth === 'deep') return { depth, maxSearchRounds: 5, maxPagesToOpen: 16, minFollowUpRounds: 2 }
  return { depth, maxSearchRounds: 3, maxPagesToOpen: 10, minFollowUpRounds: 1 }
}

function buildPlan(params: {
  topic: string
  title: string
  policy: DeepResearchPlanPolicy
  sourceSlugs: string[]
  sourceProfiles: DeepResearchSourceProfile[]
  depth: DeepResearchDepth
  reportFormat: DeepResearchReportFormat
  createdAt: string
}): DeepResearchPlan {
  const budget = loopBudgetForDepth(params.depth)
  const searchSources = params.sourceProfiles
    .filter((source) => source.capabilities.includes('search'))
    .map((source) => source.slug)
  const browserSources = params.sourceProfiles
    .filter((source) => source.capabilities.includes('browser'))
    .map((source) => source.slug)
  const steps: DeepResearchPlanStep[] = [
    {
      id: 'research-loop',
      kind: 'research',
      title: 'Browser/Search Research Loop',
      instructions: [
        `Research topic: ${params.topic}`,
        `Run up to ${budget.maxSearchRounds} search rounds and inspect up to ${budget.maxPagesToOpen} promising pages/items.`,
        `Run at least ${budget.minFollowUpRounds} follow-up search round(s) when gaps, weak claims, or contradictions remain.`,
        searchSources.length > 0
          ? `Prefer selected search-capable sources first: ${searchSources.join(', ')}.`
          : 'No selected source is explicitly search-capable; use the best available source/tool for discovery.',
        browserSources.length > 0
          ? `Use selected browser-capable sources to open/read pages when useful: ${browserSources.join(', ')}.`
          : 'If no browser source is available, extract as much as possible through search/API/source results.',
        'Capture useful URLs or source names when available, but do not spend time on citation polish.',
        'End with: searches tried, pages/items inspected, key findings, contradictions, remaining gaps, and confidence.',
      ].join('\n'),
      requiredSourceSlugs: params.sourceSlugs,
    },
    {
      id: 'follow-up-research',
      kind: 'research',
      title: 'Follow-up Gap Search',
      instructions: [
        `Re-check the first-pass research for: ${params.topic}`,
        'Identify the weakest claims, missing context, contradictions, or suspiciously thin areas.',
        `Run at least ${budget.minFollowUpRounds} targeted follow-up search/browser pass(es), staying within the remaining practical budget.`,
        'Prefer selected search-capable tools for discovery and Runner browser/page tools for inspecting the best follow-up targets.',
        'End with: follow-up searches tried, pages/items inspected, what changed, what stayed uncertain, and confidence shifts.',
      ].join('\n'),
      requiredSourceSlugs: params.sourceSlugs,
    },
    {
      id: 'synthesize-report',
      kind: 'synthesis',
      title: 'Synthesize Report',
      instructions: [
        `Write a ${params.reportFormat} research report for: ${params.topic}`,
        'Use the research-loop output as the evidence base.',
        'Separate strong findings, weak/uncertain findings, practical implications, and gaps.',
        'Be direct. Do not pad.',
      ].join('\n'),
      requiredSourceSlugs: params.sourceSlugs,
    },
  ]

  return {
    id: randomUUID(),
    title: params.title,
    objective: params.topic,
    policy: params.policy,
    depth: params.depth,
    reportFormat: params.reportFormat,
    loopBudget: budget,
    sourceProfiles: params.sourceProfiles,
    steps,
    requiredSourceSlugs: params.sourceSlugs,
    assumptions: [
      'Research quality depends on the selected sources being current and reachable at execution time.',
      'RunnerOS will fail before execution when requested sources are missing, disabled, or unauthenticated.',
      'Selected sources are treated as the available tool belt; search/browser behavior depends on what their MCP/API/local tools expose.',
    ],
    riskNotes: [
      'Tool output can be stale or incomplete; the research loop must call out unresolved gaps.',
      'Auto mode can run tools without a plan approval checkpoint.',
    ],
    createdAt: params.createdAt,
  }
}

function buildStepRuns(plan: DeepResearchPlan): DeepResearchStepRun[] {
  return plan.steps.map((step) => ({
    id: step.id,
    kind: step.kind,
    title: step.title,
    state: 'queued',
  }))
}

function isTerminalRunState(state: DeepResearchRunSnapshot['state']): boolean {
  return state === 'succeeded' || state === 'failed' || state === 'cancelled' || state === 'interrupted'
}

function requiresResearchToolUse(run: DeepResearchRunSnapshot, step: DeepResearchPlanStep): boolean {
  if (step.id !== 'research-loop' && step.id !== 'follow-up-research') return false
  return (run.plan.sourceProfiles ?? []).some((source) => (
    source.capabilities.includes('search') || source.capabilities.includes('browser')
  ))
}

function isRelevantResearchToolName(toolName: string, sourceProfiles: DeepResearchSourceProfile[]): boolean {
  const normalized = toolName.toLowerCase()
  if (normalized.startsWith('browser') || normalized.includes('computer-use') || normalized.includes('chrome')) {
    return true
  }
  return sourceProfiles.some((source) => (
    normalized.startsWith(`mcp__${source.slug.toLowerCase()}__`) ||
    (source.type === 'api' && normalized.startsWith('api_'))
  ))
}

export class DeepResearchRunner {
  private readonly activeRuns = new Map<string, ActiveDeepResearchRun>()

  constructor(private readonly deps: DeepResearchRunnerDeps) {}

  start(workspaceId: string, input: StartDeepResearchRunInput): DeepResearchRunSnapshot {
    const topic = cleanTopic(input.topic)
    if (!topic) throw new Error('Deep research topic is required.')

    const policy = input.planPolicy ?? 'approve'
    const sourceSlugs = uniqueStrings(input.sourceSlugs)
    const sourceReadiness = this.deps.resolveSourceReadiness(workspaceId, sourceSlugs)
    const unavailable = [...sourceReadiness.missing, ...sourceReadiness.unusable]
    if (unavailable.length > 0) {
      throw new Error(`Deep research cannot start; unavailable source(s): ${unavailable.join(', ')}`)
    }
    const effectiveSourceSlugs = sourceSlugs.length > 0 ? sourceSlugs : sourceReadiness.usable
    if (effectiveSourceSlugs.length === 0) {
      throw new Error('Deep research requires at least one usable source. Activate or authenticate a source first.')
    }
    const depth = input.depth ?? 'standard'
    const reportFormat = input.reportFormat ?? 'standard'
    const sourceProfiles = this.deps.resolveSourceProfiles(workspaceId, effectiveSourceSlugs)
    const hasDiscoverySource = sourceProfiles.some((source) => (
      source.capabilities.includes('search') || source.capabilities.includes('browser')
    ))
    if (!hasDiscoverySource) {
      throw new Error('Deep research requires at least one search or browser-capable source.')
    }

    const createdAt = nowIso()
    const title = input.title?.trim() || titleFromTopic(topic)
    const plan = buildPlan({
      topic,
      title,
      policy,
      sourceSlugs: effectiveSourceSlugs,
      sourceProfiles,
      depth,
      reportFormat,
      createdAt,
    })
    if (policy === 'auto') plan.approvedAt = createdAt

    const run: DeepResearchRunSnapshot = {
      schemaVersion: 1,
      id: randomUUID(),
      workspaceId,
      title,
      topic,
      state: policy === 'auto' ? 'running' : 'awaiting_plan_approval',
      planPolicy: policy,
      sourceReadiness,
      plan,
      steps: buildStepRuns(plan),
      events: [
        { ts: createdAt, type: 'created', message: 'Deep research run created.' },
        {
          ts: createdAt,
          type: 'plan.created',
          message: policy === 'auto' ? 'Plan created and auto-approved.' : 'Plan created; waiting for approval.',
        },
      ],
      createdAt,
      updatedAt: createdAt,
    }

    this.persist(run)
    this.emit({ type: 'run.created', run })

    if (policy === 'auto') this.executeSoon(run)
    return this.clone(run)
  }

  approvePlan(workspaceId: string, runId: string): DeepResearchRunSnapshot {
    const run = this.requireRun(workspaceId, runId)
    if (run.state !== 'awaiting_plan_approval') {
      throw new Error(`Deep research run "${runId}" is not waiting for plan approval.`)
    }
    const ts = nowIso()
    run.state = 'running'
    run.plan.approvedAt = ts
    run.updatedAt = ts
    run.events.push({ ts, type: 'plan.approved', message: 'Plan approved; execution started.' })
    this.persist(run)
    this.emit({ type: 'run.updated', run })
    this.executeSoon(run)
    return this.clone(run)
  }

  revisePlan(workspaceId: string, runId: string, feedback: string): DeepResearchRunSnapshot {
    const run = this.requireRun(workspaceId, runId)
    if (run.state !== 'awaiting_plan_approval') {
      throw new Error(`Deep research run "${runId}" can only be revised before approval.`)
    }
    const trimmed = feedback.trim()
    if (!trimmed) throw new Error('Plan revision feedback is required.')
    const ts = nowIso()
    run.plan.revisionNotes = [...(run.plan.revisionNotes ?? []), trimmed]
    run.plan.steps = run.plan.steps.map((step) => ({
      ...step,
      instructions: `${step.instructions}\n\nPlan revision feedback:\n${trimmed}`,
    }))
    run.steps = buildStepRuns(run.plan)
    run.updatedAt = ts
    run.events.push({ ts, type: 'plan.revised', message: 'Plan revised from operator feedback.' })
    this.persist(run)
    this.emit({ type: 'run.updated', run })
    return this.clone(run)
  }

  async cancel(workspaceId: string, runId: string): Promise<DeepResearchRunSnapshot> {
    const active = this.activeRuns.get(runId)
    if (active) active.abort.abort()
    if (active?.currentSessionId) {
      try {
        await this.deps.abortSession(active.currentSessionId)
      } catch {
        // Cancellation must remain terminal even if the underlying session is already gone.
      }
    }
    const run = active?.snapshot ?? this.requireRun(workspaceId, runId)
    if (run.workspaceId !== workspaceId) throw new Error(`Deep research run "${runId}" does not belong to workspace "${workspaceId}".`)
    if (isTerminalRunState(run.state)) return this.clone(run)
    const ts = nowIso()
    run.state = 'cancelled'
    run.updatedAt = ts
    run.completedAt = ts
    run.events.push({ ts, type: 'cancelled', message: 'Deep research run cancelled.' })
    this.persist(run)
    this.activeRuns.delete(runId)
    this.emit({ type: 'run.completed', run })
    return this.clone(run)
  }

  private executeSoon(run: DeepResearchRunSnapshot): void {
    const active: ActiveDeepResearchRun = {
      snapshot: this.clone(run),
      abort: new AbortController(),
    }
    this.activeRuns.set(run.id, active)
    void this.execute(active).catch((err) => this.fail(active, err))
  }

  private async execute(active: ActiveDeepResearchRun): Promise<void> {
    for (const planStep of active.snapshot.plan.steps) {
      if (this.shouldStop(active)) return
      const stepRun = active.snapshot.steps.find((step) => step.id === planStep.id)
      if (!stepRun) throw new Error(`Missing deep research step record: ${planStep.id}`)

      const startedAt = nowIso()
      stepRun.state = 'running'
      stepRun.startedAt = startedAt
      active.snapshot.updatedAt = startedAt
      active.snapshot.events.push({ ts: startedAt, type: 'step.started', message: `${planStep.title} started.` })
      this.persistAndEmit(active.snapshot)

      const session = await this.deps.createSession(active.snapshot.workspaceId, {
        name: `${active.snapshot.title} · ${planStep.title}`,
        hidden: true,
        permissionMode: active.snapshot.planPolicy === 'auto' ? 'allow-all' : 'ask',
        enabledSourceSlugs: active.snapshot.sourceReadiness.usable,
        sessionStatus: 'in-progress',
        customSystemPrompt: [
          'You are RunnerOS Deep Research.',
          'You run a real research loop, not a single lookup.',
          'Use selected MCP/API/local/browser/search tools when they are available.',
          'When a search tool such as Exa is selected, use it for discovery before synthesis.',
          'When a browser/computer-use tool is selected, open and inspect promising pages/items instead of relying only on snippets.',
          'After initial findings, identify gaps or contradictions and run follow-up searches when budget allows.',
          'If evidence is missing, say exactly what is missing.',
        ].join('\n'),
      })
      stepRun.sessionId = session.id
      active.currentSessionId = session.id
      if (this.shouldStop(active)) {
        try {
          await this.deps.abortSession(session.id)
        } catch {
          // Best effort: the run has already been cancelled or otherwise stopped.
        }
        return
      }
      this.persistAndEmit(active.snapshot)

      await this.deps.sendMessage(session.id, this.buildStepPrompt(active.snapshot, planStep))
      if (this.shouldStop(active)) return
      const output = this.deps.getLastAssistantText(session.id).trim()
      if (!output) throw new Error(`Step "${planStep.id}" produced no output.`)
      if (requiresResearchToolUse(active.snapshot, planStep)) {
        const toolUseSummary = this.deps.getSessionToolUseSummary(session.id)
        const relevantToolNames = toolUseSummary.names.filter((name) => (
          isRelevantResearchToolName(name, active.snapshot.plan.sourceProfiles ?? [])
        ))
        if (relevantToolNames.length === 0) {
          throw new Error(
            `Step "${planStep.id}" did not use any selected search/browser tool. ` +
            `Completed tools: ${toolUseSummary.names.join(', ') || 'none'}.`,
          )
        }
      }

      const completedAt = nowIso()
      stepRun.state = 'succeeded'
      stepRun.output = output
      stepRun.completedAt = completedAt
      active.snapshot.updatedAt = completedAt
      active.snapshot.events.push({ ts: completedAt, type: 'step.completed', message: `${planStep.title} completed.` })
      this.persistAndEmit(active.snapshot)
    }

    if (this.shouldStop(active)) return
    this.finalizeReport(active.snapshot)
    this.activeRuns.delete(active.snapshot.id)
    this.emit({ type: 'run.completed', run: active.snapshot })
  }

  private buildStepPrompt(run: DeepResearchRunSnapshot, step: DeepResearchPlanStep): string {
    const priorOutputs = run.steps
      .filter((item) => item.output)
      .map((item) => `## ${item.title}\n${item.output}`)
      .join('\n\n')
    const depth = run.plan.depth ?? 'standard'
    const reportFormat = run.plan.reportFormat ?? 'standard'
    const loopBudget = run.plan.loopBudget ?? loopBudgetForDepth(depth)
    const sourceProfiles = (run.plan.sourceProfiles ?? []).map((source) => (
      `- ${source.slug} (${source.name}; ${source.type}; ${source.capabilities.join(', ') || 'general'}${source.tagline ? `): ${source.tagline}` : ')'}`
    )).join('\n')
    return [
      `Deep Research topic: ${run.topic}`,
      `Current step: ${step.title}`,
      `Depth: ${depth}`,
      `Report format: ${reportFormat}`,
      `Loop budget: ${loopBudget.maxSearchRounds} search rounds, ${loopBudget.maxPagesToOpen} page/item inspections, minimum ${loopBudget.minFollowUpRounds} follow-up round(s) when gaps remain.`,
      '',
      'Selected source/tool profiles:',
      sourceProfiles || '- none',
      '',
      step.instructions,
      '',
      priorOutputs ? `Prior step outputs:\n\n${priorOutputs}` : 'No prior step outputs yet.',
      '',
      'Return only the completed work for this step.',
    ].join('\n')
  }

  private finalizeReport(run: DeepResearchRunSnapshot): void {
    const ts = nowIso()
    const report = [
      `# ${run.title}`,
      '',
      `Topic: ${run.topic}`,
      '',
      '## Plan',
      ...run.plan.steps.map((step, index) => `${index + 1}. ${step.title}`),
      '',
      '## Research Output',
      ...run.steps.map((step) => [
        `### ${step.title}`,
        '',
        step.output ?? step.error ?? 'No output.',
      ].join('\n')),
    ].join('\n')
    const workspaceRoot = this.deps.getWorkspaceRootPath(run.workspaceId)
    const output = createOutputBundle(workspaceRoot, {
      workspaceId: run.workspaceId,
      title: `${run.title} Research Report`,
      kind: 'report',
      status: 'published',
      summary: `Deep research report for ${run.topic}`,
      origin: { source: 'deep-research', deepResearchRunId: run.id },
      content: report,
      contentMimeType: 'text/markdown',
      tags: ['deep-research'],
      completedAt: ts,
    })
    run.outputId = output.id
    run.state = 'succeeded'
    run.updatedAt = ts
    run.completedAt = ts
    run.events.push({ ts, type: 'report.created', message: 'Research report output created.' })
    this.persist(run)
    this.emit({ type: 'outputs.updated', workspaceId: run.workspaceId })
    this.emit({ type: 'run.updated', run })
  }

  private fail(active: ActiveDeepResearchRun, err: unknown): void {
    if (active.abort.signal.aborted || active.snapshot.state === 'cancelled') {
      this.activeRuns.delete(active.snapshot.id)
      return
    }
    const ts = nowIso()
    const message = err instanceof Error ? err.message : String(err)
    active.snapshot.state = 'failed'
    active.snapshot.error = message
    active.snapshot.updatedAt = ts
    active.snapshot.completedAt = ts
    const runningStep = active.snapshot.steps.find((step) => step.state === 'running')
    if (runningStep) {
      runningStep.state = 'failed'
      runningStep.error = message
      runningStep.completedAt = ts
      active.snapshot.events.push({ ts, type: 'step.failed', message: `${runningStep.title} failed: ${message}` })
    }
    active.snapshot.events.push({ ts, type: 'failed', message })
    this.persist(active.snapshot)
    this.activeRuns.delete(active.snapshot.id)
    this.emit({ type: 'run.completed', run: active.snapshot })
  }

  private requireRun(workspaceId: string, runId: string): DeepResearchRunSnapshot {
    const run = readDeepResearchRun(this.deps.getWorkspaceRootPath(workspaceId), runId)
    if (!run) throw new Error(`Deep research run not found: ${runId}`)
    if (run.workspaceId !== workspaceId) {
      throw new Error(`Deep research run "${runId}" does not belong to workspace "${workspaceId}".`)
    }
    return run
  }

  recoverInterruptedRuns(workspaces: Array<{ id: string; rootPath: string }>): DeepResearchRunSnapshot[] {
    const recovered: DeepResearchRunSnapshot[] = []
    for (const workspace of workspaces) {
      recovered.push(
        ...markRunningDeepResearchRunsInterrupted(
          workspace.rootPath,
          'Deep research run was interrupted while RunnerOS was not running.',
        ),
      )
    }
    for (const run of recovered) this.emit({ type: 'run.completed', run })
    return recovered
  }

  private shouldStop(active: ActiveDeepResearchRun): boolean {
    return active.abort.signal.aborted || isTerminalRunState(active.snapshot.state)
  }

  private persistAndEmit(run: DeepResearchRunSnapshot): void {
    this.persist(run)
    this.emit({ type: 'run.updated', run })
  }

  private persist(run: DeepResearchRunSnapshot): void {
    writeDeepResearchRun(this.deps.getWorkspaceRootPath(run.workspaceId), run)
  }

  private emit(event: DeepResearchRunnerEvent): void {
    this.deps.emit?.(event)
  }

  private clone(run: DeepResearchRunSnapshot): DeepResearchRunSnapshot {
    return JSON.parse(JSON.stringify(run)) as DeepResearchRunSnapshot
  }
}
