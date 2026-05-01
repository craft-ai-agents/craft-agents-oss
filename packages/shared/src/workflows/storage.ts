/**
 * Workflows — storage
 *
 * CRUD over the global workflow library (`~/.workflows/<slug>/WORKFLOW.md`)
 * plus the per-workspace activation manifest. Mirrors `agent-definitions/storage.ts`
 * — workflows are global like agents, not per-workspace like context docs.
 *
 * Validation runs inside `parseWorkflowFile` and a malformed/invalid file
 * returns `null` (the loader skips it). Validation rules per
 * `docs/workflows/01-spec.md`:
 *   - `name`, `description`, `steps` required
 *   - step `id` unique, slug-shaped
 *   - step `agent` slug-shaped (existence checked at run time)
 *   - templating refs only point at earlier steps and declared trigger inputs
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';
import { AGENT_SLUG_REGEX } from '../agent-definitions/types.ts';
import { getActivatedWorkflowsManifestPath } from '../workspaces/storage.ts';
import { isValidWorkflowOutputSchema } from './output-schema.ts';
import { validateTemplateReferences } from './template.ts';
import {
  WORKFLOW_FILE,
  WORKFLOW_SLUG_REGEX,
  type ActivatedWorkflowsManifest,
  type LoadedWorkflow,
  type WorkflowMetadata,
  type WorkflowParseWarning,
  type WorkflowStep,
  type WorkflowTrigger,
  type WorkflowTriggerInput,
} from './types.ts';

// ============================================================================
// Paths
// ============================================================================

/** Global workflow library directory: ~/.workflows/ */
export const GLOBAL_WORKFLOWS_DIR = join(homedir(), '.workflows');

const DELETED_WORKFLOWS_FILE = '.deleted-workflows.json';

export interface WorkflowStorageOptions {
  /** Test-only escape hatch; production callers should use the default. */
  globalWorkflowsDir?: string;
}

function getGlobalWorkflowsDir(options?: WorkflowStorageOptions): string {
  return options?.globalWorkflowsDir ?? GLOBAL_WORKFLOWS_DIR;
}

export function getGlobalWorkflowDir(slug: string, options?: WorkflowStorageOptions): string {
  return join(getGlobalWorkflowsDir(options), slug);
}

export function getGlobalWorkflowFile(slug: string, options?: WorkflowStorageOptions): string {
  return join(getGlobalWorkflowDir(slug, options), WORKFLOW_FILE);
}

export function isValidWorkflowSlug(slug: string): boolean {
  return WORKFLOW_SLUG_REGEX.test(slug);
}

// ============================================================================
// Tombstones
// ============================================================================

function getDeletedWorkflowsFile(options?: WorkflowStorageOptions): string {
  return join(getGlobalWorkflowsDir(options), DELETED_WORKFLOWS_FILE);
}

function readDeletedWorkflowSlugs(options?: WorkflowStorageOptions): Set<string> {
  const file = getDeletedWorkflowsFile(options);
  if (!existsSync(file)) return new Set();
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as { deleted?: unknown };
    if (!Array.isArray(parsed.deleted)) return new Set();
    return new Set(
      parsed.deleted.filter(
        (slug): slug is string => typeof slug === 'string' && isValidWorkflowSlug(slug),
      ),
    );
  } catch {
    return new Set();
  }
}

function rememberDeletedWorkflow(slug: string, options?: WorkflowStorageOptions): void {
  const deleted = readDeletedWorkflowSlugs(options);
  deleted.add(slug);
  writeFileSync(
    getDeletedWorkflowsFile(options),
    JSON.stringify(
      { version: 1, deleted: [...deleted].sort(), updatedAt: new Date().toISOString() },
      null,
      2,
    ) + '\n',
    'utf-8',
  );
}

