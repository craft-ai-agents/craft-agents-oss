/**
 * The Conductor — an in-process DAG runner for Tasks.
 *
 * A `task.yaml` (parsed + validated in @craft-agent/shared/tasks) describes a
 * graph of nodes; each node is a child session. The Conductor:
 *   1. schedules ready nodes (deps satisfied) honoring `max_parallel`,
 *   2. dispatches each as a child session (create + sendMessage), interpolating
 *      `${nodes.<id>.output}` / `${params.<name>}` / `${inputs.<name>}` into the prompt,
 *   3. subscribes to SessionManager's in-process `onSessionComplete` seam,
 *   4. on completion reads the child's final assistant text as the node output,
 *      feeds it to dependents (every `depends_on` edge carries it), and reschedules.
 *      A step the user stopped, or one whose background agents are still running,
 *      is not finished: it stays running until a later turn completes it,
 *   5. drives child `sessionStatus` + `kanbanColumn` so the board renders the live DAG,
 *   6. persists an append-only run-log under `tasks/<slug>/runs/<runId>/`.
 *
 * v1 executes `kind: 'session'` nodes wired by `depends_on` + `inputs`. Control-flow
 * kinds (route/loop/approval/…) parse but are not yet executed (P4).
 *
 * The runner depends on a minimal `ConductorSessionHost` interface (which
 * SessionManager structurally satisfies) so it is unit-testable with a mock.
 */
import type { CreateSessionOptions } from '@craft-agent/shared/protocol';
import type { SessionCompletionEvent } from '../sessions/SessionManager';
import {
  type TaskSpec,
  type TaskNode,
  type NodeOutput,
  type RunLogEntry,
  type NodeRunState,
  nodeTitle,
  nodeDeps,
  extractRefs,
  interpolateRefs,
  materializeDeps,
  appendRunLog,
  writeNodeOutput,
  readNodeOutput,
  nodeOutputPath,
  readRunLog,
  loadTaskSpec,
  writeRunSpecSnapshot,
  DEFAULT_REPAIR_ATTEMPTS,
  MAX_REPAIR_ATTEMPTS_CAP,
} from '@craft-agent/shared/tasks';
import type { DecisionRequest, DecisionResult } from '@craft-agent/shared/decisions';
import { classifyVerdictWithDecision } from './verdict-decision';

// ---------------------------------------------------------------------------
// Host interface (SessionManager satisfies this structurally)
// ---------------------------------------------------------------------------

export interface ConductorSessionHost {
  /** Creates the child session AND announces it to the renderer (createSession emits
   *  session_created by default), so the subtask appears on the board with its real title. */
  createSession(workspaceId: string, options: CreateSessionOptions): Promise<{ id: string }>;
  sendMessage(sessionId: string, message: string): Promise<void>;
  setSessionStatus(sessionId: string, status: string): Promise<void>;
  setKanbanColumn(sessionId: string, column: string | null): Promise<void>;
  /** Records the total DAG node count on the orchestrator session for a stable board progress denominator. */
  setTaskNodeCount(sessionId: string, count: number): Promise<void>;
  cancelProcessing(sessionId: string, silent?: boolean): Promise<void>;
  onSessionComplete(listener: (evt: SessionCompletionEvent) => void): () => void;
  /** Resolved working directory of a session, so children inherit the orchestrator's cwd. */
  getSessionWorkingDirectory(sessionId: string): string | undefined;
  /** Parent of a sub-session (undefined = top-level or unknown), so a run never starts on one. */
  getSessionParentId(sessionId: string): string | undefined;
}

export interface TaskRunnerDeps {
  host: ConductorSessionHost;
  workspaceId: string;
  workspaceRoot: string;
  /** Optional output summarizer (call_llm/Haiku). When absent, summarize-flagged inputs pass through. */
  summarize?: (text: string) => Promise<string>;
  /** Default `max_parallel` when the spec omits it. */
  defaultMaxParallel?: number;
  /** Injectable clock (run-log timestamps) + run-id generator, for determinism in tests. */
  now?: () => string;
  genRunId?: () => string;
  /**
   * Optional decision-model call (Jev). Used ONLY to read a verdict out of an orchestrator reply that
   * has no parseable VERDICT line: a parseable line always wins, the model never changes what PASS or
   * FAIL do, and `null` (layer off, unsure, failed) leaves the runner exactly as before — it re-asks.
   */
  decide?: TaskDecisionFn;
  /**
   * Optional decision-model read of how a child's turn ended (Jev). A child that asked for input or
   * gave up is failed (retry with the reason, or needs-review) instead of marked done: children run
   * unattended, so nobody would answer. `null` (layer off, unsure, failed) marks the node done as before.
   */
  classifyNodeOutcome?: NodeOutcomeFn;
  /**
   * Optional decision-model scoping of a FAIL repair (Jev). When the verifier's FAIL names no
   * subtasks, the model picks the ones its reason implicates; `null` repairs the whole DAG as before.
   */
  pickRepairNodes?: RepairScopeFn;
}

/** Runs one decision request for a task run; `null` = unavailable. Must not throw (the runner also guards). */
export type TaskDecisionFn = (request: DecisionRequest, context: { slug: string; runId: string }) => Promise<DecisionResult | null>;

/** Picks the nodes a FAIL reason implicates; `null` = unavailable or none. Must not throw (the runner also guards). */
export type RepairScopeFn = (
  reason: string,
  nodes: Array<{ id: string; description: string }>,
  context: { slug: string; runId: string },
) => Promise<string[] | null>;

/** Reads how a child node's final turn ended; `null` = unavailable or unsure. Must not throw (the runner also guards). */
export type NodeOutcomeFn = ((finalText: string, context: { slug: string; runId: string; nodeId: string }) => Promise<'finished' | 'needs_input' | 'blocked' | null>) & {
  /** Synchronous gate: when false the node completes without the async check, as before. */
  isActive?: () => boolean;
};

export interface RunOptions {
  /** The task's persistent parent/orchestrator session (author + final verifier). */
  orchestratorSessionId?: string;
  /** Resolved task param values (merged over the spec's declared defaults). */
  params?: Record<string, unknown>;
  /** Explicit run id (otherwise generated). */
  runId?: string;
  /** When the run completes, message the orchestrator to verify the result. Default true. */
  verifyOnComplete?: boolean;
}

export type RunStatus = 'running' | 'paused' | 'verifying' | 'stopped' | 'completed' | 'failed';

export interface NodeRunStatus {
  id: string;
  state: NodeRunState;
  sessionId?: string;
  attempt: number;
}

