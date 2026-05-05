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
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getActivatedWorkflowsManifestPath } from '../workspaces/storage.ts';
import { parseWorkflowFile, serializeWorkflow } from './parser.ts';
import {
  WORKFLOW_FILE,
  WORKFLOW_SLUG_REGEX,
  type ActivatedWorkflowsManifest,
  type LoadedWorkflow,
  type WorkflowMetadata,
} from './types.ts';
import { debug } from '../utils/debug.ts';

export { parseWorkflowFile, serializeWorkflow } from './parser.ts';

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
  } catch (error) {
    debug(`[readActivatedWorkflows] malformed activation manifest at ${path}: ${error instanceof Error ? error.message : String(error)}`);
    try {
      const backup = `${path}.broken-${Date.now()}`;
      renameSync(path, backup);
      debug(`[readActivatedWorkflows] backed up to ${backup}`);
    } catch {
      // best-effort recovery; callers still get an empty manifest
    }
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
  const serialized = serializeWorkflow(input.metadata, input.body);
  if (!parseWorkflowFile(serialized)) {
    throw new Error(`Invalid workflow metadata for "${input.slug}"`);
  }
  const dir = getGlobalWorkflowDir(input.slug, options);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, WORKFLOW_FILE),
    serialized,
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
