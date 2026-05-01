/**
 * Workflows — runner state machine
 *
 * Walks a `LoadedWorkflow`'s steps sequentially. Each step spawns a real
 * Session via the injected `createSession` dep, sends the resolved prompt,
 * awaits the turn, then captures the last assistant message as the step
 * `output` (Phase 1 strategy — see `docs/workflows/02-runtime.md`).
 *
 * Run state is persisted via `@craft-agent/shared/workflows` after every
 * transition so a server crash leaves a coherent on-disk snapshot.
 *
 * Out of scope for Phase 1 (do NOT add here):
 *   - outputSchema validation                (Phase 2)
 *   - retries / timeout / `when`             (Phase 2)
 *   - humanCheckpoint pause/resume           (Phase 3)
 *   - parallelGroup concurrency              (Phase 3)
 *   - RPC channels / IPC bridge / UI hooks   (separate task)
 *
 * The runner mirrors the dependency-injection style of `SessionManager`:
 * the constructor takes a deps bundle, and the runner never imports the
 * real SessionManager. This keeps the unit under test trivially mockable
 * and lets the wire-up live in the bootstrap layer.
 */

import { randomUUID } from 'node:crypto';
import type { CreateSessionOptions } from '@craft-agent/shared/protocol';
import {
  appendOutputSchemaInstruction,
  parseStructuredStepOutput,
  resolveTemplate,
  writeRun,
  type LoadedWorkflow,
  type WorkflowStep,
  type WorkflowRunSnapshot,
  type WorkflowRunStep,
} from '@craft-agent/shared/workflows';

/**
 * Runner-event wire format. The bootstrap layer fans these out to the
 * existing event bus (mirrors `agent-definitions.CHANGED` /
 * `workspaceContext.CHANGED`). Unit tests inject a no-op `emit`.
 */
export type WorkflowRunEvent =
  | { type: 'run.created'; run: WorkflowRunSnapshot }
  | { type: 'run.updated'; run: WorkflowRunSnapshot; detail?: WorkflowRunEventDetail }
  | { type: 'run.completed'; run: WorkflowRunSnapshot };

export type WorkflowRunEventDetail =
  | {
      kind: 'step.retrying';
      stepId: string;
      attempt: number;
      maxAttempts: number;
      error: { code: string; message: string };
      timeoutSeconds?: number;
    }
  | {
      kind: 'step.failed';
      stepId: string;
      attempts: number;
      onFailure: 'stop' | 'continue' | 'ask';
      error: { code: string; message: string };
      timeoutSeconds?: number;
    };

/**
 * Public surface the runner needs from its host. The real implementation
 * forwards each call to a `SessionManager` instance — see the bootstrap
 * wiring (added in the RPC step).
 */
export interface WorkflowRunnerDeps {
  /** Spawn a session with given options. Mirrors `SessionManager.createSession`. */
  createSession: (
    workspaceId: string,
    options: CreateSessionOptions,
  ) => Promise<{ id: string }>;
  /** Resolve a workflow step's agent slug into the real runtime session config. */
  resolveAgentSessionOptions?: (
    workspaceId: string,
    agentSlug: string,
  ) => Promise<Partial<CreateSessionOptions>>;
  /**
   * Send a message and wait for the LLM turn to complete. Mirrors
   * `SessionManager.sendMessage` — that method already returns when the
   * turn ends.
   */
  sendMessage: (sessionId: string, prompt: string) => Promise<void>;
  /**
   * Read the last assistant message text from a session. Used as the
   * naive Phase 1 step output. Returns '' when there are no assistant
   * messages.
   */
  getLastAssistantText: (sessionId: string) => string;
  /**
   * Hard-abort a running session. Wraps `SessionManager.forceAbort` /
   * the `UserStop` lifecycle hook (see `packages/shared/CLAUDE.md` for
   * the hard-abort vs. handoff-interrupt distinction).
   */
  abortSession: (sessionId: string) => Promise<void>;
  /** Resolve a workspace ID to its root path on disk. */
  getWorkspaceRootPath: (workspaceId: string) => string;
  /** Emit a runner event for renderer subscribers. No-op safe. */
  emit?: (event: WorkflowRunEvent) => void;
}