export interface RunSnapshot {
  slug: string;
  runId: string;
  taskId: string;
  status: RunStatus;
  orchestratorSessionId?: string;
  nodes: NodeRunStatus[];
  /** Sum of each child's (input + output) tokens observed at completion. */
  tokensUsed: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_PARALLEL = 4;
// Explicit, unattended-safe default for a subtask's permission mode when neither the node nor the task
// defaults set one. Conductor children run with no human to answer an `ask` prompt, so we must NOT fall
// through to the workspace default (which may be `ask` → the child hangs, or read-only `safe` → it
// silently produces nothing). The task editor now persists an explicit `defaults.permissionMode`, so
// this constant only governs hand-authored specs that omit it — and it is never `ask`.
const AUTONOMOUS_DEFAULT_MODE = 'allow-all' as const;
const RUNNING_STATUS = 'in-progress';
const DONE_STATUS = 'done';
// There is no 'failed' session status (the fixed set is todo|in-progress|needs-review|done|cancelled).
// We flag a failed child as 'needs-review' (amber, attention needed); the board's 'failed' run-state
// is derived from the run-log, not from a session status.
const FAILED_STATUS = 'needs-review';
// A step the user stopped waits for them (a message continues it); the same amber status flags it.
const WAITING_FOR_USER_STATUS = 'needs-review';
// Upstream replies handed to a dependent through `depends_on` are capped per step; the full text is
// in the run's nodes/<id>.json.
const MAX_UPSTREAM_REPLY_CHARS = 40_000;

// A malformed verdict (no parseable VERDICT line) is re-asked this many times before we give up and
// fail the run. These re-asks are format-only — they do NOT consume the repair (max_iterations) budget.
const MAX_UNPARSED_REASKS = 2;

const INPUTS_REF_RE = /\$\{\s*inputs\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\}/g;

/** Distributive Omit so the run-log discriminated union keeps its per-variant fields. */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
type RunLogEntryInput = DistributiveOmit<RunLogEntry, 't'>;

interface NodeStateEntry {
  state: NodeRunState;
  sessionId?: string;
  attempt: number;
  /** Reason the previous attempt failed, fed back into the retry prompt (failure-aware retry). */
  lastFailure?: string;
  /** Replies of this attempt's completed turns while it waited for background work; joined into the output. */
  replies: string[];
  /** The user stopped this attempt: only a turn answering their message completes it. */
  waitingForUser?: boolean;
}

// ---------------------------------------------------------------------------
// ActiveRun — a single run's state machine
// ---------------------------------------------------------------------------

class ActiveRun {
  private readonly state = new Map<string, NodeStateEntry>();
  private readonly sessionToNode = new Map<string, string>();
  private readonly outputs: Record<string, NodeOutput> = {};
  private readonly edges: Map<string, Set<string>>;
  private readonly maxParallel: number;
  private inFlight = 0;
  private tokensUsed = 0;
  /** Last observed cumulative (input+output) tokens per child session — for delta accounting. */
  private readonly sessionTokens = new Map<string, number>();
  private runStatus: RunStatus = 'running';
  private unsubscribe?: () => void;
  /** Detaches the one-shot orchestrator-verdict listener while a run is `verifying`. */
  private verdictOff?: () => void;
  /** FAIL verdicts that have triggered a repair pass (bounded by `maxRepairs`). */
  private repairsUsed = 0;
  /** The last repair was narrowed by the decision model: the next FAIL repairs the whole DAG. */
  private lastRepairScoped = false;
  /** Malformed-verdict re-asks issued (bounded by MAX_UNPARSED_REASKS); not a repair. */
  private unparsedReAsks = 0;
  /** Resolved repair cap = min(spec.max_iterations ?? DEFAULT, CAP). */
  private readonly maxRepairs: number;
  /** Inverted edges: node id → set of nodes that (directly) depend on it. Built lazily for the frontier. */
  private dependents?: Map<string, Set<string>>;
  private settled = false;
  private settleResolvers: ((s: RunSnapshot) => void)[] = [];

  constructor(
    private readonly spec: TaskSpec,
    private readonly slug: string,
    private readonly runId: string,
    private readonly opts: Required<Pick<RunOptions, 'verifyOnComplete'>> & RunOptions,
    private readonly deps: TaskRunnerDeps,
  ) {
    this.edges = materializeDeps(spec);
    this.maxParallel = spec.max_parallel ?? deps.defaultMaxParallel ?? DEFAULT_MAX_PARALLEL;
    // Runner-side clamp (belt-and-suspenders: the schema already caps `max_iterations` at the same
    // bound, so a parsed spec can't exceed it — but a programmatically built spec might).
    this.maxRepairs = Math.min(spec.max_iterations ?? DEFAULT_REPAIR_ATTEMPTS, MAX_REPAIR_ATTEMPTS_CAP);
    for (const node of spec.nodes) this.state.set(node.id, { state: 'pending', attempt: 0, replies: [] });
  }

  // --- lifecycle ---

  start(): void {
    this.unsubscribe = this.deps.host.onSessionComplete((evt) => this.onSessionComplete(evt));
    // Snapshot the spec for this run so the Results view labels nodes by run-time titles even after
    // the live task.yaml is edited. Best-effort: a snapshot failure must not abort the run.
    try {
      writeRunSpecSnapshot(this.deps.workspaceRoot, this.slug, this.runId, this.spec);
    } catch {
      // ignore — Results falls back to run-log node ids when no snapshot exists
    }
    this.log({ kind: 'run-started', taskId: this.spec.id, runId: this.runId, orchestratorSessionId: this.opts.orchestratorSessionId });
    this.runStatus = 'running';
    // Move the task tile to the in-progress column for the duration of the run.
    if (this.opts.orchestratorSessionId) {
      void this.deps.host.setKanbanColumn(this.opts.orchestratorSessionId, 'in-progress');
      void this.deps.host.setSessionStatus(this.opts.orchestratorSessionId, RUNNING_STATUS);
      // Publish the full node count up front so the board's subtask progress denominator is stable,
      // rather than growing as children are spawned lazily at dispatch.
      void this.deps.host.setTaskNodeCount(this.opts.orchestratorSessionId, this.spec.nodes.length);
    }
    this.scheduleReady();
  }

  pause(): void {
    if (this.runStatus !== 'running') return;
    this.runStatus = 'paused';
    this.log({ kind: 'run-paused' });
    // In-flight children keep running; their completions still record output but won't schedule.
  }

