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
import type {
  DeepResearchPlanPolicy,
  DeepResearchRunSnapshot,
  DeepResearchRunState,
  DeepResearchStepKind,
  DeepResearchStepState,
} from './types.ts';

const RUN_FILE = 'run.json';
const RUNS_DIR = 'deep-research-runs';
const RUN_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const RUN_STATES = new Set<DeepResearchRunState>([
  'created',
  'awaiting_plan_approval',
  'running',
  'interrupted',
  'succeeded',
  'failed',
  'cancelled',
]);

const PLAN_POLICIES = new Set<DeepResearchPlanPolicy>(['approve', 'auto']);
const STEP_KINDS = new Set<DeepResearchStepKind>(['research', 'analysis', 'synthesis']);
const STEP_STATES = new Set<DeepResearchStepState>(['queued', 'running', 'succeeded', 'failed', 'skipped']);

export function isValidDeepResearchRunId(runId: string): boolean {
  return RUN_ID_REGEX.test(runId);
}

export function assertValidDeepResearchRunId(runId: string): void {
  if (!isValidDeepResearchRunId(runId)) throw new Error(`Invalid deep research run id: ${runId}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isContainedPath(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function resolveRunDir(workspaceRootPath: string, runId: string): string | null {
  if (!isValidDeepResearchRunId(runId)) return null;
  const runsRoot = resolve(workspaceRootPath, RUNS_DIR);
  const runDir = resolve(runsRoot, runId);
  return isContainedPath(runsRoot, runDir) ? runDir : null;
}

function isDeepResearchRunSnapshot(value: unknown, expectedRunId: string): value is DeepResearchRunSnapshot {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== 1) return false;
  if (value.id !== expectedRunId || !isValidDeepResearchRunId(expectedRunId)) return false;
  if (typeof value.workspaceId !== 'string' || !value.workspaceId) return false;
  if (typeof value.title !== 'string' || !value.title) return false;
  if (typeof value.topic !== 'string' || !value.topic) return false;
  if (typeof value.state !== 'string' || !RUN_STATES.has(value.state as DeepResearchRunState)) return false;
  if (typeof value.planPolicy !== 'string' || !PLAN_POLICIES.has(value.planPolicy as DeepResearchPlanPolicy)) return false;
  if (typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') return false;

  const sourceReadiness = value.sourceReadiness;
  if (!isRecord(sourceReadiness)) return false;
  if (!isStringArray(sourceReadiness.requested)) return false;
  if (!isStringArray(sourceReadiness.usable)) return false;
  if (!isStringArray(sourceReadiness.missing)) return false;
  if (!isStringArray(sourceReadiness.unusable)) return false;

  const plan = value.plan;
  if (!isRecord(plan)) return false;
  if (typeof plan.id !== 'string' || !plan.id) return false;
  if (typeof plan.title !== 'string' || !plan.title) return false;
  if (typeof plan.objective !== 'string' || !plan.objective) return false;
  if (typeof plan.policy !== 'string' || !PLAN_POLICIES.has(plan.policy as DeepResearchPlanPolicy)) return false;
  if (plan.depth !== undefined && typeof plan.depth !== 'string') return false;
  if (plan.reportFormat !== undefined && typeof plan.reportFormat !== 'string') return false;
  if (plan.loopBudget !== undefined && !isRecord(plan.loopBudget)) return false;
  if (plan.sourceProfiles !== undefined && !Array.isArray(plan.sourceProfiles)) return false;
  if (!isStringArray(plan.requiredSourceSlugs)) return false;
  if (!isStringArray(plan.assumptions)) return false;
  if (!isStringArray(plan.riskNotes)) return false;
  if (typeof plan.createdAt !== 'string') return false;
  if (plan.approvedAt !== undefined && typeof plan.approvedAt !== 'string') return false;
  if (plan.revisionNotes !== undefined && !isStringArray(plan.revisionNotes)) return false;
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) return false;
  for (const step of plan.steps) {
    if (!isRecord(step)) return false;
    if (typeof step.id !== 'string' || !step.id) return false;
    if (typeof step.kind !== 'string' || !STEP_KINDS.has(step.kind as DeepResearchStepKind)) return false;
    if (typeof step.title !== 'string' || !step.title) return false;
    if (typeof step.instructions !== 'string' || !step.instructions) return false;
    if (!isStringArray(step.requiredSourceSlugs)) return false;
  }

  if (!Array.isArray(value.steps)) return false;
  for (const step of value.steps) {
    if (!isRecord(step)) return false;
    if (typeof step.id !== 'string' || !step.id) return false;
    if (typeof step.kind !== 'string' || !STEP_KINDS.has(step.kind as DeepResearchStepKind)) return false;
    if (typeof step.title !== 'string' || !step.title) return false;
    if (typeof step.state !== 'string' || !STEP_STATES.has(step.state as DeepResearchStepState)) return false;
    if (step.sessionId !== undefined && typeof step.sessionId !== 'string') return false;
    if (step.output !== undefined && typeof step.output !== 'string') return false;
    if (step.error !== undefined && typeof step.error !== 'string') return false;
  }

  if (!Array.isArray(value.events)) return false;
  for (const event of value.events) {
    if (!isRecord(event)) return false;
    if (typeof event.ts !== 'string' || typeof event.type !== 'string' || typeof event.message !== 'string') return false;
  }

  if (value.outputId !== undefined && typeof value.outputId !== 'string') return false;
  if (value.error !== undefined && typeof value.error !== 'string') return false;
  if (value.completedAt !== undefined && typeof value.completedAt !== 'string') return false;
  return true;
}

export function getDeepResearchRunsDir(workspaceRootPath: string): string {
  return join(workspaceRootPath, RUNS_DIR);
}

export function getDeepResearchRunDir(workspaceRootPath: string, runId: string): string {
  const dir = resolveRunDir(workspaceRootPath, runId);
  if (!dir) throw new Error(`Invalid deep research run id: ${runId}`);
  return dir;
}

export function getDeepResearchRunFile(workspaceRootPath: string, runId: string): string {
  return join(getDeepResearchRunDir(workspaceRootPath, runId), RUN_FILE);
}

export function writeDeepResearchRun(workspaceRootPath: string, run: DeepResearchRunSnapshot): void {
  const runId = run.id;
  if (!isDeepResearchRunSnapshot(run, runId)) {
    throw new Error(`Invalid deep research run snapshot: ${runId}`);
  }
  const dir = getDeepResearchRunDir(workspaceRootPath, runId);
  mkdirSync(dir, { recursive: true });
  const finalPath = join(dir, RUN_FILE);
  const tmpPath = `${finalPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(run, null, 2) + '\n', 'utf-8');
  renameSync(tmpPath, finalPath);
}

export function readDeepResearchRun(workspaceRootPath: string, runId: string): DeepResearchRunSnapshot | null {
  const dir = resolveRunDir(workspaceRootPath, runId);
  if (!dir) return null;
  const file = join(dir, RUN_FILE);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as unknown;
    return isDeepResearchRunSnapshot(parsed, runId) ? parsed : null;
  } catch {
    return null;
  }
}