/** Internal bookkeeping for an in-flight run. */
interface ActiveRun {
  snapshot: WorkflowRunSnapshot;
  abort: AbortController;
  /** Set to the active step's session id while a step is in flight. */
  currentSessionId?: string;
}

class StepAttemptError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'StepAttemptError';
  }
}

/**
 * Compose the concurrency key. Phase 1 allows at most one in-flight run
 * per (workspaceId, workflowSlug) pair.
 */
function concurrencyKey(workspaceId: string, workflowSlug: string): string {
  return `${workspaceId}::${workflowSlug}`;
}

export class WorkflowRunner {
  private readonly active = new Map<string /* runId */, ActiveRun>();
  private readonly activeByKey = new Map<string /* concurrencyKey */, string /* runId */>();

  constructor(private readonly deps: WorkflowRunnerDeps) {}

  /**
   * Start a workflow run. Snapshots the workflow + persists initial state,
   * then walks steps in a fire-and-forget loop. Returns the snapshot in
   * `running` state — subscribers learn about progress via emitted events.
   *
   * Phase 1 concurrency: rejects if a run is already active for this
   * (workspaceId, workflowSlug) pair.
   */
  async start(input: {
    workflow: LoadedWorkflow;
    workspaceId: string;
    triggerInputs: Record<string, unknown>;
  }): Promise<WorkflowRunSnapshot> {
    const { workflow, workspaceId, triggerInputs } = input;
    const key = concurrencyKey(workspaceId, workflow.slug);
    if (this.activeByKey.has(key)) {
      throw new Error(
        `Workflow "${workflow.slug}" already has an active run in workspace "${workspaceId}".`,
      );
    }

    const now = new Date().toISOString();
    const runId = randomUUID();

    const steps: WorkflowRunStep[] = workflow.metadata.steps.map((s) => ({
      id: s.id,
      state: 'queued',
      attempts: 0,
    }));

    const workflowSnapshot = this.cloneJson({ metadata: workflow.metadata, body: workflow.body });

    const snapshot: WorkflowRunSnapshot = {
      id: runId,
      workflowSlug: workflow.slug,
      workspaceId,
      state: 'running',
      trigger: { type: 'manual', inputs: triggerInputs, firedAt: now },
      workflowSnapshot,
      steps,
      createdAt: now,
      updatedAt: now,
    };

    const active: ActiveRun = { snapshot, abort: new AbortController() };
    this.active.set(runId, active);
    this.activeByKey.set(key, runId);

    try {
      this.persist(active);
    } catch (err) {
      this.releaseActiveRun(active);
      throw err;
    }

    this.emitEvent({ type: 'run.created', run: this.cloneSnapshot(active.snapshot) });
    this.emitEvent({ type: 'run.updated', run: this.cloneSnapshot(active.snapshot) });

    // Fire-and-forget — caller awaits via emitted events, not this method's
    // resolution. runStepLoop handles its own crash finalization so active
    // concurrency slots cannot leak on an unexpected runner bug.
    void this.runStepLoop(active);

    return this.cloneSnapshot(active.snapshot);
  }