  resume(): void {
    if (this.runStatus !== 'paused') return;
    // Cancelled nodes return to pending so they re-dispatch. Nodes that exhausted their `retry`
    // budget stay 'failed' — automatic retry happens in failNode within the run, not on resume.
    for (const [, st] of this.state) if (st.state === 'cancelled') st.state = 'pending';
    this.runStatus = 'running';
    this.log({ kind: 'run-resumed' });
    this.scheduleReady();
  }

  /**
   * Rebuild run state from a persisted run-log (cross-restart resume). Done nodes reuse their
   * recorded output and are NOT re-run; in-flight/cancelled nodes fall back to pending so they
   * re-dispatch. A done node whose output file is missing also falls back to pending.
   */
  hydrate(log: RunLogEntry[], loadOutput: (nodeId: string) => NodeOutput | null): void {
    for (const e of log) {
      if (e.kind === 'node-spawned') {
        const st = this.state.get(e.nodeId);
        if (st) {
          st.sessionId = e.sessionId;
          this.sessionToNode.set(e.sessionId, e.nodeId);
        }
      } else if (e.kind === 'node-scheduled') {
        const st = this.state.get(e.nodeId);
        if (st) st.attempt += 1;
      } else if (e.kind === 'node-finished') {
        const st = this.state.get(e.nodeId);
        if (st) st.state = e.state;
      } else if (e.kind === 'verdict') {
        // Reconstruct the durable repair counters so a cross-restart resume honors the cap rather
        // than restarting the budget from zero (the in-memory counters reset on a fresh process).
        if (e.result === 'fail') this.repairsUsed += 1;
        else if (e.result === 'unparsed') this.unparsedReAsks += 1;
        else if (e.result === 'pass') this.unparsedReAsks = 0;
      }
    }
    for (const [nodeId, st] of this.state) {
      if (st.state === 'done') {
        const out = loadOutput(nodeId);
        if (out) this.outputs[nodeId] = out;
        else st.state = 'pending'; // recorded output missing → must re-run
      } else if (st.state === 'running' || st.state === 'cancelled') {
        st.state = 'pending'; // in-flight at shutdown / cancelled → re-dispatch on resume
      }
    }
    this.inFlight = 0;
  }

  /** Resume a hydrated run: subscribe, log, and schedule the ready set (finished nodes are skipped). */
  resumeFromHydrated(): void {
    if (this.unsubscribe) return;
    this.runStatus = 'running';
    this.unsubscribe = this.deps.host.onSessionComplete((evt) => this.onSessionComplete(evt));
    this.log({ kind: 'run-resumed' });
    this.scheduleReady();
  }

  async stop(): Promise<void> {
    if (this.isTerminal()) return;
    this.runStatus = 'stopped';
    this.log({ kind: 'run-stopped' });
    for (const [nodeId, st] of this.state) {
      if (st.state === 'running') {
        st.state = 'cancelled';
        this.log({ kind: 'node-finished', nodeId, sessionId: st.sessionId ?? '', state: 'cancelled', reason: 'stopped' });
        if (st.sessionId) {
          void this.deps.host.cancelProcessing(st.sessionId, true);
          void this.deps.host.setKanbanColumn(st.sessionId, 'todo');
        }
      }
    }
    this.inFlight = 0;
    this.finalize();
  }

  waitUntilSettled(): Promise<RunSnapshot> {
    if (this.settled) return Promise.resolve(this.snapshot());
    return new Promise((resolve) => this.settleResolvers.push(resolve));
  }

  snapshot(): RunSnapshot {
    return {
      slug: this.slug,
      runId: this.runId,
      taskId: this.spec.id,
      status: this.runStatus,
      orchestratorSessionId: this.opts.orchestratorSessionId,
      tokensUsed: this.tokensUsed,
      nodes: this.spec.nodes.map((n) => {
        const st = this.state.get(n.id)!;
        return { id: n.id, state: st.state, sessionId: st.sessionId, attempt: st.attempt };
      }),
    };
  }

  // --- scheduling ---

  private scheduleReady(): void {
    if (this.runStatus !== 'running') return;
    for (const node of this.spec.nodes) {
      if (this.inFlight >= this.maxParallel) break;
      if (!this.isReady(node)) continue;
      if (this.isOverBudget()) {
        this.pauseForBudget();
        return;
      }
      this.markRunning(node);
      void this.dispatch(node);
    }
    this.maybeFinish();
  }

  private isReady(node: TaskNode): boolean {
    if (this.state.get(node.id)!.state !== 'pending') return false;
    for (const dep of this.edges.get(node.id) ?? []) {
      if (this.state.get(dep)?.state !== 'done') return false;
    }
    return true;
  }

  private markRunning(node: TaskNode): void {
    const st = this.state.get(node.id)!;
    st.state = 'running';
    st.attempt += 1;
    st.replies = [];
    st.waitingForUser = false;
    this.inFlight += 1;
    this.log({ kind: 'node-scheduled', nodeId: node.id });
  }

  private async dispatch(node: TaskNode): Promise<void> {
    try {
      // Task-level skills ride as [skill:slug] mentions on every child prompt — the agent
      // pipeline resolves each SKILL.md and blocks tools until it is read (skills-as-context).
      const prompt = skillsPreamble(this.spec.skills) + (await this.buildPrompt(node));
      // Children run where the parent runs: inherit the orchestrator's resolved working directory,
      // falling back to the spec's declared `cwd`. Without this they default to the workspace cwd
      // rather than the parent session's (project) directory.
      const cwd =
        (this.opts.orchestratorSessionId
          ? this.deps.host.getSessionWorkingDirectory(this.opts.orchestratorSessionId)
          : undefined) ?? this.spec.cwd;
      const options: CreateSessionOptions = {
        parentSessionId: this.opts.orchestratorSessionId,
        // Link the child back to the task / run / node so the manual subtask composer can
        // tell Conductor-owned children apart from hand-authored subtasks (it skips the former).
        taskSlug: this.slug,
        taskRunId: this.runId,
        taskNodeId: node.id,
        name: nodeTitle(node),
        model: node.model ?? this.spec.defaults?.model,
        // Required for non-default (e.g. pi/*) models to resolve a backend — without it the
        // child session completes instantly with no output.
        llmConnection: node.llmConnection ?? this.spec.defaults?.llmConnection,
        // Node override → task default (persisted by the editor, visible to the user) → explicit
        // unattended-safe fallback. Never the workspace default (which could be `ask` → hang).
        permissionMode: node.permissionMode ?? this.spec.defaults?.permissionMode ?? AUTONOMOUS_DEFAULT_MODE,
        labels: node.labels,
        // Inherit the orchestrator's task number (task::N) so the whole run filters as one task.
        applyTaskLabel: true,
        // Task-level sources become the child's enabled-sources set (spec omitted → workspace default).
        ...(this.spec.sources?.length ? { enabledSourceSlugs: this.spec.sources } : {}),
        projectId: this.spec.project,
        ...(cwd ? { workingDirectory: cwd } : {}),
        sessionStatus: RUNNING_STATUS,
      };
      // createSession announces the child to the renderer by default, so it nests under the task
      // tile with its real title instead of a fabricated "New Chat" (or never appearing).
      const child = await this.deps.host.createSession(this.deps.workspaceId, options);
      const st = this.state.get(node.id)!;
      st.sessionId = child.id;
      this.sessionToNode.set(child.id, node.id);
      this.log({ kind: 'node-spawned', nodeId: node.id, sessionId: child.id });
      await this.deps.host.setKanbanColumn(child.id, 'in-progress');
      await this.deps.host.sendMessage(child.id, prompt);
    } catch (err) {
      this.failNode(node.id, `dispatch failed: ${(err as Error).message}`);
    }
  }

