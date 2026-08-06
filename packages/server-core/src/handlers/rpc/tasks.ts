/**
 * RPC handlers for the Tasks Conductor.
 *
 * Channels (all REMOTE_ELIGIBLE — tasks are workspace content):
 *   tasks:validate — lint/dry-run a task.yaml string (no side effects)
 *   tasks:create   — write task.yaml + create the orchestrator parent session
 *   tasks:run      — start a run (returns the run snapshot)
 *   tasks:pause | resume | stop — run control
 *   tasks:get      — spec + (optional) active run-state
 *   tasks:list     — task slugs with a task.yaml
 *
 * The legacy `tasks:getOutput` (background-task remnant) is handled in sessions.ts
 * and intentionally left untouched; retiring it is a separate cleanup.
 */
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type {
  TaskCreateRequest,
  TaskCreateResult,
  TaskGenerateRequest,
  TaskGenerateAck,
  TaskGenerateResult,
  TaskRunRequest,
  TaskValidationResultDto,
  TaskGetResult,
  TaskResultsDto,
  TaskResultNodeDto,
} from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import {
  parseTaskYaml,
  saveTaskSpec,
  loadTaskSpec,
  listTaskSlugs,
  buildGeneratorPrompt,
  buildRepairPrompt,
  listRunIds,
  readRunLog,
  readNodeOutput,
  readRunSpecSnapshot,
  nodeTitle,
  DEFAULT_REPAIR_ATTEMPTS,
  MAX_REPAIR_ATTEMPTS_CAP,
} from '@craft-agent/shared/tasks'
import { createLogger } from '@craft-agent/shared/utils'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { TaskRunner, createTaskFromSpec, finishTaskOrchestrator } from '../../tasks'

const tasksLog = createLogger('tasks-generate')

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.tasks.VALIDATE,
  RPC_CHANNELS.tasks.CREATE,
  RPC_CHANNELS.tasks.GENERATE,
  RPC_CHANNELS.tasks.RUN,
  RPC_CHANNELS.tasks.PAUSE,
  RPC_CHANNELS.tasks.RESUME,
  RPC_CHANNELS.tasks.STOP,
  RPC_CHANNELS.tasks.GET,
  RPC_CHANNELS.tasks.LIST,
  RPC_CHANNELS.tasks.GET_RESULTS,
] as const

/** Map a shared ValidationResult (+ parsed spec) onto the wire DTO. */
function toValidationDto(result: ReturnType<typeof parseTaskYaml>): TaskValidationResultDto {
  const issue = (i: { path: string; message: string; severity: 'error' | 'warning'; suggestion?: string }) => ({
    path: i.path,
    message: i.message,
    severity: i.severity,
    ...(i.suggestion ? { suggestion: i.suggestion } : {}),
  })
  const sessionNodeCount = result.spec?.nodes.filter((n) => n.kind === 'session').length ?? 0
  return {
    valid: result.valid,
    errors: result.errors.map(issue),
    warnings: result.warnings.map(issue),
    estimate: result.spec ? { nodeCount: result.spec.nodes.length, sessionNodeCount } : undefined,
  }
}

const GENERATE_TIMEOUT_MS = 180_000

// One initial generation plus up to one feedback-driven repair turn. Bounded so a model
// that keeps emitting invalid specs can't loop forever; the last attempt is returned as-is.
const MAX_GENERATE_ATTEMPTS = 2

/** Pull the YAML body out of an LLM reply (tolerate ```yaml fences or surrounding prose). */
function extractYaml(text: string): string {
  const fenced = text.match(/```(?:ya?ml)?\s*\n?([\s\S]*?)```/i)
  return (fenced ? fenced[1] : text).trim()
}

