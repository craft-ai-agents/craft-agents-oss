/**
 * PulseExecutor — runtime that fires when a SchedulerTick automation
 * with `action.type === 'pulse'` matches.
 *
 * Mirrors the workflow-runner pattern: deps are injected so SessionManager
 * (or tests) can wire spawning, workflow dispatch, and notification routing.
 */

import {
  appendPulseTick,
  assemblePulseSnapshot,
  detectNotifyStreakGoal,
  getSilencedUntil,
  PULSE_DECISION_OUTPUT_SCHEMA,
  PULSE_INSTRUCTION_FOOTER,
  PULSE_MIN_INTERVAL_MS,
  readPulseTicks,
  silenceGoal,
  type PulseAction,
  type PulseAnsweredQuestion,
  type PulseDecisionAction,
  type PulseOpenQuestion,
  type PulseSnapshotAutomationItem,
  type PulseSnapshotGoal,
  type PulseSnapshotOutputItem,
  type PulseSnapshotSessionItem,
  type PulseTickEntry,
} from '@craft-agent/shared/pulses';
import {
  appendOutputSchemaInstruction,
  loadGlobalWorkflow,
  parseStructuredStepOutput,
} from '@craft-agent/shared/workflows';
import { loadAllContextDocs } from '@craft-agent/shared/workspace-context';
import { listOutputManifests } from '@craft-agent/shared/outputs';

export interface PulseNotificationPayload {
  workspaceId: string;
  pulseId: string;
  source: 'pulse';
  message: string;
  urgency: 'low' | 'normal' | 'high';
  goalSlug?: string;
  awaitingResponse?: boolean;
  workflowRunId?: string;
  workflowSlug?: string;
  createdAt: string;
}

export interface PulseExecutorRunDriverParams {
  workspaceId: string;
  driverAgentSlug: string;
  systemPromptAddendum: string;
  userMessage: string;
  outputSchema: Record<string, unknown>;
  permissionMode: 'safe';
}

export interface PulseExecutorDeps {
  /** Resolve workspace ID → root path. */
  getWorkspaceRootPath: (workspaceId: string) => string;
  /** Spawn a hidden driver session and run one turn. Must run in `safe` mode. */
  runDriverTurn: (params: PulseExecutorRunDriverParams) => Promise<{
    sessionId: string;
    rawAssistantText: string;
    durationMs: number;
  }>;
  /** Kick a workflow when decision === kick_workflow. Returns null if workflow gone. */
  startWorkflow: (params: {
    workspaceId: string;
    workflowSlug: string;
    triggerInputs: Record<string, unknown>;
  }) => Promise<{ runId: string } | null>;
  /** Emit a notification (bell / concierge / messaging). */
  emitNotification: (n: PulseNotificationPayload) => void;
  /** Optional list of recent session metadata for the diff. */
  listRecentSessions?: (workspaceRootPath: string) => Array<{
    id: string;
    name: string;
    status: string;
    updatedAt: string;
  }>;
  /** Optional automation event log reader (Phase 1 returns []). */
  listRecentAutomationEvents?: (workspaceRootPath: string) => PulseSnapshotAutomationItem[];
  /** Optional memory write event log reader (Phase 1 returns 0). */
  countMemoryWritesSince?: (workspaceRootPath: string, sinceIso: string) => number;
  /**
   * Optional reader for ask_user questions still awaiting a user reply.
   * Called once per tick. Surface them in the snapshot so the driver
   * doesn't re-ask the same thing.
   */
  listOpenQuestions?: (workspaceId: string, pulseId: string) => PulseOpenQuestion[];
  /**
   * Optional reader for ask_user questions the user has answered since the
   * last tick. Closes the ask→answer→act loop — without this, the user's
   * reply is captured to disk and silently forgotten.
   */
  listRecentAnswers?: (
    workspaceId: string,
    pulseId: string,
    sinceIso: string,
  ) => PulseAnsweredQuestion[];
  /** Fires after the tick is recorded. Used to broadcast pulses.TICK live. */
  onTick?: (entry: PulseTickEntry) => void;
}