function forgetDeletedWorkflow(slug: string, options?: WorkflowStorageOptions): void {
  const deleted = readDeletedWorkflowSlugs(options);
  if (!deleted.delete(slug)) return;
  writeFileSync(
    getDeletedWorkflowsFile(options),
    JSON.stringify(
      { version: 1, deleted: [...deleted].sort(), updatedAt: new Date().toISOString() },
      null,
      2,
    ) + '\n',
    'utf-8',
  );
}

// ============================================================================
// Parsing
// ============================================================================

const VALID_INPUT_TYPES: ReadonlyArray<WorkflowTriggerInput['type']> = ['string', 'number', 'boolean'];
const TRIGGER_INPUT_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

function warning(
  field: WorkflowParseWarning['field'],
  code: WorkflowParseWarning['code'],
  message: string,
): WorkflowParseWarning {
  return { field, code, message };
}

function coerceTriggerInputs(
  raw: unknown,
  warnings: WorkflowParseWarning[],
): WorkflowTriggerInput[] | undefined | null {
  if (raw == null) return undefined;
  if (!Array.isArray(raw)) {
    warnings.push(warning('trigger', 'invalid-trigger-inputs', 'trigger.inputs must be an array.'));
    return undefined;
  }
  const out: WorkflowTriggerInput[] = [];
  const seenNames = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const name = typeof e.name === 'string' ? e.name.trim() : '';
    if (!name) continue;
    if (!TRIGGER_INPUT_NAME_REGEX.test(name) || seenNames.has(name)) {
      return null;
    }
    seenNames.add(name);
    const type = typeof e.type === 'string' && (VALID_INPUT_TYPES as ReadonlyArray<string>).includes(e.type)
      ? (e.type as WorkflowTriggerInput['type'])
      : 'string';
    const input: WorkflowTriggerInput = { name, type };
    if (typeof e.required === 'boolean') input.required = e.required;
    if (e.default !== undefined) input.default = e.default;
    if (typeof e.description === 'string' && e.description.trim()) {
      input.description = e.description.trim();
    }
    out.push(input);
  }
  return out.length > 0 ? out : undefined;
}

function coerceTrigger(raw: unknown, warnings: WorkflowParseWarning[]): WorkflowTrigger | null {
  // Default: manual trigger with no inputs.
  if (raw == null) return { type: 'manual' };
  if (typeof raw !== 'object') {
    warnings.push(warning('trigger', 'invalid-trigger', 'trigger must be an object; defaulting to { type: manual }.'));
    return { type: 'manual' };
  }
  const r = raw as Record<string, unknown>;
  const typeRaw = typeof r.type === 'string' ? r.type.trim() : 'manual';
  if (typeRaw !== 'manual') {
    // Phase 1 only supports manual; warn but don't reject — forwards-compat
    // for files authored against later phases.
    warnings.push(warning('trigger', 'invalid-trigger', `trigger.type "${typeRaw}" is not supported in Phase 1; defaulting to manual.`));
  }
  const inputs = coerceTriggerInputs(r.inputs, warnings);
  if (inputs === null) return null;
  return inputs ? { type: 'manual', inputs } : { type: 'manual' };
}

interface RawStep {
  id?: unknown;
  agent?: unknown;
  input?: unknown;
  description?: unknown;
  outputSchema?: unknown;
  timeout?: unknown;
  retries?: unknown;
}

/**
 * Parse + validate a WORKFLOW.md file. Returns null when invalid (caller
 * treats null as "skip this entry").
 */