export function registerTasksHandlers(server: RpcServer, deps: HandlerDeps): void {
  // One Conductor per workspace, created on demand. Holds active runs in memory.
  const runners = new Map<string, TaskRunner>()

  function workspaceOrThrow(workspaceId: string) {
    const ws = getWorkspaceByNameOrId(workspaceId)
    if (!ws) throw new Error(`Workspace ${workspaceId} not found`)
    return ws
  }

  function runnerFor(workspaceId: string): TaskRunner {
    let runner = runners.get(workspaceId)
    if (!runner) {
      const ws = workspaceOrThrow(workspaceId)
      runner = new TaskRunner({ host: deps.sessionManager, workspaceId: ws.id, workspaceRoot: ws.rootPath })
      runners.set(workspaceId, runner)
    }
    return runner
  }

  // tasks:validate — lint/dry-run; no side effects.
  server.handle(RPC_CHANNELS.tasks.VALIDATE, async (_ctx, _workspaceId: string, yaml: string): Promise<TaskValidationResultDto> => {
    return toValidationDto(parseTaskYaml(yaml))
  })

  // tasks:create — write task.yaml + create the orchestrator parent session.
  server.handle(RPC_CHANNELS.tasks.CREATE, async (_ctx, workspaceId: string, req: TaskCreateRequest): Promise<TaskCreateResult> => {
    const ws = workspaceOrThrow(workspaceId)
    const parsed = parseTaskYaml(req.yaml)
    const validation = toValidationDto(parsed)
    if (!parsed.valid || !parsed.spec) {
      return { slug: '', orchestratorSessionId: '', validation }
    }
    const spec = parsed.spec
    saveTaskSpec(ws.rootPath, spec)

    // Single choke point for ALL orchestrator paths (attach / adopt / fresh): apply the reserved
    // "Task" label (surfacing its resolved id so the renderer can navigate to the label filter)
    // and enable the spec's sources on the orchestrator session. Fail-soft — neither a label nor
    // a sources problem may fail task creation. The body lives in finishTaskOrchestrator
    // (../../tasks/create-task) so the create_task session tool shares it verbatim.
    const finish = async (orchestratorSessionId: string): Promise<TaskCreateResult> => {
      const setup = await finishTaskOrchestrator(deps.sessionManager, orchestratorSessionId, spec)
      return { slug: spec.id, orchestratorSessionId, validation, taskLabelId: setup.taskLabelId }
    }

    // Edit-mode bind: the user saved this spec onto an existing, visible tile (e.g. a quick-add
    // session). Bind that session to the slug. Unlike adoption this HARD-ERRORS on failure — it
    // must never fall through to createSession, which would leave a duplicate orchestrator tile.
    if (req.attachToExistingSession) {
      const bound = await deps.sessionManager.bindExistingSessionToTask(req.attachToExistingSession, spec.id, {
        name: spec.title,
        projectId: spec.project,
        ...(spec.cwd ? { workingDirectory: spec.cwd } : {}),
        ...(spec.defaults?.model ? { model: spec.defaults.model } : {}),
        ...(spec.defaults?.llmConnection ? { llmConnection: spec.defaults.llmConnection } : {}),
        ...(spec.defaults?.permissionMode ? { permissionMode: spec.defaults.permissionMode } : {}),
      })
      if (!bound) {
        throw new Error(
          `Cannot attach task "${spec.id}" to session ${req.attachToExistingSession}: ` +
            `session is missing or already bound to a different task.`,
        )
      }
      return finish(req.attachToExistingSession)
    }

    // Adoption path: when the YAML was authored by a generate orchestrator, promote that hidden
    // draft in place instead of creating a second top-level session (#bug1). Falls back to a fresh
    // session if the draft is gone / already adopted / bound to another slug.
    if (req.orchestratorSessionId) {
      const adopted = await deps.sessionManager.adoptGeneratedTaskOrchestrator(req.orchestratorSessionId, spec.id, {
        name: spec.title,
        projectId: spec.project,
        ...(spec.cwd ? { workingDirectory: spec.cwd } : {}),
        ...(spec.defaults?.model ? { model: spec.defaults.model } : {}),
        // Reconcile the connection + permission mode from the saved spec (bind already does this) so an
        // orch model/mode changed after generation actually takes effect on the promoted orchestrator.
        ...(spec.defaults?.llmConnection ? { llmConnection: spec.defaults.llmConnection } : {}),
        ...(spec.defaults?.permissionMode ? { permissionMode: spec.defaults.permissionMode } : {}),
      })
      if (adopted) {
        return finish(req.orchestratorSessionId)
      }
    }

    // Fresh create — shared core with the create_task session tool. The spec was already saved
    // above (all three paths persist first), so skip the core's save. createSession announces the
    // orchestrator to the renderer by default, so its tile appears on the board immediately.
    const created = await createTaskFromSpec(deps.sessionManager, workspaceId, ws.rootPath, spec, { save: false })
    return { slug: created.slug, orchestratorSessionId: created.orchestratorSessionId, validation, taskLabelId: created.taskLabelId }
  })

  // tasks:generate — the persistent orchestrator session AUTHORS the task.yaml from a goal (#2).
  // It also remains the home for "ask the agent to revise it" (it holds the conversation).
  //
  // ASYNC: the orchestrator session is created synchronously (cheap) and its id is returned
  // immediately so the RPC never approaches the uniform client timeout. The authored spec is
  // streamed back via the `tasks:generated` push event keyed by orchestratorSessionId. The
  // session is a hidden taskDraft (off the board) until adopted by tasks:create; the editor
  // discards an unadopted draft on close, and because drafts are hidden a give-up-early client
  // never leaves a visible orphan tile.
  server.handle(RPC_CHANNELS.tasks.GENERATE, async (_ctx, workspaceId: string, req: TaskGenerateRequest): Promise<TaskGenerateAck> => {
    workspaceOrThrow(workspaceId) // validate the workspace exists; generate no longer writes task.yaml
    const orchestrator = await deps.sessionManager.createSession(workspaceId, {
      name: req.title?.trim() || 'New task',
      sessionStatus: 'todo',
      // Hidden until the authored spec is validated and adopted via tasks:create. Keeps the
      // generate-time session off the board so "Generate → Create & Run" can't mint a duplicate
      // top-level tile (#bug1). Promotion clears this flag in adoptGeneratedTaskOrchestrator.
      taskDraft: true,
      // Bind the draft to the project so it authors against the project's <project_context>.
      ...(req.projectId ? { projectId: req.projectId } : {}),
      // Seed the orchestrator with the cwd chosen in the composer so the authored spec and any
      // dispatched children inherit it. Omitted → project/workspace default working directory.
      ...(req.cwd ? { workingDirectory: req.cwd } : {}),
      ...(req.model ? { model: req.model } : {}),
      // Non-default (pi/*) models need their serving connection to resolve a backend — without it the
      // authoring turn completes instantly with no output, producing an invalid/empty spec.
      ...(req.llmConnection ? { llmConnection: req.llmConnection } : {}),
      // Task-level sources become the draft's enabled set (omitted → workspace default).
      ...(req.enabledSourceSlugs?.length ? { enabledSourceSlugs: req.enabledSourceSlugs } : {}),
      // Seed the visible task autonomy so authoring runs at the chosen mode, not the workspace default.
      ...(req.permissionMode ? { permissionMode: req.permissionMode } : {}),
    })
    const sessionId = orchestrator.id
    tasksLog.info('generate started', {
      workspaceId,
      sessionId,
      hasCwd: Boolean(req.cwd),
      model: req.model,
      projectId: req.projectId,
      hasConnection: Boolean(req.llmConnection),
      permissionMode: req.permissionMode,
    })

    // Send `prompt` to the orchestrator and await its next final turn. Subscribe BEFORE
    // sending so a fast turn can't complete before we listen; a timeout keeps a hung turn
    // from blocking forever.
    const askOrchestrator = (prompt: string) =>
      new Promise<string>((resolve, reject) => {
        let settled = false
        let off: (() => void) | undefined
        let timer: ReturnType<typeof setTimeout> | undefined
        const finish = (fn: () => void) => {
          if (settled) return
          settled = true
          off?.()
          if (timer) clearTimeout(timer)
          fn()
        }
        off = deps.sessionManager.onSessionComplete((evt) => {
          if (evt.sessionId !== sessionId) return
          const text = evt.finalText ?? deps.sessionManager.getSessionFinalText(sessionId) ?? ''
          finish(() => resolve(text))
        })
        timer = setTimeout(() => finish(() => reject(new Error('Task generation timed out'))), GENERATE_TIMEOUT_MS)
        void Promise.resolve(deps.sessionManager.sendMessage(sessionId, prompt))
          .catch((err: unknown) => finish(() => reject(err instanceof Error ? err : new Error(String(err)))))
      })

    // Run the generate→repair loop in the background and push the result when done. Awaiting
    // here would re-introduce the synchronous-RPC-over-WS timeout this async path exists to avoid.
    void (async () => {
      const startedAt = Date.now()
      try {
        // Generate, then auto-repair: the orchestrator still holds the conversation, so if the
        // authored spec fails validation (commonly a ${nodes.X.output} ref to an undeclared
        // node) hand the concrete errors back and re-validate. Bounded so a model that can't
        // self-correct can't loop forever — the last attempt's validation is returned as-is.
        let prompt = buildGeneratorPrompt(req.goal, req.title)
        let yaml = ''
        let parsed = parseTaskYaml(yaml)
        let attempts = 0
        for (let attempt = 0; attempt < MAX_GENERATE_ATTEMPTS; attempt++) {
          attempts = attempt + 1
          const finalText = await askOrchestrator(prompt)
          yaml = extractYaml(finalText)
          parsed = parseTaskYaml(yaml)
          if (parsed.valid) break
          prompt = buildRepairPrompt(parsed.errors)
        }
        const validation = toValidationDto(parsed)
        // Do NOT persist here. tasks:create is the only writer of the live task.yaml — writing
        // eagerly on generation would clobber an existing task before the user confirms the edit.
        // The authored spec is delivered below via tasks:generated and saved on save/create.
        tasksLog.info('generate finished', {
          sessionId,
          valid: parsed.valid,
          attempts,
          elapsedMs: Date.now() - startedAt,
          slug: parsed.spec?.id ?? '',
        })
        pushTyped(server, RPC_CHANNELS.tasks.GENERATED, { to: 'workspace', workspaceId }, workspaceId, {
          orchestratorSessionId: sessionId,
          slug: parsed.spec?.id ?? '',
          spec: parsed.spec,
          yaml,
          validation,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        tasksLog.error('generate failed', { sessionId, elapsedMs: Date.now() - startedAt, error: message })
        // Deliver the failure so the client can stop its spinner and surface a toast. The
        // orchestrator stays a hidden taskDraft (never shown on the board); the editor discards
        // it on close, so a failed generation leaves nothing for the user to clean up.
        pushTyped(server, RPC_CHANNELS.tasks.GENERATED, { to: 'workspace', workspaceId }, workspaceId, {
          orchestratorSessionId: sessionId,
          slug: '',
          yaml: '',
          validation: { valid: false, errors: [], warnings: [] },
          error: message,
        })
      }
    })()

    return { orchestratorSessionId: sessionId }
  })

  // tasks:run — start a run.
  server.handle(RPC_CHANNELS.tasks.RUN, async (_ctx, workspaceId: string, req: TaskRunRequest) => {
    return runnerFor(workspaceId).run(req.slug, {
      runId: req.runId,
      orchestratorSessionId: req.orchestratorSessionId,
      params: req.params,
    })
  })

  server.handle(RPC_CHANNELS.tasks.PAUSE, async (_ctx, workspaceId: string, slug: string, runId: string) => {
    runnerFor(workspaceId).pause(slug, runId)
  })

  server.handle(RPC_CHANNELS.tasks.RESUME, async (_ctx, workspaceId: string, slug: string, runId: string) => {
    runnerFor(workspaceId).resume(slug, runId)
  })

  server.handle(RPC_CHANNELS.tasks.STOP, async (_ctx, workspaceId: string, slug: string, runId: string) => {
    await runnerFor(workspaceId).stop(slug, runId)
  })

  // tasks:get — spec + (optional) active run-state.
  server.handle(RPC_CHANNELS.tasks.GET, async (_ctx, workspaceId: string, slug: string, runId?: string): Promise<TaskGetResult> => {
    const ws = workspaceOrThrow(workspaceId)
    const loaded = loadTaskSpec(ws.rootPath, slug)
    if (!loaded) {
      return {
        slug,
        validation: { valid: false, errors: [{ path: 'root', message: `Task "${slug}" not found`, severity: 'error' }], warnings: [] },
        run: null,
      }
    }
    const run = runId ? runnerFor(workspaceId).getRunState(slug, runId) : null
    return { slug, validation: toValidationDto(loaded), spec: loaded.spec, run }
  })

  // tasks:list — slugs with a task.yaml.
  server.handle(RPC_CHANNELS.tasks.LIST, async (_ctx, workspaceId: string): Promise<string[]> => {
    return listTaskSlugs(workspaceOrThrow(workspaceId).rootPath)
  })

  // tasks:getResults — storage-backed read of a run's outcome (verdict + per-node output).
  // Reads the durable artifacts (run-log.jsonl, nodes/<id>.json, per-run spec.json snapshot), so it
  // works after restart and without an active in-memory run — unlike tasks:get's run snapshot.
  server.handle(RPC_CHANNELS.tasks.GET_RESULTS, async (_ctx, workspaceId: string, slug: string, runId?: string): Promise<TaskResultsDto> => {
    const root = workspaceOrThrow(workspaceId).rootPath
    const runIds = listRunIds(root, slug)
    const chosen = runId ?? runIds.at(-1) ?? null
    if (!chosen) return { slug, runId: null, runIds, nodes: [] }

    const log = readRunLog(root, slug, chosen)

    // Node titles come from the run-time spec snapshot (so historical runs aren't relabeled by a
    // later edit). Older runs predate snapshots → fall back to the run-log node ids.
    const snapshot = readRunSpecSnapshot(root, slug, chosen)
    const titleById = new Map<string, string>()
    if (snapshot) for (const n of snapshot.nodes) titleById.set(n.id, nodeTitle(n))

    // Fold the append-only log into the latest per-node state + session id, preserving first-seen
    // order. node-spawned/node-finished both carry sessionId; the last one wins.
    const byId = new Map<string, { id: string; state: string; sessionId?: string }>()
    const ensure = (id: string) => {
      let e = byId.get(id)
      if (!e) { e = { id, state: 'pending' }; byId.set(id, e) }
      return e
    }
    const verdicts: NonNullable<TaskResultsDto['verdicts']> = []
    // Recover the terminal run status from the run-log's lifecycle markers (last one wins).
    let runStatus: string | undefined
    for (const entry of log) {
      if (entry.kind === 'node-scheduled' || entry.kind === 'node-spawned') {
        const e = ensure(entry.nodeId)
        if (entry.kind === 'node-spawned') e.sessionId = entry.sessionId
      } else if (entry.kind === 'node-finished') {
        const e = ensure(entry.nodeId)
        e.state = entry.state
        if (entry.sessionId) e.sessionId = entry.sessionId
      } else if (entry.kind === 'verdict') {
        verdicts.push({
          result: entry.result,
          ...(entry.reason ? { reason: entry.reason } : {}),
          ...(entry.nodes?.length ? { nodes: entry.nodes } : {}),
        })
      } else if (entry.kind === 'run-completed') {
        runStatus = 'completed'
      } else if (entry.kind === 'run-failed') {
        runStatus = 'failed'
      } else if (entry.kind === 'run-stopped') {
        runStatus = 'stopped'
      } else if (entry.kind === 'run-verifying') {
        runStatus = 'verifying'
      }
    }

    const nodes: TaskResultNodeDto[] = [...byId.values()].map((e) => {
      const out = readNodeOutput(root, slug, chosen, e.id)
      return {
        id: e.id,
        title: titleById.get(e.id) ?? e.id,
        state: e.state,
        ...(e.sessionId ? { sessionId: e.sessionId } : {}),
        ...(out?.text ? { output: out.text } : {}),
      }
    })

    // Repair accounting: each FAIL verdict consumed one repair attempt; the cap is the per-run
    // snapshot's max_iterations clamped to the shared bound (default when omitted).
    const repairUsed = verdicts.filter((v) => v.result === 'fail').length
    const repairMax = Math.min(snapshot?.max_iterations ?? DEFAULT_REPAIR_ATTEMPTS, MAX_REPAIR_ATTEMPTS_CAP)

    return {
      slug,
      runId: chosen,
      runIds,
      verdict: verdicts.at(-1),
      verdicts,
      repair: { used: repairUsed, max: repairMax },
      ...(runStatus ? { runStatus } : {}),
      ...(snapshot?.acceptance_criteria ? { acceptanceCriteria: snapshot.acceptance_criteria } : {}),
      nodes,
    }
  })
}