export interface PulseExecutorInput {
  workspaceId: string;
  pulseId: string;
  pulseAction: PulseAction;
  /** ISO timestamp from the SchedulerTick fire. */
  automationFiredAt: string;
}

export class PulseExecutor {
  constructor(private readonly deps: PulseExecutorDeps) {}

  async execute(input: PulseExecutorInput): Promise<PulseTickEntry> {
    const startedAt = Date.now();
    const { workspaceId, pulseId, pulseAction, automationFiredAt } = input;
    const workspaceRoot = this.deps.getWorkspaceRootPath(workspaceId);
    const now = new Date();

    const recentTicks = readPulseTicks(workspaceRoot, pulseId, { limit: 10 });
    const lastTickAt = recentTicks[0]?.tickedAt;

    // ----- M-4. Runtime cadence floor -----
    // Reject sub-10-min consecutive ticks regardless of cron, so a hand-
    // edited automations.json can't bypass the create-time validation.
    if (lastTickAt) {
      const sinceMs = now.getTime() - new Date(lastTickAt).getTime();
      if (sinceMs > 0 && sinceMs < PULSE_MIN_INTERVAL_MS) {
        return this.recordTick({
          workspaceRoot,
          pulseId,
          decision: {
            action: 'do_nothing',
            reason: `cadence floor (${Math.round(sinceMs / 1000)}s since last tick; floor is ${Math.round(PULSE_MIN_INTERVAL_MS / 1000)}s)`,
          },
          driverSessionId: '',
          startedAt,
          diffSummary: { outputs: 0, sessions: 0, automations: 0, memoryWrites: 0 },
          truncated: false,
        });
      }
    }

    // ----- C-4. Anti-spam: persisted silencedUntil per (pulseId, goalSlug) -----
    // Replaces the streak-detection logic that fired the silenced tick itself,
    // breaking its own streak and producing every-other-tick spam. The
    // streak detector IS still used to *decide when to start silencing* — but
    // because the helper skips do_nothing ticks tagged "silenced/anti-spam"
    // (see detectNotifyStreakGoal), an active silence does NOT break the
    // streak; the silence persists across silenced ticks naturally.
    //
    // When a streak is detected:
    //   1. Mark the goal silenced for PULSE_SILENCE_DURATION_MS.
    //   2. Skip the driver entirely (saves the LLM call cost) and record a
    //      do_nothing tick. Subsequent ticks check the persisted state at
    //      dispatch time, so any driver decision targeting a silenced goal
    //      is suppressed without re-invoking detection.
    {
      const streakGoal = detectNotifyStreakGoal(recentTicks);
      if (streakGoal !== undefined) {
        const until = silenceGoal(workspaceRoot, pulseId, streakGoal, now);
        return this.recordTick({
          workspaceRoot,
          pulseId,
          decision: {
            action: 'do_nothing',
            reason: `silenced (anti-spam: 3 consecutive notify_user for goal "${streakGoal}", silenced until ${until})`,
          },
          driverSessionId: '',
          startedAt,
          diffSummary: { outputs: 0, sessions: 0, automations: 0, memoryWrites: 0 },
          truncated: false,
        });
      }
    }

    // ----- 2. Snapshot deps -----
    // Load workspace context once per tick — a full scan + parse on every
    // tick used to be hidden inside the dep closure, so the read fired for
    // each goal-section render. Cache once in a captured variable.
    const allContextDocs = loadAllContextDocs(workspaceRoot);

    const goalDocs = (): PulseSnapshotGoal[] => {
      const filtered = allContextDocs.filter((d) => d.metadata.status === 'active');
      const allowed = pulseAction.goalSlugs && pulseAction.goalSlugs.length > 0
        ? new Set(pulseAction.goalSlugs)
        : null;
      return filtered
        .filter((d) => (allowed ? allowed.has(d.slug) : true))
        .map((d) => ({
          slug: d.slug,
          name: d.metadata.name,
          description: d.metadata.description,
          body: d.body,
          status: (d.metadata.status ?? 'active') as PulseSnapshotGoal['status'],
          priority: d.metadata.priority,
          deadline: d.metadata.deadline,
        }));
    };

    const outputsSince = (sinceIso: string): PulseSnapshotOutputItem[] =>
      listOutputManifests(workspaceRoot)
        .filter((m) => m.createdAt >= sinceIso)
        .map((m) => ({ id: m.id, title: m.title, createdAt: m.createdAt }));

    const sessionsSince = (sinceIso: string): PulseSnapshotSessionItem[] => {
      const list = this.deps.listRecentSessions?.(workspaceRoot) ?? [];
      const eligible = new Set(['completed', 'succeeded', 'failed']);
      return list
        .filter((s) => s.updatedAt >= sinceIso && eligible.has(s.status))
        .map((s) => ({ id: s.id, name: s.name, status: s.status, updatedAt: s.updatedAt }));
    };

    const automationsSince = (_sinceIso: string): PulseSnapshotAutomationItem[] => {
      // TODO(Wave 3): wire automation event log when EventLogHandler exposes a query API.
      return this.deps.listRecentAutomationEvents?.(workspaceRoot) ?? [];
    };

    const memoryWritesSince = (sinceIso: string): number => {
      // TODO(Wave 3): wire memory event log when memory module emits writes.
      return this.deps.countMemoryWritesSince?.(workspaceRoot, sinceIso) ?? 0;
    };

    const snapshot = assemblePulseSnapshot(
      {
        workspaceRootPath: workspaceRoot,
        pulseId,
        goalSlugs: pulseAction.goalSlugs,
        diffWindowMinutes: pulseAction.diffWindowMinutes ?? 60,
        lastTickAt,
      },
      {
        loadGoalDocs: goalDocs,
        countOutputsSince: outputsSince,
        countSessionsSince: sessionsSince,
        countAutomationsSince: automationsSince,
        countMemoryWritesSince: memoryWritesSince,
        recentTicks: (limit: number) => readPulseTicks(workspaceRoot, pulseId, { limit }),
        openQuestions: () => this.deps.listOpenQuestions?.(workspaceId, pulseId) ?? [],
        recentAnswers: (sinceIso: string) =>
          this.deps.listRecentAnswers?.(workspaceId, pulseId, sinceIso) ?? [],
      },
    );

    // ----- 5/6. Driver turn + parse -----
    const driverAgentSlug = pulseAction.driverAgentSlug ?? 'orchestrator';
    const systemPromptAddendum = appendOutputSchemaInstruction(
      PULSE_INSTRUCTION_FOOTER,
      PULSE_DECISION_OUTPUT_SCHEMA,
    );

    let driverSessionId = '';
    let rawText = '';
    try {
      const result = await this.deps.runDriverTurn({
        workspaceId,
        driverAgentSlug,
        systemPromptAddendum,
        userMessage: snapshot.text,
        outputSchema: PULSE_DECISION_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
        permissionMode: 'safe',
      });
      driverSessionId = result.sessionId;
      rawText = result.rawAssistantText;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.recordTick({
        workspaceRoot,
        pulseId,
        decision: { action: 'do_nothing', reason: `driver-error: ${message}` },
        driverSessionId,
        startedAt,
        diffSummary: snapshot.diffSummary,
        truncated: snapshot.truncated,
      });
    }

    const parsed = parseStructuredStepOutput(rawText, PULSE_DECISION_OUTPUT_SCHEMA);
    if (!parsed.ok) {
      return this.recordTick({
        workspaceRoot,
        pulseId,
        decision: {
          action: 'do_nothing',
          reason: `invalid-driver-output: ${parsed.message}`,
        },
        driverSessionId,
        startedAt,
        diffSummary: snapshot.diffSummary,
        truncated: snapshot.truncated,
      });
    }

    const decision = parsed.value as PulseDecisionAction;

    // ----- 4 + 7. Validate workflow if needed; dispatch the action -----
    let dispatched = decision;
    const nowIso = new Date(automationFiredAt).toISOString();

    switch (decision.action) {
      case 'do_nothing':
        break;
      case 'notify_user': {
        // Honor persisted silencedUntil — even if the driver decides to
        // notify, we suppress when the goal is currently silenced. This is
        // the load-bearing guarantee that anti-spam actually works.
        const silencedUntil = getSilencedUntil(workspaceRoot, pulseId, decision.goalSlug, now);
        if (silencedUntil) {
          dispatched = {
            action: 'do_nothing',
            reason: `silenced (goal "${decision.goalSlug ?? '(none)'}" silenced until ${silencedUntil})`,
          };
          break;
        }
        this.deps.emitNotification({
          workspaceId,
          pulseId,
          source: 'pulse',
          message: decision.message,
          urgency: decision.urgency,
          goalSlug: decision.goalSlug,
          awaitingResponse: false,
          createdAt: nowIso,
        });
        break;
      }
      case 'ask_user': {
        // Same silence gate applies to ask_user — re-asking a silenced goal
        // would defeat the purpose.
        const silencedUntil = getSilencedUntil(workspaceRoot, pulseId, decision.goalSlug, now);
        if (silencedUntil) {
          dispatched = {
            action: 'do_nothing',
            reason: `silenced (goal "${decision.goalSlug ?? '(none)'}" silenced until ${silencedUntil})`,
          };
          break;
        }
        this.deps.emitNotification({
          workspaceId,
          pulseId,
          source: 'pulse',
          message: decision.question,
          urgency: 'normal',
          goalSlug: decision.goalSlug,
          awaitingResponse: true,
          createdAt: nowIso,
        });
        break;
      }
      case 'kick_workflow': {
        const wf = loadGlobalWorkflow(decision.workflowSlug);
        if (!wf) {
          dispatched = {
            action: 'notify_user',
            message: `Pulse wanted to kick workflow "${decision.workflowSlug}" but it does not exist. Original reason: ${decision.why}`,
            urgency: 'normal',
            goalSlug: decision.goalSlug,
          };
          this.deps.emitNotification({
            workspaceId,
            pulseId,
            source: 'pulse',
            message: dispatched.message,
            urgency: 'normal',
            goalSlug: decision.goalSlug,
            awaitingResponse: false,
            createdAt: nowIso,
          });
          break;
        }
        const started = await this.deps.startWorkflow({
          workspaceId,
          workflowSlug: decision.workflowSlug,
          triggerInputs: decision.inputs ?? {},
        });
        if (!started) {
          dispatched = {
            action: 'notify_user',
            message: `Pulse failed to start workflow "${decision.workflowSlug}" (vanished between validation and dispatch). Original reason: ${decision.why}`,
            urgency: 'normal',
            goalSlug: decision.goalSlug,
          };
          this.deps.emitNotification({
            workspaceId,
            pulseId,
            source: 'pulse',
            message: dispatched.message,
            urgency: 'normal',
            goalSlug: decision.goalSlug,
            awaitingResponse: false,
            createdAt: nowIso,
          });
          break;
        }
        this.deps.emitNotification({
          workspaceId,
          pulseId,
          source: 'pulse',
          message: `Pulse kicked workflow "${decision.workflowSlug}": ${decision.why}`,
          urgency: 'low',
          goalSlug: decision.goalSlug,
          awaitingResponse: false,
          workflowRunId: started.runId,
          workflowSlug: decision.workflowSlug,
          createdAt: nowIso,
        });
        break;
      }
    }

    return this.recordTick({
      workspaceRoot,
      pulseId,
      decision: dispatched,
      driverSessionId,
      startedAt,
      diffSummary: snapshot.diffSummary,
      truncated: snapshot.truncated,
    });
  }

  private recordTick(args: {
    workspaceRoot: string;
    pulseId: string;
    decision: PulseDecisionAction;
    driverSessionId: string;
    startedAt: number;
    diffSummary: PulseTickEntry['diffSummary'];
    truncated: boolean;
  }): PulseTickEntry {
    const entry: PulseTickEntry = {
      pulseId: args.pulseId,
      tickedAt: new Date().toISOString(),
      durationMs: Date.now() - args.startedAt,
      decision: args.decision,
      driverSessionId: args.driverSessionId,
      diffSummary: args.diffSummary,
      truncated: args.truncated,
    };
    appendPulseTick(args.workspaceRoot, args.pulseId, entry);
    this.deps.onTick?.(entry);
    return entry;
  }
}