export function parseWorkflowFile(
  content: string,
): { metadata: WorkflowMetadata; body: string; warnings: WorkflowParseWarning[] } | null {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(content);
  } catch {
    return null;
  }

  const data = parsed.data as Record<string, unknown>;

  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const description = typeof data.description === 'string' ? data.description.trim() : '';
  if (!name || !description) return null;

  if (!Array.isArray(data.steps) || data.steps.length === 0) return null;

  const warnings: WorkflowParseWarning[] = [];
  const trigger = coerceTrigger(data.trigger, warnings);
  if (!trigger) return null;
  const triggerInputNames = (trigger.inputs ?? []).map((i) => i.name);

  const steps: WorkflowStep[] = [];
  const seenIds = new Set<string>();
  const previousIds: string[] = [];

  for (const rawStep of data.steps as RawStep[]) {
    if (!rawStep || typeof rawStep !== 'object') return null;
    const id = typeof rawStep.id === 'string' ? rawStep.id.trim() : '';
    const agent = typeof rawStep.agent === 'string' ? rawStep.agent.trim() : '';
    const input = typeof rawStep.input === 'string' ? rawStep.input : '';

    if (!id || !WORKFLOW_SLUG_REGEX.test(id)) return null;
    if (seenIds.has(id)) return null;
    if (!agent || !AGENT_SLUG_REGEX.test(agent)) return null;
    if (!input) return null;

    const refErrors = validateTemplateReferences(input, previousIds, triggerInputNames);
    if (refErrors.length > 0) return null;

    const step: WorkflowStep = { id, agent, input };
    if (typeof rawStep.description === 'string' && rawStep.description.trim()) {
      step.description = rawStep.description.trim();
    } else if (rawStep.description !== undefined && typeof rawStep.description !== 'string') {
      warnings.push(warning('step', 'invalid-step-description', `step "${id}" description must be a string.`));
    }

    if (rawStep.outputSchema !== undefined) {
      if (!isValidWorkflowOutputSchema(rawStep.outputSchema)) {
        warnings.push(warning('step', 'invalid-step-output-schema', `step "${id}" outputSchema must be a JSON Schema object with a type.`));
        return null;
      }
      step.outputSchema = rawStep.outputSchema;
    }

    if (rawStep.timeout !== undefined) {
      if (typeof rawStep.timeout !== 'number' || !Number.isFinite(rawStep.timeout) || rawStep.timeout <= 0) {
        warnings.push(warning('step', 'invalid-step-timeout', `step "${id}" timeout must be a positive number of seconds.`));
        return null;
      }
      step.timeout = rawStep.timeout;
    }

    if (rawStep.retries !== undefined) {
      if (typeof rawStep.retries !== 'number' || !Number.isInteger(rawStep.retries) || rawStep.retries < 0) {
        warnings.push(warning('step', 'invalid-step-retries', `step "${id}" retries must be a non-negative integer.`));
        return null;
      }
      step.retries = rawStep.retries;
    }

    steps.push(step);
    seenIds.add(id);
    previousIds.push(id);
  }

  const avatar = typeof data.avatar === 'string' ? data.avatar.trim() || undefined : undefined;
  if (data.avatar !== undefined && typeof data.avatar !== 'string') {
    warnings.push(warning('avatar', 'invalid-avatar', 'avatar must be a string.'));
  }

  const metadata: WorkflowMetadata = {
    name,
    description,
    avatar,
    trigger,
    steps,
  };

  return {
    metadata,
    body: parsed.content.trim(),
    warnings,
  };
}

/**
 * Serialize a workflow back to the WORKFLOW.md format. Round-trips faithfully
 * with `parseWorkflowFile`.
 */
export function serializeWorkflow(metadata: WorkflowMetadata, body: string): string {
  const data: Record<string, unknown> = {
    name: metadata.name,
    description: metadata.description,
  };
  if (metadata.avatar) data.avatar = metadata.avatar;

  const trigger: Record<string, unknown> = { type: metadata.trigger.type };
  if (metadata.trigger.inputs && metadata.trigger.inputs.length > 0) {
    trigger.inputs = metadata.trigger.inputs.map((i) => {
      const out: Record<string, unknown> = { name: i.name, type: i.type };
      if (i.required) out.required = true;
      if (i.default !== undefined) out.default = i.default;
      if (i.description) out.description = i.description;
      return out;
    });
  }
  data.trigger = trigger;

  data.steps = metadata.steps.map((s) => {
    const out: Record<string, unknown> = { id: s.id, agent: s.agent, input: s.input };
    if (s.description) out.description = s.description;
    if (s.outputSchema) out.outputSchema = s.outputSchema;
    if (s.timeout !== undefined) out.timeout = s.timeout;
    if (s.retries !== undefined) out.retries = s.retries;
    return out;
  });

  return matter.stringify(body.trimEnd() + '\n', data);
}

