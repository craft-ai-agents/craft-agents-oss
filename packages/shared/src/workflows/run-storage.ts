/**
 * Workflows — run persistence
 *
 * Layout:
 *   <workspaceRoot>/runs/<runId>/run.json
 *
 * Runs are persisted as a single JSON document per run. Writes are atomic
 * (write to `.tmp`, rename) so a crash mid-rewrite never leaves a partial
 * file. The whole file is small (kilobytes) so there's no need for
 * incremental updates. See `docs/workflows/02-runtime.md`.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { WorkflowRunSnapshot, WorkflowRunState, WorkflowRunStepState } from './run-types.ts';

const RUN_FILE = 'run.json';
const RUNS_DIR = 'runs';
const WORKFLOW_RUN_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const RUN_STATES: ReadonlySet<WorkflowRunState> = new Set([
  'created',
  'queued',
  'running',
  'interrupted',
  'paused',
  'succeeded',
  'failed',
  'cancelled',
]);

const STEP_STATES: ReadonlySet<WorkflowRunStepState> = new Set([
  'queued',
  'running',
  'succeeded',
  'failed',
  'interrupted',
  'skipped',
  'awaiting-human',
]);

export function isValidWorkflowRunId(runId: string): boolean {
  return WORKFLOW_RUN_ID_REGEX.test(runId);
}

export function assertValidWorkflowRunId(runId: string): void {
  if (!isValidWorkflowRunId(runId)) {
    throw new Error(`Invalid workflow run id: ${runId}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

function isContainedPath(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function resolveRunDir(workspaceRootPath: string, runId: string): string | null {
  if (!isValidWorkflowRunId(runId)) return null;
  const runsRoot = resolve(workspaceRootPath, RUNS_DIR);
  const runDir = resolve(runsRoot, runId);
  return isContainedPath(runsRoot, runDir) ? runDir : null;
}

function isWorkflowRunSnapshot(value: unknown, expectedRunId: string): value is WorkflowRunSnapshot {
  if (!isRecord(value)) return false;
  if (value.id !== expectedRunId || !isValidWorkflowRunId(expectedRunId)) return false;
  if (typeof value.workflowSlug !== 'string' || !value.workflowSlug) return false;
  if (typeof value.workspaceId !== 'string' || !value.workspaceId) return false;
  if (typeof value.state !== 'string' || !RUN_STATES.has(value.state as WorkflowRunState)) return false;
  if (typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') return false;

  const trigger = value.trigger;
  if (!isRecord(trigger)) return false;
  if (typeof trigger.type !== 'string') return false;
  if (!isJsonRecord(trigger.inputs)) return false;
  if (typeof trigger.firedAt !== 'string') return false;

  const workflowSnapshot = value.workflowSnapshot;
  if (!isRecord(workflowSnapshot)) return false;
  if (!isRecord(workflowSnapshot.metadata)) return false;
  if (typeof workflowSnapshot.body !== 'string') return false;

  if (!Array.isArray(value.steps)) return false;
  for (const step of value.steps) {
    if (!isRecord(step)) return false;
    if (typeof step.id !== 'string' || !step.id) return false;
    if (typeof step.state !== 'string' || !STEP_STATES.has(step.state as WorkflowRunStepState)) return false;
    if (typeof step.attempts !== 'number' || !Number.isInteger(step.attempts) || step.attempts < 0) return false;
    if (step.error !== undefined) {
      if (!isRecord(step.error)) return false;
      if (typeof step.error.code !== 'string' || typeof step.error.message !== 'string') return false;
    }
  }

  for (const field of [
    'completedAt',
    'interruptedAt',
    'interruptionReason',
    'resumeFromStepId',
    'resumedFromRunId',
    'resumedByRunId',
    'finalOutputId',
    'outputError',
  ] as const) {
    if (value[field] !== undefined && typeof value[field] !== 'string') return false;
  }

  if (typeof value.resumedFromRunId === 'string' && !isValidWorkflowRunId(value.resumedFromRunId)) return false;
  if (typeof value.resumedByRunId === 'string' && !isValidWorkflowRunId(value.resumedByRunId)) return false;
  if (value.outputIds !== undefined) {
    if (!Array.isArray(value.outputIds)) return false;
    if (!value.outputIds.every((id) => typeof id === 'string')) return false;
  }

  return true;
}

/** `<workspaceRoot>/runs/` */
export function getRunsDir(workspaceRootPath: string): string {
  return join(workspaceRootPath, RUNS_DIR);
}