  /** Resolve a node's prompt: declared inputs (+ optional summarize) then ${…} interpolation. */
  private async buildPrompt(node: TaskNode): Promise<string> {
    const inputValues: Record<string, unknown> = {};
    for (const [name, ref] of Object.entries(node.inputs ?? {})) {
      const fromExpr = typeof ref === 'string' ? ref : ref.from;
      const summarize = typeof ref === 'string' ? false : !!ref.summarize;
      let resolved = interpolateRefs(fromExpr, { nodeOutputs: this.outputs, params: this.opts.params });
      if (summarize && this.deps.summarize) resolved = await this.deps.summarize(resolved);
      inputValues[name] = resolved;
    }
    let text = interpolateRefs(node.prompt ?? '', { nodeOutputs: this.outputs, params: this.opts.params });
    text = text.replace(INPUTS_REF_RE, (raw, name: string) => (name in inputValues ? String(inputValues[name]) : raw));
    const upstream = this.upstreamReplies(node);
    if (upstream) text = `${upstream}\n\n${text}`;

    // Failure-aware retry: prepend the prior failure so a retried session knows what went wrong
    // instead of blindly repeating a deterministic failure.
    const st = this.state.get(node.id)!;
    if (st.attempt > 1 && st.lastFailure) {
      text = `${st.lastFailure}\n\n${text}`;
    }
    return text;
  }

  /**
   * The replies of the `depends_on` steps that the prompt does not already pull in with
   * ${nodes.<id>.output} (directly or through `inputs`). Authors add the edge and write "based on
   * the exploration output"; the dependent used to start without it (found 2026-10-11).
   */
  private upstreamReplies(node: TaskNode): string | null {
    const pulledIn = new Set<string>();
    const refTexts = [node.prompt ?? '', ...Object.values(node.inputs ?? {}).map((ref) => (typeof ref === 'string' ? ref : ref.from))];
    for (const text of refTexts) {
      for (const ref of extractRefs(text)) if (ref.kind === 'node' && !ref.field) pulledIn.add(ref.nodeId);
    }
    const sections: string[] = [];
    for (const depId of nodeDeps(node)) {
      const reply = this.outputs[depId]?.text;
      if (pulledIn.has(depId) || !reply?.trim()) continue;
      const dep = this.spec.nodes.find((n) => n.id === depId);
      const body = reply.length > MAX_UPSTREAM_REPLY_CHARS
        ? `${reply.slice(0, MAX_UPSTREAM_REPLY_CHARS)}\n…[cut at ${MAX_UPSTREAM_REPLY_CHARS} characters; the full reply is in ${nodeOutputPath(this.deps.workspaceRoot, this.slug, this.runId, depId)}]`
        : reply;
      sections.push(`### ${dep ? nodeTitle(dep) : depId}\n${body}`);
    }
    if (sections.length === 0) return null;
    return [`Replies of the step${sections.length === 1 ? '' : 's'} this one depends on:`, '', ...sections, '', '---'].join('\n');
  }

  // --- completion ---

  private onSessionComplete(evt: SessionCompletionEvent): void {
    const nodeId = this.sessionToNode.get(evt.sessionId);
    if (!nodeId) return; // not one of our child nodes
    const st = this.state.get(nodeId);
    if (!st || st.state !== 'running') return; // already settled/cancelled
    // A retried node runs in a new session; a turn of the replaced one (woken by its own background
    // work, or messaged by the user) is not this attempt's result.
    if (st.sessionId !== evt.sessionId) return;

    if (evt.tokenUsage) {
      // `tokenUsage` is cumulative-per-session; add only the delta since this session's last
      // observed total, since a node can run more than one turn (stopped and continued, woken by
      // background work).
      const cumulative = (evt.tokenUsage.inputTokens ?? 0) + (evt.tokenUsage.outputTokens ?? 0);
      const prev = this.sessionTokens.get(evt.sessionId) ?? 0;
      this.tokensUsed += Math.max(0, cumulative - prev);
      this.sessionTokens.set(evt.sessionId, cumulative);
    }

    // Completion-time budget check: pause immediately on breach (not only at schedule-time), but
    // only while pending work remains — never block a run that is about to finish.
    if (this.isOverBudget() && this.runStatus === 'running' && this.hasPendingNodes()) {
      this.pauseForBudget();
    }

    if (evt.reason === 'interrupted' || evt.reason === 'timeout') {
      // The user stopped the step, usually to steer it. It is not finished and must not fail:
      // it waits for them, and the turn that completes it later carries its output.
      st.waitingForUser = true;
      this.log({ kind: 'node-waiting', nodeId, sessionId: evt.sessionId, reason: 'stopped' });
      void this.deps.host.setSessionStatus(evt.sessionId, WAITING_FOR_USER_STATUS);
      return;
    }
    if (evt.reason === 'error') {
      this.failNode(nodeId, 'error', evt.sessionId);
      return;
    }

    if (evt.finalText?.trim()) st.replies.push(evt.finalText);
    // Background agents survive a Stop and wake the session when they finish. That turn's reply
    // is kept, but the step still waits for the user it was stopped for.
    if (st.waitingForUser && evt.fromUser === false) return;
    st.waitingForUser = false;
    if ((evt.backgroundWorkRunning ?? 0) > 0) {
      // Its background agents report back by waking the session for another turn.
      this.log({ kind: 'node-waiting', nodeId, sessionId: evt.sessionId, reason: 'background-work' });
      return;
    }

    const text = st.replies.join('\n\n');
    if (text.trim() === '') {
      // A finished turn without a reply delivered nothing for the dependents.
      this.failNode(nodeId, 'finished without a reply', evt.sessionId);
      return;
    }
    if (this.deps.classifyNodeOutcome && (this.deps.classifyNodeOutcome.isActive?.() ?? true)) {
      void this.finishNodeAfterOutcomeCheck(nodeId, evt.sessionId, text);
      return;
    }
    this.markNodeDone(nodeId, evt.sessionId, text);
  }