// ============================================================================
// Load
// ============================================================================

function loadWorkflowFromDir(dir: string, slug: string): LoadedWorkflow | null {
  const file = join(dir, WORKFLOW_FILE);
  if (!existsSync(file)) return null;
  let raw: string;
  try {
    raw = readFileSync(file, 'utf-8');
  } catch {
    return null;
  }
  const parsed = parseWorkflowFile(raw);
  if (!parsed) return null;
  return {
    slug,
    metadata: parsed.metadata,
    body: parsed.body,
    path: dir,
    source: 'global',
    parseWarnings: parsed.warnings.length > 0 ? parsed.warnings : undefined,
  };
}

export function loadAllGlobalWorkflows(options?: WorkflowStorageOptions): LoadedWorkflow[] {
  const root = getGlobalWorkflowsDir(options);
  if (!existsSync(root)) return [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: LoadedWorkflow[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!isValidWorkflowSlug(entry.name)) continue;
    const wf = loadWorkflowFromDir(join(root, entry.name), entry.name);
    if (wf) out.push(wf);
  }
  out.sort((a, b) => a.slug.localeCompare(b.slug));
  return out;
}

export function loadGlobalWorkflow(slug: string, options?: WorkflowStorageOptions): LoadedWorkflow | null {
  if (!isValidWorkflowSlug(slug)) return null;
  return loadWorkflowFromDir(getGlobalWorkflowDir(slug, options), slug);
}

// ============================================================================
// Activation manifest
// ============================================================================

export function readActivatedWorkflows(workspaceRootPath: string): ActivatedWorkflowsManifest {
  const path = getActivatedWorkflowsManifestPath(workspaceRootPath);
  if (!existsSync(path)) {
    return { version: 1, active: [], updatedAt: new Date(0).toISOString() };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<ActivatedWorkflowsManifest>;
    const active = Array.isArray(parsed.active)
      ? Array.from(new Set(parsed.active.filter((s): s is string => typeof s === 'string')))
      : [];
    return {
      version: 1,
      active,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return { version: 1, active: [], updatedAt: new Date(0).toISOString() };
  }
}

export function writeActivatedWorkflows(
  workspaceRootPath: string,
  slugs: string[],
): ActivatedWorkflowsManifest {
  const dedup = Array.from(new Set(slugs.filter(isValidWorkflowSlug)));
  const manifest: ActivatedWorkflowsManifest = {
    version: 1,
    active: dedup,
    updatedAt: new Date().toISOString(),
  };
  if (!existsSync(workspaceRootPath)) mkdirSync(workspaceRootPath, { recursive: true });
  writeFileSync(
    getActivatedWorkflowsManifestPath(workspaceRootPath),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf-8',
  );
  return manifest;
}

export function setWorkflowActive(
  workspaceRootPath: string,
  slug: string,
  active: boolean,
): ActivatedWorkflowsManifest {
  const current = readActivatedWorkflows(workspaceRootPath);
  const set = new Set(current.active);
  if (active) set.add(slug);
  else set.delete(slug);
  return writeActivatedWorkflows(workspaceRootPath, [...set]);
}

/**
 * Load the workflows currently activated in a workspace. Drops slugs whose
 * WORKFLOW.md no longer exists in the global library (silent self-heal).
 */
export function loadActivatedWorkflows(
  workspaceRootPath: string,
  options?: WorkflowStorageOptions,
): LoadedWorkflow[] {
  const manifest = readActivatedWorkflows(workspaceRootPath);
  const out: LoadedWorkflow[] = [];
  const retained: string[] = [];
  for (const slug of manifest.active) {
    const wf = loadGlobalWorkflow(slug, options);
    if (wf) {
      out.push(wf);
      retained.push(slug);
    }
  }
  if (retained.length !== manifest.active.length) {
    try {
      writeActivatedWorkflows(workspaceRootPath, retained);
    } catch {
      // Best-effort; stale entries get skipped on the next load.
    }
  }
  return out;
}

// ============================================================================
// Mutations on the global library
// ============================================================================

export interface CreateWorkflowInput {
  slug: string;
  metadata: WorkflowMetadata;
  body: string;
}

export function writeGlobalWorkflow(
  input: CreateWorkflowInput,
  options?: WorkflowStorageOptions,
): LoadedWorkflow {
  if (!isValidWorkflowSlug(input.slug)) {
    throw new Error(
      `Invalid workflow slug: "${input.slug}" (lowercase letters, digits, hyphens; 1-64 chars)`,
    );
  }
  const dir = getGlobalWorkflowDir(input.slug, options);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, WORKFLOW_FILE),
    serializeWorkflow(input.metadata, input.body),
    'utf-8',
  );
  forgetDeletedWorkflow(input.slug, options);

  const loaded = loadGlobalWorkflow(input.slug, options);
  if (!loaded) {
    throw new Error(`Failed to re-load workflow "${input.slug}" after write — likely failed validation`);
  }
  return loaded;
}

