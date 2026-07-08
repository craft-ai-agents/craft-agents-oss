/**
 * Task + run-state persistence.
 *
 * Layout under the workspace root (architecture §6, LOCKED #6):
 *   {workspaceRoot}/tasks/<slug>/task.yaml                    — the editable spec
 *   {workspaceRoot}/tasks/<slug>/runs/<runId>/run-log.jsonl   — append-only run log
 *   {workspaceRoot}/tasks/<slug>/runs/<runId>/nodes/<id>.json — per-node output
 *
 * The run log is the durability substrate: replaying it re-derives scheduling
 * decisions and reuses recorded node outputs (it never re-runs a node body).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { atomicWriteFileSync, stripBom } from '../utils/files.ts';
import { validateTaskInput } from './validate.ts';
import { TaskSpecSchema, type TaskSpec } from './schema.ts';
import type { NodeOutput } from './refs.ts';
import type { ValidationResult } from '../config/validators.ts';

const TASKS_DIR = 'tasks';
const TASK_FILE = 'task.yaml';
const RUNS_DIR = 'runs';
const RUN_LOG = 'run-log.jsonl';
const NODES_DIR = 'nodes';

// ---------------------------------------------------------------------------
// Run-state types
// ---------------------------------------------------------------------------

/** Per-node lifecycle state recorded in the run log. Richer than the board's SubtaskRunState. */
export type NodeRunState = 'pending' | 'running' | 'done' | 'failed' | 'cancelled' | 'skipped';

