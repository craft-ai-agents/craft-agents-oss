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
import { join } from 'node:path';
import type { WorkflowRunSnapshot } from './run-types.ts';

const RUN_FILE = 'run.json';
const RUNS_DIR = 'runs';

/** `<workspaceRoot>/runs/` */
export function getRunsDir(workspaceRootPath: string): string {
  return join(workspaceRootPath, RUNS_DIR);
}

/** `<workspaceRoot>/runs/<runId>/` */
export function getRunDir(workspaceRootPath: string, runId: string): string {
  return join(getRunsDir(workspaceRootPath), runId);
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
  const dir = getRunDir(workspaceRootPath, run.id);
  mkdirSync(dir, { recursive: true });
  const finalPath = join(dir, RUN_FILE);
  const tmpPath = `${finalPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(run, null, 2) + '\n', 'utf-8');
  renameSync(tmpPath, finalPath);
}

/** Read a run snapshot. Returns null when missing or unparsable. */
export function readRun(workspaceRootPath: string, runId: string): WorkflowRunSnapshot | null {
  const file = getRunFile(workspaceRootPath, runId);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as WorkflowRunSnapshot;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.id !== 'string') return null;
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
  const dir = getRunDir(workspaceRootPath, runId);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}