export function deleteGlobalWorkflow(
  slug: string,
  workspaceRootPaths: string[],
  options?: WorkflowStorageOptions,
): boolean {
  if (!isValidWorkflowSlug(slug)) return false;
  const dir = getGlobalWorkflowDir(slug, options);
  if (!existsSync(dir)) return false;

  rmSync(dir, { recursive: true, force: true });
  rememberDeletedWorkflow(slug, options);

  for (const wsRoot of workspaceRootPaths) {
    try {
      setWorkflowActive(wsRoot, slug, false);
    } catch {
      // Ignore — non-existent workspace dir, etc.
    }
  }
  return true;
}

// ============================================================================
// First-run seeding
// ============================================================================

/**
 * Seed the global library on first run. Idempotent: existing files are NEVER
 * overwritten. The `.seeded` marker prevents recreating user-deleted starters.
 */
export function seedGlobalWorkflowLibraryIfEmpty(
  starters: ReadonlyArray<{ slug: string; metadata: WorkflowMetadata; body: string }>,
  options?: WorkflowStorageOptions,
): { seeded: number } {
  const root = getGlobalWorkflowsDir(options);
  mkdirSync(root, { recursive: true });
  const marker = join(root, '.seeded');
  if (existsSync(marker)) return { seeded: 0 };

  let seeded = 0;
  for (const starter of starters) {
    if (!isValidWorkflowSlug(starter.slug)) continue;
    const dir = getGlobalWorkflowDir(starter.slug, options);
    const file = join(dir, WORKFLOW_FILE);
    if (existsSync(file)) continue;
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, serializeWorkflow(starter.metadata, starter.body), 'utf-8');
    seeded += 1;
  }

  try {
    writeFileSync(marker, new Date().toISOString(), 'utf-8');
  } catch {
    // Marker is a hint; failing to write it just means seed will run again.
  }
  return { seeded };
}

/**
 * Ensure required workflows exist on every startup. Honors tombstones so an
 * app-deleted workflow stays gone. Existing files are never overwritten.
 */
export function ensureRequiredWorkflows(
  required: ReadonlyArray<{ slug: string; metadata: WorkflowMetadata; body: string }>,
  options?: WorkflowStorageOptions,
): { ensured: number } {
  const root = getGlobalWorkflowsDir(options);
  mkdirSync(root, { recursive: true });
  let ensured = 0;
  const tombstoned = readDeletedWorkflowSlugs(options);
  for (const w of required) {
    if (!isValidWorkflowSlug(w.slug)) continue;
    if (tombstoned.has(w.slug)) continue;
    const dir = getGlobalWorkflowDir(w.slug, options);
    const file = join(dir, WORKFLOW_FILE);
    if (existsSync(file)) continue;
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, serializeWorkflow(w.metadata, w.body), 'utf-8');
    ensured += 1;
  }
  return { ensured };
}