  private markNodeDone(nodeId: string, sessionId: string, text: string): void {
    const st = this.state.get(nodeId)!;
    const output: NodeOutput = { text };
    this.outputs[nodeId] = output;
    st.state = 'done';
    this.inFlight = Math.max(0, this.inFlight - 1);
    writeNodeOutput(this.deps.workspaceRoot, this.slug, this.runId, nodeId, output);
    this.log({ kind: 'node-finished', nodeId, sessionId, state: 'done' });
    void this.deps.host.setSessionStatus(sessionId, DONE_STATUS);
    void this.deps.host.setKanbanColumn(sessionId, 'done');
    this.scheduleReady();
  }

  /**
   * Ask the decision model how the child's turn ended before marking it done. The node stays
   * `running` meanwhile; if the run was stopped or the node re-dispatched during the await, the
   * answer is dropped.
   */
  private async finishNodeAfterOutcomeCheck(nodeId: string, sessionId: string, text: string): Promise<void> {
    let outcome: 'finished' | 'needs_input' | 'blocked' | null = null;
    try {
      outcome = await this.deps.classifyNodeOutcome!(text, { slug: this.slug, runId: this.runId, nodeId });
    } catch {
      outcome = null;
    }
    const st = this.state.get(nodeId);
    if (!st || st.state !== 'running' || st.sessionId !== sessionId) return;
    if (this.runStatus === 'stopped' || this.runStatus === 'completed' || this.runStatus === 'failed') return;

    try {
      if (outcome === 'needs_input') {
        this.failNode(nodeId, 'asked for input instead of finishing (nobody answers inside a task run: decide and continue)', sessionId);
      } else if (outcome === 'blocked') {
        this.failNode(nodeId, 'reported that it could not finish', sessionId);
      } else {
        this.markNodeDone(nodeId, sessionId, text);
      }
    } catch (err) {
      // Same reporting channel as the synchronous completion listener; the async hop would
      // otherwise route this to unhandledRejection.
      console.error(`[conductor] node completion failed for ${this.slug}/${this.runId}/${nodeId}:`, err);
    }
  }

  private failNode(nodeId: string, reason: string, sessionId?: string): void {
    const st = this.state.get(nodeId)!;
    const wasRunning = st.state === 'running';
    if (wasRunning) this.inFlight = Math.max(0, this.inFlight - 1);

    // Bounded, failure-aware retry: re-dispatch the node when its `retry` policy still
    // has budget and matches this failure class. error/timeout/dispatch failures all map
    // to the `error` retry trigger (empty/invalid detection is deferred).
    const node = this.spec.nodes.find((n) => n.id === nodeId);
    const retry = node?.retry;
    if (retry && st.attempt <= retry.limit && retryMatches(retry.when, 'error')) {
      st.lastFailure = `Previous attempt failed: ${reason}. Address the cause before retrying.`;
      st.state = 'pending';
      const sid = sessionId ?? st.sessionId;
      if (sid) void this.deps.host.setKanbanColumn(sid, 'todo');
      this.log({ kind: 'node-retry', nodeId, attempt: st.attempt, reason });
      this.scheduleReady();
      return;
    }

    st.state = 'failed';
    const sid = sessionId ?? st.sessionId;
    this.log({ kind: 'node-finished', nodeId, sessionId: sid ?? '', state: 'failed', reason });
    if (sid) void this.deps.host.setSessionStatus(sid, FAILED_STATUS);
    this.scheduleReady();
  }

  private maybeFinish(): void {
    if (this.runStatus !== 'running') return;
    if (this.inFlight > 0) return;
    if (this.spec.nodes.some((n) => this.isReady(n))) return; // more to dispatch
    const allGood = this.spec.nodes.every((n) => {
      const s = this.state.get(n.id)!.state;
      return s === 'done' || s === 'skipped';
    });
    if (!allGood) {
      this.finish('failed');
      return;
    }
    // All nodes succeeded. Gate the terminal status on the orchestrator's verdict when there is one
    // to ask; with no orchestrator there is nothing to verify against, so complete directly.
    if (this.opts.verifyOnComplete && this.opts.orchestratorSessionId) {
      this.enterVerifying();
    } else {
      this.finish('completed');
    }
  }

  /** Enter the non-terminal `verifying` state and ask the orchestrator for a verdict. Does NOT finalize. */
  private enterVerifying(): void {
    this.runStatus = 'verifying';
    this.log({ kind: 'run-verifying' });
    void this.sendVerification();
  }

  private finish(status: RunStatus): void {
    this.runStatus = status;
    this.log({ kind: status === 'completed' ? 'run-completed' : 'run-failed' });
    // Settle the task tile: completed → done, failed → needs-review (the fixed status set has no
    // 'failed'). The in-progress column was set at start().
    const orchestrator = this.opts.orchestratorSessionId;
    if (orchestrator) {
      if (status === 'completed') {
        void this.deps.host.setKanbanColumn(orchestrator, 'done');
        void this.deps.host.setSessionStatus(orchestrator, DONE_STATUS);
      } else {
        void this.deps.host.setSessionStatus(orchestrator, FAILED_STATUS);
      }
    }
    this.finalize();
  }

  private finalize(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.verdictOff?.();
    this.verdictOff = undefined;
    if (this.settled) return;
    this.settled = true;
    const snap = this.snapshot();
    for (const resolve of this.settleResolvers) resolve(snap);
    this.settleResolvers = [];
  }