/** Append-only run-log event. `t` is an ISO-8601 timestamp. */
export type RunLogEntry =
  | { t: string; kind: 'run-started'; taskId: string; runId: string; orchestratorSessionId?: string }
  | { t: string; kind: 'node-scheduled'; nodeId: string }
  | { t: string; kind: 'node-spawned'; nodeId: string; sessionId: string }
  | { t: string; kind: 'node-finished'; nodeId: string; sessionId: string; state: NodeRunState; reason?: string }
  | { t: string; kind: 'node-retry'; nodeId: string; attempt: number; reason: string }
  | { t: string; kind: 'run-paused' | 'run-resumed' | 'run-stopped' | 'run-completed' | 'run-failed' | 'run-verifying' }
  | { t: string; kind: 'verdict'; result: 'pass' | 'fail' | 'unparsed'; reason?: string; nodes?: string[] }
  | { t: string; kind: 'budget-breach'; metric: 'tokens' | 'parallel' | 'iterations'; value: number; limit: number };

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function tasksRoot(workspaceRoot: string): string {
  return join(workspaceRoot, TASKS_DIR);
}
export function taskDir(workspaceRoot: string, slug: string): string {
  return join(workspaceRoot, TASKS_DIR, slug);
}
export function taskYamlPath(workspaceRoot: string, slug: string): string {
  return join(taskDir(workspaceRoot, slug), TASK_FILE);
}
export function runDir(workspaceRoot: string, slug: string, runId: string): string {
  return join(taskDir(workspaceRoot, slug), RUNS_DIR, runId);
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// task.yaml
// ---------------------------------------------------------------------------

/** Parse a task.yaml string → validated spec + issues. Does NOT throw on invalid specs. */
export function parseTaskYaml(yamlText: string): ValidationResult & { spec?: TaskSpec } {
  let raw: unknown;
  try {
    raw = parseYaml(stripBom(yamlText));
  } catch (e) {
    return {
      valid: false,
      errors: [{ file: TASK_FILE, path: 'root', message: `Invalid YAML: ${(e as Error).message}`, severity: 'error' }],
      warnings: [],
    };
  }
  return validateTaskInput(raw);
}

/** Serialize a spec to a task.yaml string. */
export function serializeTaskYaml(spec: TaskSpec): string {
  return stringifyYaml(spec);
}

/** Load + validate the task.yaml for a slug. Returns null if no file exists. */
export function loadTaskSpec(
  workspaceRoot: string,
  slug: string,
): (ValidationResult & { spec?: TaskSpec }) | null {
  const path = taskYamlPath(workspaceRoot, slug);
  if (!existsSync(path)) return null;
  return parseTaskYaml(readFileSync(path, 'utf-8'));
}

/** Write a spec to disk as task.yaml. Validates the shape first; throws on invalid. */
export function saveTaskSpec(workspaceRoot: string, spec: TaskSpec): void {
  const parsed = TaskSpecSchema.safeParse(spec);
  if (!parsed.success) {
    throw new Error(`Refusing to save invalid task spec: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  }
  ensureDir(taskDir(workspaceRoot, parsed.data.id));
  atomicWriteFileSync(taskYamlPath(workspaceRoot, parsed.data.id), serializeTaskYaml(parsed.data));
}

/** List task slugs (subdirectories of tasks/ that contain a task.yaml). */
export function listTaskSlugs(workspaceRoot: string): string[] {
  const root = tasksRoot(workspaceRoot);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, d.name, TASK_FILE)))
    .map((d) => d.name)
    .sort();
}

// ---------------------------------------------------------------------------
// Run log
// ---------------------------------------------------------------------------

/** Append one entry to the run log (creates the run dir on first write). */
export function appendRunLog(workspaceRoot: string, slug: string, runId: string, entry: RunLogEntry): void {
  const dir = runDir(workspaceRoot, slug, runId);
  ensureDir(dir);
  appendFileSync(join(dir, RUN_LOG), JSON.stringify(entry) + '\n', 'utf-8');
}

/** Read + parse the run log in append order. Skips malformed lines. */
export function readRunLog(workspaceRoot: string, slug: string, runId: string): RunLogEntry[] {
  const path = join(runDir(workspaceRoot, slug, runId), RUN_LOG);
  if (!existsSync(path)) return [];
  const out: RunLogEntry[] = [];
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as RunLogEntry);
    } catch {
      // skip a corrupt/partial line rather than failing the whole replay
    }
  }
  return out;
}

/** List run ids for a task (sorted lexicographically). */
export function listRunIds(workspaceRoot: string, slug: string): string[] {
  const runs = join(taskDir(workspaceRoot, slug), RUNS_DIR);
  if (!existsSync(runs)) return [];
  return readdirSync(runs, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

// ---------------------------------------------------------------------------
// Per-run spec snapshot
// ---------------------------------------------------------------------------

const RUN_SPEC = 'spec.json';

/**
 * Snapshot the spec a run executed against, so the Results view can label nodes by the titles
 * that were live *at run time* — not the current task.yaml, which may have been edited since
 * (renaming/removing nodes would otherwise mislabel or drop historical outputs).
 */
export function writeRunSpecSnapshot(workspaceRoot: string, slug: string, runId: string, spec: TaskSpec): void {
  const dir = runDir(workspaceRoot, slug, runId);
  ensureDir(dir);
  atomicWriteFileSync(join(dir, RUN_SPEC), JSON.stringify(spec, null, 2));
}

/** Read a run's spec snapshot. Returns null for older runs written before snapshots existed. */
export function readRunSpecSnapshot(workspaceRoot: string, slug: string, runId: string): TaskSpec | null {
  const path = join(runDir(workspaceRoot, slug, runId), RUN_SPEC);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as TaskSpec;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Per-node output
// ---------------------------------------------------------------------------

export function writeNodeOutput(
  workspaceRoot: string,
  slug: string,
  runId: string,
  nodeId: string,
  output: NodeOutput,
): void {
  const dir = join(runDir(workspaceRoot, slug, runId), NODES_DIR);
  ensureDir(dir);
  atomicWriteFileSync(join(dir, `${nodeId}.json`), JSON.stringify(output, null, 2));
}

export function readNodeOutput(
  workspaceRoot: string,
  slug: string,
  runId: string,
  nodeId: string,
): NodeOutput | null {
  const path = join(runDir(workspaceRoot, slug, runId), NODES_DIR, `${nodeId}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as NodeOutput;
  } catch {
    return null;
  }
}