  /**
   * Cancel a running workflow. Hard-aborts the active step's session if
   * one is in flight. Idempotent for already-terminal runs.
   */
  async cancel(workspaceId: string, runId: string): Promise<void> {
    const active = this.active.get(runId);
    if (!active) return;
    if (active.snapshot.workspaceId !== workspaceId) return;
    if (this.isTerminal(active.snapshot.state)) return;

    active.abort.abort();
    active.snapshot.state = 'cancelled';
    active.snapshot.completedAt = new Date().toISOString();
    for (const step of active.snapshot.steps) {
      if (step.state === 'running') {
        step.state = 'failed';
        step.completedAt = new Date().toISOString();
        step.error = { code: 'cancelled', message: 'Workflow run was cancelled.' };
      }
    }
    this.touch(active);

    const sessionId = active.currentSessionId;
    if (sessionId) {
      try {
        await this.deps.abortSession(sessionId);
      } catch (err) {
        // Best-effort — the loop will still observe `signal.aborted`.
        // eslint-disable-next-line no-console
        console.error(`[WorkflowRunner] abortSession failed for ${sessionId}:`, err);
      }
    }
  }

  /** Active in-memory runs for a workspace. Disk reads use run-storage helpers. */
  getActiveRuns(workspaceId: string): WorkflowRunSnapshot[] {
    const out: WorkflowRunSnapshot[] = [];
    for (const a of this.active.values()) {
      if (a.snapshot.workspaceId === workspaceId) out.push(this.cloneSnapshot(a.snapshot));
    }
    return out;
  }

  // --------------------------------------------------------------------------
  // Internal — step loop
  // --------------------------------------------------------------------------

  private async runStepLoop(active: ActiveRun): Promise<void> {
    try {
      await this.executeStepLoop(active);
    } catch (err) {
      this.failCrashedRun(active, err);
    }
  }

  private async executeStepLoop(active: ActiveRun): Promise<void> {
    const runStartedAt = active.snapshot.createdAt;
    const workflow = active.snapshot.workflowSnapshot;
    let failed = false;

    for (let i = 0; i < workflow.metadata.steps.length; i++) {
      if (active.abort.signal.aborted) break;

      const stepDef = workflow.metadata.steps[i]!;
      const stepRecord = active.snapshot.steps[i]!;

      // 1. Mark step `running`.
      stepRecord.state = 'running';
      stepRecord.startedAt = new Date().toISOString();
      stepRecord.attempts = 0;
      this.touch(active);

      // 2. Build templater context from completed steps.
      const stepsCtx: Record<string, { output: unknown }> = {};
      for (let j = 0; j < i; j++) {
        const prev = active.snapshot.steps[j]!;
        if (prev.state === 'succeeded') {
          stepsCtx[prev.id] = { output: prev.output };
        }
      }

      // 3. Resolve the step's input template.
      const resolved = resolveTemplate(stepDef.input, {
        trigger: active.snapshot.trigger.inputs,
        steps: stepsCtx,
        run: { id: active.snapshot.id, startedAt: runStartedAt },
      });
      if (resolved.warnings.length > 0) {
        for (const w of resolved.warnings) {
          // eslint-disable-next-line no-console
          console.warn(
            `[WorkflowRunner] template warning in run ${active.snapshot.id} step ${stepDef.id}: ${w}`,
          );
        }
      }

      const maxAttempts = (stepDef.retries ?? 0) + 1;
      let lastError: unknown;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (active.abort.signal.aborted) break;
        stepRecord.attempts = attempt;
        stepRecord.error = undefined;
        this.touch(active);

        try {
          await this.executeStepAttempt(active, stepDef, resolved.output);
          if (active.abort.signal.aborted) break;

          stepRecord.state = 'succeeded';
          stepRecord.completedAt = new Date().toISOString();
          active.currentSessionId = undefined;
          this.touch(active);
          lastError = undefined;
          break;
        } catch (err) {
          lastError = err;
          active.currentSessionId = undefined;
          if (active.abort.signal.aborted) break;
          if (attempt < maxAttempts) {
            const error = this.stepError(err);
            stepRecord.error = error;
            this.touch(active, {
              kind: 'step.retrying',
              stepId: stepDef.id,
              attempt,
              maxAttempts,
              error,
              timeoutSeconds: error.code === 'timeout' ? stepDef.timeout : undefined,
            });
            continue;
          }
        }
      }

      if (active.abort.signal.aborted) break;
      if (lastError !== undefined) {
        const onFailure = stepDef.onFailure ?? 'stop';
        const error = this.stepError(lastError);
        stepRecord.state = 'failed';
        stepRecord.completedAt = new Date().toISOString();
        stepRecord.error = error;
        this.touch(active, {
          kind: 'step.failed',
          stepId: stepDef.id,
          attempts: stepRecord.attempts,
          onFailure,
          error,
          timeoutSeconds: error.code === 'timeout' ? stepDef.timeout : undefined,
        });
        if (onFailure === 'continue') {
          continue;
        }
        failed = true;
        break;
      }
    }