export function listDeepResearchRuns(workspaceRootPath: string): DeepResearchRunSnapshot[] {
  const root = getDeepResearchRunsDir(workspaceRootPath);
  if (!existsSync(root)) return [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const runs: DeepResearchRunSnapshot[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const run = readDeepResearchRun(workspaceRootPath, entry.name);
    if (run) runs.push(run);
  }
  runs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return runs;
}

export function markRunningDeepResearchRunsInterrupted(
  workspaceRootPath: string,
  reason: string,
): DeepResearchRunSnapshot[] {
  const ts = new Date().toISOString();
  const interrupted: DeepResearchRunSnapshot[] = [];
  for (const run of listDeepResearchRuns(workspaceRootPath)) {
    if (run.state !== 'running') continue;
    run.state = 'interrupted';
    run.error = reason;
    run.updatedAt = ts;
    run.completedAt = ts;
    const runningStep = run.steps.find((step) => step.state === 'running');
    if (runningStep) {
      runningStep.state = 'failed';
      runningStep.error = reason;
      runningStep.completedAt = ts;
    }
    run.events.push({ ts, type: 'failed', message: reason });
    writeDeepResearchRun(workspaceRootPath, run);
    interrupted.push(run);
  }
  return interrupted;
}

export function deleteDeepResearchRun(workspaceRootPath: string, runId: string): boolean {
  const dir = resolveRunDir(workspaceRootPath, runId);
  if (!dir || !existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}