  private async sendVerification(): Promise<void> {
    const orchestrator = this.opts.orchestratorSessionId;
    if (!orchestrator) {
      this.finish('completed');
      return;
    }
    this.attachVerdictListener(orchestrator);
    const sections = this.spec.nodes.map((n) => {
      const out = this.outputs[n.id];
      return `### ${nodeTitle(n)} (${n.id})\n${out ? out.text : '(no output)'}`;
    });
    const rubric = this.spec.acceptance_criteria
      ? `Acceptance criteria:\n${this.spec.acceptance_criteria}`
      : `Goal: ${this.spec.goal}`;
    const message = [
      `The task "${this.spec.title}" has finished running.`,
      '',
      rubric,
      '',
      'Node outputs:',
      ...sections,
      '',
      'Verify the final result against the criteria above and summarize the outcome.',
      'End your reply with a verdict line, on its own line, in exactly one of these forms:',
      'VERDICT: PASS',
      'VERDICT: FAIL — <one-line reason>',
      'If only some subtasks need redoing, name them so only those (and their dependents) re-run:',
      'VERDICT: FAIL — nodes=<id>,<id> — <one-line reason>',
    ].join('\n');
    await this.sendToOrchestrator(orchestrator, message);
  }

  /**
   * Attach the one-shot orchestrator-verdict listener (separate from the run's main subscription).
   * It catches the orchestrator's next completion, detaches itself, and routes the text to handleVerdict.
   */
  private attachVerdictListener(orchestrator: string): void {
    this.verdictOff?.();
    this.verdictOff = this.deps.host.onSessionComplete((evt) => {
      if (evt.sessionId !== orchestrator) return;
      // A stopped verification turn is not an answer: the user continues it, and that turn answers.
      if (evt.reason === 'interrupted' || evt.reason === 'timeout') return;
      const text = evt.finalText ?? '';
      // Still verifying with background agents: they wake the orchestrator for the verdict turn.
      if ((evt.backgroundWorkRunning ?? 0) > 0 && parseVerdict(text).result === 'unparsed') return;
      this.verdictOff?.();
      this.verdictOff = undefined;
      this.handleVerdict(text);
    });
  }

  /** Send to the orchestrator, failing the run (rather than hanging in `verifying`) if the send rejects. */
  private async sendToOrchestrator(orchestrator: string, message: string): Promise<void> {
    try {
      await this.deps.host.sendMessage(orchestrator, message);
    } catch {
      // The verdict will never arrive — detach the listener and settle as failed instead of hanging.
      this.verdictOff?.();
      this.verdictOff = undefined;
      this.finish('failed');
    }
  }

  /**
   * Route the orchestrator's reply: a parseable VERDICT line is applied directly; an unparsed reply is
   * first classified by the decision model when one is wired (`deps.decide`), otherwise re-asked.
   */
  private handleVerdict(text: string): void {
    if (this.runStatus !== 'verifying') return; // stopped/finalized while awaiting the verdict
    writeNodeOutput(this.deps.workspaceRoot, this.slug, this.runId, '__verdict__', { text });
    const verdict = parseVerdict(text);
    if (verdict.result === 'unparsed' && this.deps.decide) {
      void this.classifyUnparsedVerdict(text);
      return;
    }
    this.log({ kind: 'verdict', result: verdict.result, reason: verdict.reason, nodes: verdict.nodes });
    this.applyVerdict(verdict);
  }

  /**
   * Ask the decision model what an unparsed reply concludes. A confident PASS/FAIL is applied like a
   * parsed one (logged with `via: 'decision'`); anything else is treated as `unparsed` exactly as
   * before. The run may have been stopped while we waited — re-check before acting.
   */
  private async classifyUnparsedVerdict(text: string): Promise<void> {
    const nodeIds = this.spec.nodes.map((n) => n.id);
    const outcome = await classifyVerdictWithDecision(text, nodeIds, (request) =>
      this.deps.decide!(request, { slug: this.slug, runId: this.runId }),
    );
    if (this.runStatus !== 'verifying') return;
    try {
      if (outcome.kind === 'decided') {
        const { verdict } = outcome;
        this.log({ kind: 'verdict', result: verdict.result, reason: verdict.reason, nodes: verdict.nodes, via: 'decision', confidence: verdict.confidence });
        this.applyVerdict({ result: verdict.result, reason: verdict.reason, nodes: verdict.nodes, via: 'decision' });
        return;
      }
      // `via: 'decision'` only when a decision actually ran; an unavailable layer logs like before.
      this.log(outcome.kind === 'unsure' ? { kind: 'verdict', result: 'unparsed', via: 'decision' } : { kind: 'verdict', result: 'unparsed' });
      this.applyVerdict({ result: 'unparsed' });
    } catch (err) {
      // Same reporting channel as synchronous listener failures (SessionManager logs those); the
      // async hop would otherwise route this to unhandledRejection.
      console.error(`[conductor] verdict handling failed for ${this.slug}/${this.runId}:`, err);
    }
  }

  /**
   * Apply a verdict:
   *   PASS      → completed.
   *   unparsed  → re-ask for a well-formed verdict (bounded; not a repair); exhausted → failed.
   *   FAIL      → repair the frontier if budget remains, else failed (iterations/token budget breach).
   */
  private applyVerdict(verdict: { result: 'pass' | 'fail' | 'unparsed'; reason?: string; nodes?: string[]; via?: 'decision' }): void {
    if (verdict.result === 'pass') {
      this.unparsedReAsks = 0;
      this.finish('completed');
      return;
    }

    if (verdict.result === 'unparsed') {
      if (this.unparsedReAsks < MAX_UNPARSED_REASKS) {
        this.unparsedReAsks += 1;
        void this.reAskVerdict();
        return;
      }
      // Repeatedly malformed → don't hang the run forever.
      this.finish('failed');
      return;
    }

    // FAIL — repair the frontier if there is budget for it.
    if (this.repairsUsed >= this.maxRepairs) {
      this.log({ kind: 'budget-breach', metric: 'iterations', value: this.repairsUsed, limit: this.maxRepairs });
      this.finish('failed');
      return;
    }
    if (this.isOverBudget()) {
      this.log({ kind: 'budget-breach', metric: 'tokens', value: this.tokensUsed, limit: this.spec.token_budget! });
      this.finish('failed');
      return;
    }
    this.repairsUsed += 1;
    // Scoping needs the verifier's own reason: a FAIL the decision model read out of an unparsed
    // reply carries a fixed one. A narrowed repair gets one chance; the next FAIL repairs everything.
    const scopable = this.deps.pickRepairNodes && verdict.via !== 'decision' && !this.lastRepairScoped
      && (verdict.nodes?.length ?? 0) === 0 && verdict.reason;
    this.lastRepairScoped = false;
    if (scopable) {
      void this.repairAfterScoping(verdict.reason!);
      return;
    }
    this.repairForVerdict(verdict.reason, verdict.nodes);
  }