    // Final state.
    if (active.abort.signal.aborted) {
      active.snapshot.state = 'cancelled';
    } else if (failed) {
      active.snapshot.state = 'failed';
    } else {
      active.snapshot.state = 'succeeded';
    }
    active.snapshot.completedAt = new Date().toISOString();
    this.touch(active);

    // Release concurrency slot + active map entry.
    this.releaseActiveRun(active);

    this.emitEvent({ type: 'run.completed', run: this.cloneSnapshot(active.snapshot) });
  }

  // --------------------------------------------------------------------------
  // Internal — persistence + events
  // --------------------------------------------------------------------------

  private async executeStepAttempt(
    active: ActiveRun,
    stepDef: WorkflowStep,
    prompt: string,
  ): Promise<void> {
    const workflow = active.snapshot.workflowSnapshot;
    const stepRecord = active.snapshot.steps.find((s) => s.id === stepDef.id);
    if (!stepRecord) throw new StepAttemptError('step-record-missing', `Missing run step record for "${stepDef.id}".`);

    const agentOptions = await this.deps.resolveAgentSessionOptions?.(
      active.snapshot.workspaceId,
      stepDef.agent,
    ) ?? {};
    const session = await this.deps.createSession(active.snapshot.workspaceId, {
      ...agentOptions,
      name: `${workflow.metadata.name} · ${stepDef.id}`,
      spawnedFromAgent: {
        agentSlug: stepDef.agent,
        agentName: agentOptions.spawnedFromAgent?.agentName ?? stepDef.agent,
        timestamp: Date.now(),
      },
      launchReceipt: {
        ...agentOptions.launchReceipt,
        createdAt: Date.now(),
        origin: 'workflow',
        summary: `Workflow "${workflow.metadata.name}" step "${stepDef.id}".`,
        workflow: {
          slug: active.snapshot.workflowSlug,
          stepId: stepDef.id,
        },
        config: agentOptions.launchReceipt?.config ?? {},
        injected: agentOptions.launchReceipt?.injected ?? {
          skills: agentOptions.agentSkillSlugs ?? [],
          sources: agentOptions.enabledSourceSlugs ?? [],
          contextDocs: [],
          systemPromptChars: agentOptions.customSystemPrompt?.length,
        },
      },
      hidden: false,
    });
    stepRecord.sessionId = session.id;
    active.currentSessionId = session.id;
    this.touch(active);

    if (active.abort.signal.aborted) return;

    const stepPrompt = stepDef.outputSchema
      ? appendOutputSchemaInstruction(prompt, stepDef.outputSchema)
      : prompt;
    await this.sendMessageWithOptionalTimeout(active, session.id, stepPrompt, stepDef.timeout);

    if (active.abort.signal.aborted) return;

    const rawOutput = this.deps.getLastAssistantText(session.id);
    if (!stepDef.outputSchema) {
      stepRecord.output = rawOutput;
      return;
    }

    const parsed = parseStructuredStepOutput(rawOutput, stepDef.outputSchema);
    if (!parsed.ok) {
      throw new StepAttemptError('invalid-structured-output', parsed.message);
    }
    stepRecord.output = parsed.value;
  }

  private async sendMessageWithOptionalTimeout(
    active: ActiveRun,
    sessionId: string,
    prompt: string,
    timeoutSeconds: number | undefined,
  ): Promise<void> {
    if (timeoutSeconds === undefined) {
      await this.deps.sendMessage(sessionId, prompt);
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.deps.sendMessage(sessionId, prompt),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new StepAttemptError('timeout', `Step timed out after ${timeoutSeconds} seconds.`));
          }, timeoutSeconds * 1000);
        }),
      ]);
    } catch (err) {
      if (err instanceof StepAttemptError && err.code === 'timeout') {
        try {
          await this.deps.abortSession(sessionId);
        } catch (abortErr) {
          // eslint-disable-next-line no-console
          console.error(`[WorkflowRunner] abortSession failed after step timeout for ${sessionId}:`, abortErr);
        }
      }
      throw err;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  private touch(active: ActiveRun, detail?: WorkflowRunEventDetail): void {
    active.snapshot.updatedAt = new Date().toISOString();
    this.persist(active);
    this.emitEvent({ type: 'run.updated', run: this.cloneSnapshot(active.snapshot), detail });
  }

  private persist(active: ActiveRun): void {
    const root = this.deps.getWorkspaceRootPath(active.snapshot.workspaceId);
    writeRun(root, active.snapshot);
  }

  private failCrashedRun(active: ActiveRun, err: unknown): void {
    try {
      // eslint-disable-next-line no-console
      console.error(`[WorkflowRunner] step loop crashed for run ${active.snapshot.id}:`, err);
      if (!this.isTerminal(active.snapshot.state)) {
        const now = new Date().toISOString();
        active.snapshot.state = active.abort.signal.aborted ? 'cancelled' : 'failed';
        active.snapshot.completedAt = now;
        active.snapshot.updatedAt = now;
        const running = active.snapshot.steps.find((s) => s.state === 'running');
        if (running) {
          running.state = 'failed';
          running.completedAt = now;
          running.error = {
            code: active.abort.signal.aborted ? 'cancelled' : 'runner-crashed',
            message: err instanceof Error ? err.message : String(err),
          };
        }
        this.persist(active);
        this.emitEvent({ type: 'run.updated', run: this.cloneSnapshot(active.snapshot) });
        this.emitEvent({ type: 'run.completed', run: this.cloneSnapshot(active.snapshot) });
      }
    } catch (persistErr) {
      // eslint-disable-next-line no-console
      console.error(
        `[WorkflowRunner] failed to persist crashed run ${active.snapshot.id}:`,
        persistErr,
      );
    } finally {
      this.releaseActiveRun(active);
    }
  }

  private releaseActiveRun(active: ActiveRun): void {
    const key = concurrencyKey(active.snapshot.workspaceId, active.snapshot.workflowSlug);
    if (this.activeByKey.get(key) === active.snapshot.id) this.activeByKey.delete(key);
    this.active.delete(active.snapshot.id);
  }

  private emitEvent(event: WorkflowRunEvent): void {
    try {
      this.deps.emit?.(event);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[WorkflowRunner] event handler failed for ${event.type}:`, err);
    }
  }

  private emit(event: WorkflowRunEvent): void {
    if (!this.deps.emit) return;
    try {
      this.deps.emit(event);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[WorkflowRunner] emit threw:', err);
    }
  }

  private cloneSnapshot(snapshot: WorkflowRunSnapshot): WorkflowRunSnapshot {
    // Defensive deep-ish clone via JSON. Snapshots only contain plain JSON
    // values by construction, so this is safe and fast at this size.
    return this.cloneJson(snapshot);
  }

  private cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  private stepError(err: unknown): { code: string; message: string } {
    return {
      code: err instanceof StepAttemptError ? err.code : 'step-threw',
      message: err instanceof Error ? err.message : String(err),
    };
  }

  private isTerminal(state: WorkflowRunSnapshot['state']): boolean {
    return state === 'succeeded' || state === 'failed' || state === 'cancelled';
  }
}
