/**
 * Pulses — type contracts.
 *
 * A Pulse is an automation that runs the Orchestrator against a structured
 * world snapshot on a cron tick and forces a JSON decision. Goals piggyback
 * on Workspace Context docs (see `docs/pulses/01-spec.md`).
 *
 * These types are the load-bearing contract consumed by Wave 2 modules:
 * automations integration, RPC bridge, and renderer UI.
 */

import type { JsonSchema } from '../workflows/types.ts';

// ============================================================================
// Decision (forced JSON output of every tick)
// ============================================================================

export type PulseDecisionAction =
  | { action: 'do_nothing'; reason: string }
  | {
      action: 'notify_user';
      message: string;
      urgency: 'low' | 'normal' | 'high';
      goalSlug?: string;
    }
  | {
      action: 'kick_workflow';
      workflowSlug: string;
      inputs?: Record<string, unknown>;
      why: string;
      goalSlug?: string;
    }
  | { action: 'ask_user'; question: string; goalSlug?: string };

// ============================================================================
// Pulse automation action shape
// ============================================================================

export interface PulseAction {
  type: 'pulse';
  /** Slug of the agent that drives the pulse. Defaults to 'orchestrator'. */
  driverAgentSlug?: string;
  /** Goal slugs to consider. If omitted, all goals with status: active. */
  goalSlugs?: string[];
  /** How far back to look for "recent activity" diff. Defaults to schedule cadence. */
  diffWindowMinutes?: number;
  /** Where notify_user actions land. */
  notify?: {
    /** Default true. */
    bell?: boolean;
    /** Default true. */
    conciergeChat?: boolean;
    /** Optional bound channel slug. */
    messagingChannel?: string;
    /** Gate outbound messages to channel. Default 'normal'. */
    minUrgencyForChannel?: 'low' | 'normal' | 'high';
  };
}

// ============================================================================
// Tick log entry
// ============================================================================

export interface PulseTickDiffSummary {
  outputs: number;
  sessions: number;
  automations: number;
  memoryWrites: number;
}

export interface PulseTickEntry {
  pulseId: string;
  /** ISO timestamp. */
  tickedAt: string;
  durationMs: number;
  decision: PulseDecisionAction;
  driverSessionId: string;
  diffSummary: PulseTickDiffSummary;
  /** True when the snapshot had to truncate to fit the token budget. */
  truncated?: boolean;
}

// ============================================================================
// World snapshot
// ============================================================================

export interface PulseSnapshotInputs {
  workspaceRootPath: string;
  pulseId: string;
  /** Explicit override; else "all status:active" goals. */
  goalSlugs?: string[];
  diffWindowMinutes: number;
  /** ISO timestamp of the previous tick, if any. */
  lastTickAt?: string;
  /** For tests; defaults to new Date() at call time. */
  now?: Date;
}

export interface PulseSnapshot {
  /** Assembled prompt body. */
  text: string;
  goalCount: number;
  diffSummary: PulseTickDiffSummary;
  /** Rough estimate: text.length / 4. */
  tokenEstimate: number;
  truncated: boolean;
}

export interface PulseSnapshotGoal {
  slug: string;
  name: string;
  description?: string;
  body: string;
  status: 'active' | 'blocked' | 'paused' | 'done';
  priority?: 'low' | 'normal' | 'high';
  deadline?: string;
}

export interface PulseSnapshotOutputItem {
  id: string;
  title: string;
  createdAt: string;
}
export interface PulseSnapshotSessionItem {
  id: string;
  name: string;
  status: string;
  updatedAt: string;
}
export interface PulseSnapshotAutomationItem {
  slug: string;
  firedAt: string;
}