  /**
   * Ask the decision model which subtasks a FAIL reason implicates, then repair those (and their
   * dependents); no answer repairs the whole DAG. Dropped if the run was stopped meanwhile.
   */
  private async repairAfterScoping(reason: string): Promise<void> {
    let nodes: string[] | null = null;
    try {
      const candidates = this.spec.nodes.map((n) => ({ id: n.id, description: `${n.title ?? n.id}: ${n.prompt ?? ''}`.trim() }));
      nodes = await this.deps.pickRepairNodes!(reason, candidates, { slug: this.slug, runId: this.runId });
    } catch {
      nodes = null;
    }
    if (this.runStatus !== 'verifying') return;
    try {
      this.lastRepairScoped = nodes !== null;
      this.repairForVerdict(reason, nodes ?? undefined);
    } catch (err) {
      // Same reporting channel as classifyUnparsedVerdict; the async hop would otherwise route this
      // to unhandledRejection.
      console.error(`[conductor] repair failed for ${this.slug}/${this.runId}:`, err);
    }
  }

  /** Re-ask the orchestrator for a parseable verdict line (format-only; does not consume repair budget). */
  private async reAskVerdict(): Promise<void> {
    const orchestrator = this.opts.orchestratorSessionId;
    if (!orchestrator) {
      this.finish('completed');
      return;
    }
    this.attachVerdictListener(orchestrator);
    const message = [
      'Your previous reply did not include a parseable verdict line.',
      'Reply with the verdict line only, on its own line, in exactly one of these forms:',
      'VERDICT: PASS',
      'VERDICT: FAIL — <one-line reason>',
      'VERDICT: FAIL — nodes=<id>,<id> — <one-line reason>',
    ].join('\n');
    await this.sendToOrchestrator(orchestrator, message);
  }

  /**
   * On a FAIL verdict, re-run the repair frontier with the rejection reason as failure context.
   * The frontier is the orchestrator-named nodes ∪ their transitive dependents (so a re-run upstream
   * node forces everything that consumes its output to re-run too). With no usable names it is the
   * whole DAG. Only `done` nodes are reset; scheduleReady re-dispatches from the satisfied sources.
   */
  private repairForVerdict(reason: string | undefined, named?: string[]): void {
    const detail = reason ?? 'the result did not meet the acceptance criteria';
    let reset = 0;
    for (const id of this.computeFrontier(named)) {
      const st = this.state.get(id);
      if (!st || st.state !== 'done') continue;
      st.state = 'pending';
      st.lastFailure = `The previous result was rejected on verification: ${detail}. Revise your output to meet the acceptance criteria.`;
      this.log({ kind: 'node-retry', nodeId: id, attempt: st.attempt, reason: `verdict-fail: ${detail}` });
      reset += 1;
    }
    if (reset === 0) {
      // No `done` node in the frontier to re-run → don't hang the run.
      this.finish('failed');
      return;
    }
    this.runStatus = 'running';
    this.scheduleReady();
  }

  /**
   * The set of nodes a repair pass re-runs: the orchestrator-named nodes plus everything that
   * (transitively) depends on them. Unknown/empty names degrade to the whole DAG.
   */
  private computeFrontier(named?: string[]): Set<string> {
    const valid = (named ?? []).filter((id) => this.state.has(id));
    if (valid.length === 0) return new Set(this.spec.nodes.map((n) => n.id));
    const dependents = this.dependentsMap();
    const frontier = new Set<string>();
    const queue = [...valid];
    while (queue.length) {
      const id = queue.shift()!;
      if (frontier.has(id)) continue;
      frontier.add(id);
      for (const d of dependents.get(id) ?? []) if (!frontier.has(d)) queue.push(d);
    }
    return frontier;
  }

  /** Inverted `edges`: node id → set of nodes that directly depend on it (memoized). */
  private dependentsMap(): Map<string, Set<string>> {
    if (this.dependents) return this.dependents;
    const map = new Map<string, Set<string>>();
    for (const n of this.spec.nodes) map.set(n.id, new Set());
    for (const [node, upstreams] of this.edges) {
      for (const u of upstreams) map.get(u)?.add(node);
    }
    this.dependents = map;
    return map;
  }

  // --- budget ---

  private isOverBudget(): boolean {
    return this.spec.token_budget !== undefined && this.tokensUsed >= this.spec.token_budget;
  }

  private pauseForBudget(): void {
    this.log({ kind: 'budget-breach', metric: 'tokens', value: this.tokensUsed, limit: this.spec.token_budget! });
    this.pause();
  }

  /** True if any node is still waiting to be dispatched (used to avoid pausing a finishable run). */
  private hasPendingNodes(): boolean {
    for (const st of this.state.values()) if (st.state === 'pending') return true;
    return false;
  }

  // --- helpers ---

  private isTerminal(): boolean {
    return this.runStatus === 'completed' || this.runStatus === 'failed' || this.runStatus === 'stopped';
  }