/** `<workspaceRoot>/runs/<runId>/` */
export function getRunDir(workspaceRootPath: string, runId: string): string {
  const dir = resolveRunDir(workspaceRootPath, runId);
  if (!dir) throw new Error(`Invalid workflow run id: ${runId}`);
  return dir;
}

/** `<workspaceRoot>/runs/<runId>/run.json` */
export function getRunFile(workspaceRootPath: string, runId: string): string {
  return join(getRunDir(workspaceRootPath, runId), RUN_FILE);
}

/**
 * Atomically write a run snapshot to disk. Creates the run directory if
 * needed. Writes to a `.tmp` sibling, then renames — `rename` is atomic
 * within the same filesystem on POSIX.
 */
export function writeRun(workspaceRootPath: string, run: WorkflowRunSnapshot): void {
  const runId = run.id;
  if (!isWorkflowRunSnapshot(run, runId)) {
    throw new Error(`Invalid workflow run snapshot: ${runId}`);
  }
  const dir = getRunDir(workspaceRootPath, runId);
  mkdirSync(dir, { recursive: true });
  const finalPath = join(dir, RUN_FILE);
  const tmpPath = `${finalPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(run, null, 2) + '\n', 'utf-8');
  renameSync(tmpPath, finalPath);
}

/** Read a run snapshot. Returns null when missing or unparsable. */
export function readRun(workspaceRootPath: string, runId: string): WorkflowRunSnapshot | null {
  const dir = resolveRunDir(workspaceRootPath, runId);
  if (!dir) return null;
  const file = join(dir, RUN_FILE);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as unknown;
    if (!isWorkflowRunSnapshot(parsed, runId)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** List all runs for a workspace, sorted newest-first by `createdAt`. */
export function listRuns(workspaceRootPath: string): WorkflowRunSnapshot[] {
  const root = getRunsDir(workspaceRootPath);
  if (!existsSync(root)) return [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: WorkflowRunSnapshot[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const run = readRun(workspaceRootPath, entry.name);
    if (run) out.push(run);
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return out;
}

/**
 * Mark persisted running runs as interrupted after runner recovery detects
 * orphaned execution. Returns the snapshots that were changed and persisted.
 */
export function markRunningRunsInterrupted(
  workspaceRootPath: string,
  reason: string,
): WorkflowRunSnapshot[] {
  const now = new Date().toISOString();
  const interrupted: WorkflowRunSnapshot[] = [];

  for (const run of listRuns(workspaceRootPath)) {
    if (run.state !== 'running') continue;

    const runningStep = run.steps.find((step) => step.state === 'running');
    const next: WorkflowRunSnapshot = {
      ...run,
      state: 'interrupted',
      completedAt: now,
      interruptedAt: now,
      interruptionReason: reason,
      updatedAt: now,
      resumeFromStepId: runningStep?.id ?? run.resumeFromStepId,
      steps: run.steps.map((step) => {
        if (step.state !== 'running') return step;
        return {
          ...step,
          state: 'failed',
          completedAt: now,
          error: {
            code: 'run-interrupted',
            message: reason,
          },
        };
      }),
    };

    writeRun(workspaceRootPath, next);
    interrupted.push(next);
  }

  return interrupted;
}

/** Delete a run's directory. Returns true when something was removed. */
export function deleteRun(workspaceRootPath: string, runId: string): boolean {
  const dir = resolveRunDir(workspaceRootPath, runId);
  if (!dir) return false;
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}