export interface PulseSnapshotDeps {
  loadGoalDocs: () => PulseSnapshotGoal[];
  countOutputsSince: (sinceIso: string) => PulseSnapshotOutputItem[];
  countSessionsSince: (sinceIso: string) => PulseSnapshotSessionItem[];
  countAutomationsSince: (sinceIso: string) => PulseSnapshotAutomationItem[];
  countMemoryWritesSince: (sinceIso: string) => number;
  recentTicks: (limit: number) => PulseTickEntry[];
  /**
   * Open questions the Pulse asked the user that haven't been answered yet.
   * Surfaced into the snapshot so the driver knows not to re-ask.
   */
  openQuestions?: () => PulseOpenQuestion[];
  /**
   * Recent answered ask_user replies (since lastTickAt). Surfaced so the
   * driver can act on the user's reply on the next tick — closing the
   * ask→answer→act loop.
   */
  recentAnswers?: (sinceIso: string) => PulseAnsweredQuestion[];
  /** ISO timestamp of "now" — defaults to new Date().toISOString(). */
  nowIso?: string;
  /** User's working hours for the time-context block. */
  workingHours?: { startHour: number; endHour: number; timezone?: string };
}

export interface PulseOpenQuestion {
  question: string;
  goalSlug?: string;
  askedAt: string;
}

export interface PulseAnsweredQuestion {
  question: string;
  answer: string;
  goalSlug?: string;
  askedAt: string;
  answeredAt: string;
}

// ============================================================================
// Anti-spam silence state — persisted per Pulse to survive restarts and
// avoid the streak-detection flaw where the silenced tick itself breaks the
// streak (firing every other tick instead of staying muted).
// ============================================================================

export interface PulseSilenceState {
  pulseId: string;
  /** Per-goalSlug silenced-until ISO. The empty string is a valid key for
   *  notifications that arrived without a goalSlug. */
  silencedUntilByGoal: Record<string, string>;
  updatedAt: string;
}

/** How long to silence a goal once the threshold is crossed. */
export const PULSE_SILENCE_DURATION_MS = 6 * 60 * 60 * 1000; // 6 hours

/** Number of consecutive same-goal notify_user ticks that triggers silence. */
export const PULSE_ANTI_SPAM_THRESHOLD = 3;

/** Cadence floor enforced at runtime (separate from create-time validation). */
export const PULSE_MIN_INTERVAL_MS = 10 * 60 * 1000;

// ============================================================================
// Constants
// ============================================================================

export const PULSE_SNAPSHOT_TOKEN_BUDGET = 3000;

/** Same shape as agent slug; pulseId derives from automation matcher. */
export const PULSE_ID_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** Verbatim instruction footer (see spec section 4). */
export const PULSE_INSTRUCTION_FOOTER = `You are running as a Pulse decision. Default to \`do_nothing\`.
Only choose \`notify_user\` if a fact has changed that the user would
genuinely benefit from knowing within the next hour.
Only choose \`kick_workflow\` if a goal is stalled AND a workflow exists
that would clearly advance it.
Only choose \`ask_user\` if a goal is blocked on a question only the
user can answer AND you haven't asked the same question in the last
5 ticks (check the recent decisions log above).
Be quiet. The user trusts silence.

Reply with a single JSON object matching the decision schema. No prose
outside the JSON object.`;

// ============================================================================
// JSON Schema for the decision union — Wave 2's PulseExecutor passes this
// to `appendOutputSchemaInstruction` to enforce JSON output.
// ============================================================================

export const PULSE_DECISION_OUTPUT_SCHEMA: JsonSchema = {
  type: 'object',
  oneOf: [
    {
      type: 'object',
      required: ['action', 'reason'],
      additionalProperties: false,
      properties: {
        action: { type: 'string', const: 'do_nothing' },
        reason: { type: 'string' },
      },
    },
    {
      type: 'object',
      required: ['action', 'message', 'urgency'],
      additionalProperties: false,
      properties: {
        action: { type: 'string', const: 'notify_user' },
        message: { type: 'string' },
        urgency: { type: 'string', enum: ['low', 'normal', 'high'] },
        goalSlug: { type: 'string' },
      },
    },
    {
      type: 'object',
      required: ['action', 'workflowSlug', 'why'],
      additionalProperties: false,
      properties: {
        action: { type: 'string', const: 'kick_workflow' },
        workflowSlug: { type: 'string' },
        inputs: { type: 'object' },
        why: { type: 'string' },
        goalSlug: { type: 'string' },
      },
    },
    {
      type: 'object',
      required: ['action', 'question'],
      additionalProperties: false,
      properties: {
        action: { type: 'string', const: 'ask_user' },
        question: { type: 'string' },
        goalSlug: { type: 'string' },
      },
    },
  ],
};