  private log(entry: RunLogEntryInput): void {
    const t = this.deps.now ? this.deps.now() : new Date().toISOString();
    appendRunLog(this.deps.workspaceRoot, this.slug, this.runId, { ...entry, t } as RunLogEntry);
  }
}

// ---------------------------------------------------------------------------
// TaskRunner — registry/service over active runs
// ---------------------------------------------------------------------------

/**
 * Prefix for dispatched child prompts carrying the task's skill list as [skill:slug]
 * mentions. The agent pipeline (base-agent) parses these from any message, resolves each
 * skill's SKILL.md, and blocks tool use until the files are read — so task-level skills
 * act as mandatory context for every subtask. Empty/absent skills → empty prefix.
 */
function skillsPreamble(skills: string[] | undefined): string {
  if (!skills?.length) return '';
  return `Apply these skills: ${skills.map((s) => `[skill:${s}]`).join(' ')}\n\n`;
}

/**
 * Whether a node's `retry.when` trigger covers a given failure class. An absent `when`
 * defaults to retrying on `error` (the common "transient failure" case); `empty`/`invalid`
 * triggers are opt-in and not yet produced by the runner, so they never match here.
 */
function retryMatches(when: 'error' | 'empty' | 'invalid' | undefined, failure: 'error'): boolean {
  return (when ?? 'error') === failure;
}

/**
 * Parse the orchestrator's machine-readable verdict line. Tolerant of surrounding prose: the last
 * `VERDICT: PASS|FAIL [— [nodes=a,b — ]reason]` occurrence wins. A missing/garbled line is `unparsed`
 * — the caller re-asks (bounded) rather than hanging the run on a malformed reply.
 *
 * The optional `nodes=<id>,<id>` prefix names the subtasks to re-run on a FAIL (scoped repair). Node
 * ids are slugs (may contain single hyphens), so the prefix is split from the reason on an em-dash or
 * colon only — never on the hyphen that legitimately appears inside a slug.
 */
function parseVerdict(text: string): { result: 'pass' | 'fail' | 'unparsed'; reason?: string; nodes?: string[] } {
  const matches = [...text.matchAll(/VERDICT:\s*(PASS|FAIL)\b[ \t]*(?:[—:-]+[ \t]*([^\n]*))?/gi)];
  const last = matches.at(-1);
  if (!last) return { result: 'unparsed' };
  const result = last[1]!.toUpperCase() === 'PASS' ? 'pass' : 'fail';
  let rest = last[2]?.trim() || undefined;
  let nodes: string[] | undefined;
  if (rest) {
    const m = rest.match(/^nodes=([a-z0-9,\- ]+?)\s*(?:[—:]+\s*(.*))?$/i);
    if (m) {
      nodes = m[1]!.split(',').map((s) => s.trim()).filter(Boolean);
      rest = m[2]?.trim() || undefined;
    }
  }
  const out: { result: 'pass' | 'fail' | 'unparsed'; reason?: string; nodes?: string[] } = { result };
  if (rest) out.reason = rest;
  if (nodes && nodes.length) out.nodes = nodes;
  return out;
}

/** A run is terminal (no further work) once completed/failed/stopped. running/paused/verifying are active. */
function isTerminalRunStatus(status: RunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'stopped';
}

function resolveParams(spec: TaskSpec, provided?: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of spec.params ?? []) if (p.default !== undefined) out[p.name] = p.default;
  return { ...out, ...(provided ?? {}) };
}

export class TaskRunner {
  private readonly runs = new Map<string, ActiveRun>();

  constructor(private readonly deps: TaskRunnerDeps) {}

  private key(slug: string, runId: string): string {
    return `${slug}:${runId}`;
  }

  /** Load + validate a task's yaml and start a run. Throws if the task is missing or invalid. */
  run(slug: string, opts: RunOptions = {}): RunSnapshot {
    const loaded = loadTaskSpec(this.deps.workspaceRoot, slug);
    if (!loaded?.spec) throw new Error(`Task "${slug}" not found or has no valid task.yaml`);
    if (!loaded.valid) {
      throw new Error(`Refusing to run invalid task "${slug}": ${loaded.errors.map((e) => e.message).join('; ')}`);
    }
    // One active run per orchestrator: a second concurrent run would race the same parent session's
    // verdict listener (two runs attaching onSessionComplete on the same orchestrator would cross
    // their verifications). Block it. NOTE: this does not guard against a human typing into the
    // orchestrator mid-`verifying` — that race is a known, bounded v1 limitation.
    const orchestrator = opts.orchestratorSessionId;
    if (orchestrator) {
      // Tasks are one level deep: the board shows an orchestrator's children as its subtasks, so a
      // sub-session can't orchestrate a run of its own. An unknown id is let through as before.
      const parentId = this.deps.host.getSessionParentId(orchestrator);
      if (parentId) {
        throw new Error(`Task "${slug}" can't run on session ${orchestrator}: it is a sub-session of ${parentId}.`);
      }
      for (const existing of this.runs.values()) {
        const snap = existing.snapshot();
        if (snap.orchestratorSessionId === orchestrator && !isTerminalRunStatus(snap.status)) {
          throw new Error(
            `Task "${slug}" already has an active run (${snap.runId}) on this orchestrator; stop it before starting another.`,
          );
        }
      }
    }
    const runId = opts.runId ?? (this.deps.genRunId ? this.deps.genRunId() : `run-${Date.now()}`);
    const run = new ActiveRun(
      loaded.spec,
      slug,
      runId,
      { ...opts, params: resolveParams(loaded.spec, opts.params), verifyOnComplete: opts.verifyOnComplete ?? true },
      this.deps,
    );
    this.runs.set(this.key(slug, runId), run);
    run.start();
    return run.snapshot();
  }

  pause(slug: string, runId: string): void {
    this.runs.get(this.key(slug, runId))?.pause();
  }

  resume(slug: string, runId: string): void {
    const existing = this.runs.get(this.key(slug, runId));
    if (existing) {
      existing.resume();
      return;
    }
    // Not in memory (e.g. after an app restart): reconstruct from the persisted run-log.
    this.rehydrate(slug, runId);
  }

  /** Reconstruct an in-memory run from its persisted run-log + node outputs, then resume it. */
  private rehydrate(slug: string, runId: string): RunSnapshot {
    const loaded = loadTaskSpec(this.deps.workspaceRoot, slug);
    if (!loaded?.spec || !loaded.valid) {
      throw new Error(`Cannot resume "${slug}:${runId}": task.yaml is missing or invalid`);
    }
    const log = readRunLog(this.deps.workspaceRoot, slug, runId);
    if (log.length === 0) throw new Error(`Cannot resume "${slug}:${runId}": no run-log found`);
    const started = log.find((e) => e.kind === 'run-started');
    const orchestratorSessionId = started && started.kind === 'run-started' ? started.orchestratorSessionId : undefined;
    const run = new ActiveRun(
      loaded.spec,
      slug,
      runId,
      { orchestratorSessionId, params: resolveParams(loaded.spec), verifyOnComplete: true },
      this.deps,
    );
    run.hydrate(log, (nodeId) => readNodeOutput(this.deps.workspaceRoot, slug, runId, nodeId));
    this.runs.set(this.key(slug, runId), run);
    run.resumeFromHydrated();
    return run.snapshot();
  }

  async stop(slug: string, runId: string): Promise<void> {
    await this.runs.get(this.key(slug, runId))?.stop();
  }

  getRunState(slug: string, runId: string): RunSnapshot | null {
    return this.runs.get(this.key(slug, runId))?.snapshot() ?? null;
  }

  /** Await a run reaching a terminal state (completed/failed/stopped). */
  waitUntilSettled(slug: string, runId: string): Promise<RunSnapshot> {
    const run = this.runs.get(this.key(slug, runId));
    if (!run) return Promise.reject(new Error(`No active run ${slug}:${runId}`));
    return run.waitUntilSettled();
  }
}
