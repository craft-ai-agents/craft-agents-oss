/**
 * Workflows — run state types
 *
 * Types live in shared so the renderer can import them later (run page UI,
 * RPC DTOs). The runner state machine that produces these snapshots lives
 * in `@craft-agent/server-core/src/workflows/runner.ts`.
 *
 * Phase 1 only exercises a subset of these states/fields — `paused`,
 * `skipped`, `awaiting-human`, and the `attempts` counter are declared
 * for forward-compat with Phase 2/3 features (humanCheckpoint, retries,
 * `when`). See `docs/workflows/02-runtime.md` for the full state diagram.
 */

import type { WorkflowMetadata } from './types.ts';
import type { PermissionMode } from '../agent/mode-types.ts';
import type { ThinkingLevel } from '../agent/thinking-levels.ts';

/** Compact per-step receipt of the agent bundle used to execute a step. */
export interface WorkflowStepExecutionReceipt {
  createdAt: string;
  agent: {
    slug: string;
    name?: string;
  };
  config: {
    model?: string;
    llmConnection?: string;
    permissionMode?: PermissionMode;
    thinkingLevel?: ThinkingLevel;
  };
  injected: {
    skills: string[];
    sources: string[];
    contextDocs: {
      count: number;
      docs: Array<{ slug: string; name: string }>;
    };
    systemPromptChars?: number;
  };
  prompt: {
    chars: number;
    sha256: string;
  };
}

/** Run-level lifecycle. See `02-runtime.md` for the state diagram. */
export type WorkflowRunState =
  | 'created'
  | 'queued'
  | 'running'
  | 'interrupted'
  /** Phase 3 — humanCheckpoint pause. Declared for forward compat. */
  | 'paused'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

/** Per-step lifecycle. */
export type WorkflowRunStepState =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'interrupted'
  /** Phase 2 — `when` skipped this step. Declared for forward compat. */
  | 'skipped'
  /** Phase 3 — `humanCheckpoint`. Declared for forward compat. */
  | 'awaiting-human';

/** Per-step record persisted in run.json. */
export interface WorkflowRunStep {
  /** Step id, matching `WorkflowStep.id`. */
  id: string;
  state: WorkflowRunStepState;
  /** Session spawned to execute this step. Set once `running`. */
  sessionId?: string;
  /** Compact receipt of the resolved agent bundle used for this step. */
  executionReceipt?: WorkflowStepExecutionReceipt;
  startedAt?: string;
  completedAt?: string;
  /** Phase 1: last assistant text. Phase 2: parsed JSON when outputSchema set. */
  output?: unknown;
  /** Completion contract evidence captured after the final attempt. */
  completion?: {
    outputChars: number;
    toolUseCount?: number;
    satisfied: boolean;
  };
  error?: { code: string; message: string };
  /** Phase 1 always 1; declared for forward-compat with `retries`. */
  attempts: number;
}

/**
 * Full snapshot of a workflow run. Persisted at
 * `<workspaceRoot>/runs/<runId>/run.json` and rewritten atomically after
 * every state transition.
 *
 * The `workflowSnapshot` freezes the metadata + body at run-start so
 * subsequent edits to the source WORKFLOW.md don't mutate an in-flight
 * run (per "Risks & open questions" in `02-runtime.md`).
 */
export interface WorkflowRunSnapshot {
  /** UUID. */
  id: string;
  workflowSlug: string;
  workspaceId: string;
  state: WorkflowRunState;
  trigger: {
    /** 'manual' for Phase 1; left open for schedule/automation/webhook. */
    type: string;
    inputs: Record<string, unknown>;
    firedAt: string;
  };
  /**
   * Snapshot of the workflow at run-start. Subsequent edits to the
   * WORKFLOW.md do not affect this run.
   */
  workflowSnapshot: { metadata: WorkflowMetadata; body: string };
  steps: WorkflowRunStep[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  interruptedAt?: string;
  interruptionReason?: string;
  resumeFromStepId?: string;
  /** Run id this run was resumed/rerun from, when applicable. */
  resumedFromRunId?: string;
  /** Most recent run id created by resuming/rerunning this run, when applicable. */
  resumedByRunId?: string;
  /** Output bundles produced by this run. */
  outputIds?: string[];
  /** Primary user-facing deliverable for this run. */
  finalOutputId?: string;
  /** Non-fatal output finalization error, when publishing could not complete. */
  outputError?: string;
}
