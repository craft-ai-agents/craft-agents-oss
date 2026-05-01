/**
 * Agent Definitions — storage
 *
 * CRUD over the global agent library (`~/.agents/agents/<slug>/AGENT.md`)
 * plus the per-workspace activation manifest.
 *
 * Architecture:
 *   - One canonical store: the global library. No tier-precedence games.
 *   - Each workspace has an `activated-agents.json` listing the slugs that
 *     are visible/usable from that workspace.
 *   - Creating an agent always writes to the global library and (by default)
 *     auto-activates it in the calling workspace.
 *
 * Why global by default (vs. skills which are per-workspace today): an
 * agent is a substantial bundle of curated config; users want to reuse them
 * everywhere. Per-workspace storage forces re-creation. Activation gives the
 * "visible subset per workspace" UX without duplicating files.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';
import type { PermissionMode } from '../agent/mode-types.ts';
import type { ThinkingLevel } from '../agent/thinking-levels.ts';
import { normalizeThinkingLevel, THINKING_LEVEL_IDS } from '../agent/thinking-levels.ts';
import {
  AGENT_SLUG_REGEX,
  type ActivatedAgentsManifest,
  type AgentDefinitionSource,
  type AgentMetadata,
  type AgentParseWarning,
  type LoadedAgent,
} from './types.ts';
import { getActivatedAgentsManifestPath } from '../workspaces/storage.ts';

// ============================================================================
// Paths
// ============================================================================

/** Global agent library directory: ~/.agents/agents/ */
export const GLOBAL_AGENTS_DIR = join(homedir(), '.agents', 'agents');

/** AGENT.md filename inside each agent directory. */
export const AGENT_FILE = 'AGENT.md';

const DELETED_AGENTS_FILE = '.deleted-agents.json';

export interface AgentStorageOptions {
  /** Test-only escape hatch; production callers should use the default global library. */
  globalAgentsDir?: string;
}

function getGlobalAgentsDir(options?: AgentStorageOptions): string {
  return options?.globalAgentsDir ?? GLOBAL_AGENTS_DIR;
}

/** Get the directory for a given slug inside the global library. */
export function getGlobalAgentDir(slug: string, options?: AgentStorageOptions): string {
  return join(getGlobalAgentsDir(options), slug);
}

/** Get the absolute path to an agent's AGENT.md file in the global library. */
export function getGlobalAgentFile(slug: string, options?: AgentStorageOptions): string {
  return join(getGlobalAgentDir(slug, options), AGENT_FILE);
}

// ============================================================================
// Slug validation
// ============================================================================

export function isValidAgentSlug(slug: string): boolean {
  return AGENT_SLUG_REGEX.test(slug);
}

function getDeletedAgentsFile(options?: AgentStorageOptions): string {
  return join(getGlobalAgentsDir(options), DELETED_AGENTS_FILE);
}

function readDeletedAgentSlugs(options?: AgentStorageOptions): Set<string> {
  const file = getDeletedAgentsFile(options);
  if (!existsSync(file)) return new Set();
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as { deleted?: unknown };
    if (!Array.isArray(parsed.deleted)) return new Set();
    return new Set(parsed.deleted.filter((slug): slug is string => typeof slug === 'string' && isValidAgentSlug(slug)));
  } catch {
    return new Set();
  }
}

function rememberDeletedAgent(slug: string, options?: AgentStorageOptions): void {
  const deleted = readDeletedAgentSlugs(options);
  deleted.add(slug);
  writeFileSync(
    getDeletedAgentsFile(options),
    JSON.stringify({ version: 1, deleted: [...deleted].sort(), updatedAt: new Date().toISOString() }, null, 2) + '\n',
    'utf-8',
  );
}

function forgetDeletedAgent(slug: string, options?: AgentStorageOptions): void {
  const deleted = readDeletedAgentSlugs(options);
  if (!deleted.delete(slug)) return;
  writeFileSync(
    getDeletedAgentsFile(options),
    JSON.stringify({ version: 1, deleted: [...deleted].sort(), updatedAt: new Date().toISOString() }, null, 2) + '\n',
    'utf-8',
  );
}

// ============================================================================
// Parsing
// ============================================================================

const VALID_PERMISSION_MODES: ReadonlyArray<PermissionMode> = ['safe', 'ask', 'allow-all'];

function warning(field: keyof AgentMetadata, code: AgentParseWarning['code'], message: string): AgentParseWarning {
  return { field, code, message };
}

function coerceStringArray(
  value: unknown,
  field: 'skills' | 'sources',
  warnings: AgentParseWarning[],
): string[] | undefined {
  if (typeof value === 'string') return [value.trim()].filter(Boolean);
  if (value == null) return undefined;
  if (!Array.isArray(value)) {
    warnings.push(warning(field, `invalid-${field}`, `${field} must be a string or an array of strings.`));
    return undefined;
  }
  const invalidCount = value.filter((entry) => typeof entry !== 'string').length;
  if (invalidCount > 0) {
    warnings.push(warning(field, `invalid-${field}`, `${field} contains ${invalidCount} non-string entr${invalidCount === 1 ? 'y' : 'ies'} that were ignored.`));
  }
  const cleaned = Array.from(
    new Set(
      value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
  return cleaned.length > 0 ? cleaned : undefined;
}

function coercePermissionMode(value: unknown, warnings: AgentParseWarning[]): PermissionMode | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'string' || !(VALID_PERMISSION_MODES as ReadonlyArray<string>).includes(value)) {
    warnings.push(warning('permissionMode', 'invalid-permission-mode', `permissionMode must be one of: ${VALID_PERMISSION_MODES.join(', ')}.`));
    return undefined;
  }
  return value as PermissionMode;
}

function coerceThinkingLevel(value: unknown, warnings: AgentParseWarning[]): ThinkingLevel | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'string') {
    warnings.push(warning('thinkingLevel', 'invalid-thinking-level', `thinkingLevel must be one of: ${THINKING_LEVEL_IDS.join(', ')}.`));
    return undefined;
  }
  if (!(THINKING_LEVEL_IDS as ReadonlyArray<string>).includes(value) && value !== 'think') {
    warnings.push(warning('thinkingLevel', 'invalid-thinking-level', `thinkingLevel must be one of: ${THINKING_LEVEL_IDS.join(', ')}.`));
    return undefined;
  }
  return normalizeThinkingLevel(value as ThinkingLevel | 'think');
}

/** Slug rules for capability tags: short, lowercase, hyphenable. Matches @-mention shape. */
const TAG_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const TAG_MAX_COUNT = 8;

function coerceTags(value: unknown, warnings: AgentParseWarning[]): string[] | undefined {
  if (value == null) return undefined;
  // Accept a comma-separated string for hand-written AGENT.md ergonomics.
  const candidates: unknown[] = typeof value === 'string'
    ? value.split(',')
    : Array.isArray(value)
      ? value
      : [];
  if (typeof value !== 'string' && !Array.isArray(value)) {
    warnings.push(warning('tags', 'invalid-tags', 'tags must be an array of short lowercase strings.'));
    return undefined;
  }
  let droppedShape = 0;
  const cleaned = Array.from(
    new Set(
      candidates
        .map((entry) => (typeof entry === 'string' ? entry.trim().toLowerCase() : null))
        .filter((entry): entry is string => {
          if (!entry) return false;
          if (TAG_REGEX.test(entry)) return true;
          droppedShape += 1;
          return false;
        }),
    ),
  );
  if (droppedShape > 0) {
    warnings.push(warning('tags', 'invalid-tags', `tags ignored ${droppedShape} entr${droppedShape === 1 ? 'y' : 'ies'} that didn't match the lowercase-hyphen shape.`));
  }
  if (cleaned.length === 0) return undefined;
  if (cleaned.length > TAG_MAX_COUNT) {
    warnings.push(warning('tags', 'invalid-tags', `tags trimmed to the first ${TAG_MAX_COUNT}.`));
    return cleaned.slice(0, TAG_MAX_COUNT);
  }
  return cleaned;
}

/**
 * Parse an AGENT.md file's contents. Returns null if the file is malformed
 * or missing required fields. Callers should treat null as "skip this entry"
 * rather than throwing — bad agents shouldn't crash the whole library load.
 */
export function parseAgentFile(content: string): { metadata: AgentMetadata; systemPrompt: string; warnings: AgentParseWarning[] } | null {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(content);
  } catch {
    return null;
  }

  const data = parsed.data as Record<string, unknown>;

  // Required: name, description
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const description = typeof data.description === 'string' ? data.description.trim() : '';
  if (!name || !description) return null;

  const warnings: AgentParseWarning[] = [];

  // Avatar: single emoji-ish string. We don't strictly enforce one grapheme
  // here — UI is forgiving. Strip whitespace.
  const avatar = typeof data.avatar === 'string' ? data.avatar.trim() : undefined;

  const metadata: AgentMetadata = {
    name,
    description,
    avatar: avatar || undefined,
    llmConnection: typeof data.llmConnection === 'string' ? data.llmConnection.trim() || undefined : undefined,
    model: typeof data.model === 'string' ? data.model.trim() || undefined : undefined,
    permissionMode: coercePermissionMode(data.permissionMode, warnings),
    thinkingLevel: coerceThinkingLevel(data.thinkingLevel, warnings),
    skills: coerceStringArray(data.skills, 'skills', warnings),
    sources: coerceStringArray(data.sources, 'sources', warnings),
    greeting: typeof data.greeting === 'string' ? data.greeting.trim() || undefined : undefined,
    inputs: typeof data.inputs === 'string' ? data.inputs.trim() || undefined : undefined,
    outputs: typeof data.outputs === 'string' ? data.outputs.trim() || undefined : undefined,
    tags: coerceTags(data.tags, warnings),
  };

  return {
    metadata,
    systemPrompt: parsed.content.trim(),
    warnings,
  };
}

// ============================================================================
// Load
// ============================================================================

/**
 * Load a single agent from a directory. Returns null if missing or malformed.
 */
function loadAgentFromDir(dir: string, slug: string, source: AgentDefinitionSource): LoadedAgent | null {
  const agentFile = join(dir, AGENT_FILE);
  if (!existsSync(agentFile)) return null;

  let content: string;
  try {
    content = readFileSync(agentFile, 'utf-8');
  } catch {
    return null;
  }

  const parsed = parseAgentFile(content);
  if (!parsed) return null;

  return {
    slug,
    metadata: parsed.metadata,
    systemPrompt: parsed.systemPrompt,
    path: dir,
    source,
    parseWarnings: parsed.warnings.length > 0 ? parsed.warnings : undefined,
  };
}

/** Load every agent in the global library. */
export function loadAllGlobalAgents(options?: AgentStorageOptions): LoadedAgent[] {
  const globalAgentsDir = getGlobalAgentsDir(options);
  if (!existsSync(globalAgentsDir)) return [];

  const out: LoadedAgent[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(globalAgentsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!isValidAgentSlug(entry.name)) continue;
    const agent = loadAgentFromDir(join(globalAgentsDir, entry.name), entry.name, 'global');
    if (agent) out.push(agent);
  }
  return out;
}

/** Load a single agent by slug from the global library. O(1) — only opens the slug's directory. */
export function loadGlobalAgent(slug: string, options?: AgentStorageOptions): LoadedAgent | null {
  if (!isValidAgentSlug(slug)) return null;
  return loadAgentFromDir(getGlobalAgentDir(slug, options), slug, 'global');
}

// ============================================================================
// Activation manifest
// ============================================================================

/**
 * Read a workspace's activation manifest. Returns an empty manifest if the
 * file is missing or malformed — never throws.
 */
export function readActivatedAgents(workspaceRootPath: string): ActivatedAgentsManifest {
  const path = getActivatedAgentsManifestPath(workspaceRootPath);
  if (!existsSync(path)) {
    return { version: 1, active: [], updatedAt: new Date(0).toISOString() };
  }
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<ActivatedAgentsManifest>;
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

/** Write a workspace's activation manifest. Creates the workspace dir if needed. */
export function writeActivatedAgents(workspaceRootPath: string, slugs: string[]): ActivatedAgentsManifest {
  const dedup = Array.from(new Set(slugs.filter(isValidAgentSlug)));
  const manifest: ActivatedAgentsManifest = {
    version: 1,
    active: dedup,
    updatedAt: new Date().toISOString(),
  };
  const path = getActivatedAgentsManifestPath(workspaceRootPath);
  if (!existsSync(workspaceRootPath)) mkdirSync(workspaceRootPath, { recursive: true });
  writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  return manifest;
}

/** Convenience: toggle a single slug's activation in a workspace. */
export function setAgentActive(workspaceRootPath: string, slug: string, active: boolean): ActivatedAgentsManifest {
  const current = readActivatedAgents(workspaceRootPath);
  const set = new Set(current.active);
  if (active) set.add(slug);
  else set.delete(slug);
  return writeActivatedAgents(workspaceRootPath, [...set]);
}

/**
 * Load the agents that are currently activated in a workspace.
 * Skips slugs whose AGENT.md no longer exists in the global library
 * (silent self-heal — a deleted-from-library agent is treated as inactive).
 */
export function loadActivatedAgents(workspaceRootPath: string, options?: AgentStorageOptions): LoadedAgent[] {
  const manifest = readActivatedAgents(workspaceRootPath);
  const out: LoadedAgent[] = [];
  const retained: string[] = [];
  for (const slug of manifest.active) {
    const agent = loadGlobalAgent(slug, options);
    if (agent) {
      out.push(agent);
      retained.push(slug);
    }
  }
  if (retained.length !== manifest.active.length) {
    try {
      writeActivatedAgents(workspaceRootPath, retained);
    } catch {
      // Loading must stay best-effort; stale entries will be skipped again later.
    }
  }
  return out;
}

// ============================================================================
// Mutations on the global library
// ============================================================================

/**
 * Serialize an agent back to the AGENT.md format. Used by create/update.
 *
 * Field order in the YAML is intentional: identifying fields first, then
 * runtime config, then component bundles. Easier to read in raw form.
 */
export function serializeAgent(metadata: AgentMetadata, systemPrompt: string): string {
  const data: Record<string, unknown> = {
    name: metadata.name,
    description: metadata.description,
  };
  if (metadata.avatar) data.avatar = metadata.avatar;
  if (metadata.llmConnection) data.llmConnection = metadata.llmConnection;
  if (metadata.model) data.model = metadata.model;
  if (metadata.permissionMode) data.permissionMode = metadata.permissionMode;
  if (metadata.thinkingLevel) data.thinkingLevel = metadata.thinkingLevel;
  if (metadata.skills?.length) data.skills = metadata.skills;
  if (metadata.sources?.length) data.sources = metadata.sources;
  if (metadata.greeting) data.greeting = metadata.greeting;
  if (metadata.inputs) data.inputs = metadata.inputs;
  if (metadata.outputs) data.outputs = metadata.outputs;
  if (metadata.tags?.length) data.tags = metadata.tags;

  return matter.stringify(systemPrompt.trimEnd() + '\n', data);
}

export interface CreateAgentInput {
  slug: string;
  metadata: AgentMetadata;
  systemPrompt: string;
}

/**
 * Create or overwrite an agent in the global library. Throws on invalid slug
 * or write failure. Returns the freshly-loaded agent.
 *
 * Caller is responsible for calling `setAgentActive(workspaceRoot, slug, true)`
 * if the new agent should immediately be visible in the calling workspace.
 */
export function writeGlobalAgent(input: CreateAgentInput, options?: AgentStorageOptions): LoadedAgent {
  if (!isValidAgentSlug(input.slug)) {
    throw new Error(`Invalid agent slug: "${input.slug}" (lowercase letters, digits, hyphens; 1-64 chars)`);
  }
  const dir = getGlobalAgentDir(input.slug, options);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, AGENT_FILE);
  writeFileSync(file, serializeAgent(input.metadata, input.systemPrompt), 'utf-8');
  forgetDeletedAgent(input.slug, options);

  const loaded = loadGlobalAgent(input.slug, options);
  if (!loaded) {
    // Should be unreachable — we just wrote a valid file.
    throw new Error(`Failed to re-load agent "${input.slug}" after write`);
  }
  return loaded;
}

/**
 * Delete an agent from the global library AND from every workspace's
 * activation manifest. The caller passes the list of workspace root paths
 * (the storage layer doesn't know about the workspace registry).
 */
export function deleteGlobalAgent(slug: string, workspaceRootPaths: string[], options?: AgentStorageOptions): boolean {
  if (!isValidAgentSlug(slug)) return false;
  const dir = getGlobalAgentDir(slug, options);
  if (!existsSync(dir)) return false;

  rmSync(dir, { recursive: true, force: true });
  rememberDeletedAgent(slug, options);

  // Self-heal each workspace's activation list. Errors per-workspace are
  // swallowed — a stale slug is harmless because loadActivatedAgents
  // silently drops missing-library entries.
  for (const wsRoot of workspaceRootPaths) {
    try {
      setAgentActive(wsRoot, slug, false);
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
 * Ensure a specific set of agent slugs exists in the global library, writing
 * any that are missing unless the user deleted that agent through the app.
 * Use this for "load-bearing" starter agents without making app deletes
 * temporary.
 *
 * Unlike seedGlobalLibraryIfEmpty, this runs on EVERY startup and ignores
 * the .seeded marker. Existing AGENT.md files are still never overwritten,
 * and app-deleted agents are remembered in `.deleted-agents.json` so they
 * are not recreated on the next startup.
 */
export function ensureRequiredAgents(
  required: ReadonlyArray<{ slug: string; metadata: AgentMetadata; systemPrompt: string }>,
  options?: AgentStorageOptions,
): { ensured: number } {
  const globalAgentsDir = getGlobalAgentsDir(options);
  mkdirSync(globalAgentsDir, { recursive: true });
  let ensured = 0;
  for (const a of required) {
    if (!isValidAgentSlug(a.slug)) continue;
    if (readDeletedAgentSlugs(options).has(a.slug)) continue;
    const dir = getGlobalAgentDir(a.slug, options);
    const file = join(dir, AGENT_FILE);
    if (existsSync(file)) continue;
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, serializeAgent(a.metadata, a.systemPrompt), 'utf-8');
    ensured += 1;
  }
  return { ensured };
}

/**
 * Seed the global library with starter agents on first run.
 *
 * Idempotent: existing AGENT.md files are NEVER overwritten. A user who
 * deletes a starter agent and doesn't want it back can simply leave it
 * deleted — the seeder won't recreate it.
 *
 * The "have we seeded?" marker is a hidden `.seeded` file inside the
 * library directory. Its presence prevents re-seeding even if the user
 * deletes every starter; lack of it triggers seeding once.
 */
export function seedGlobalLibraryIfEmpty(
  starters: ReadonlyArray<{ slug: string; metadata: AgentMetadata; systemPrompt: string }>,
  options?: AgentStorageOptions,
): { seeded: number } {
  const globalAgentsDir = getGlobalAgentsDir(options);
  mkdirSync(globalAgentsDir, { recursive: true });
  const marker = join(globalAgentsDir, '.seeded');
  if (existsSync(marker)) return { seeded: 0 };

  let seeded = 0;
  for (const starter of starters) {
    if (!isValidAgentSlug(starter.slug)) continue;
    const dir = getGlobalAgentDir(starter.slug, options);
    const file = join(dir, AGENT_FILE);
    if (existsSync(file)) continue; // never overwrite
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, serializeAgent(starter.metadata, starter.systemPrompt), 'utf-8');
    seeded += 1;
  }

  // Always write the marker, even if seeded === 0. The intent is "we've
  // been here before"; a deleted starter shouldn't get re-created.
  try {
    writeFileSync(marker, new Date().toISOString(), 'utf-8');
  } catch {
    // Marker is a hint; failing to write it just means seed will run again.
  }
  return { seeded };
}

/**
 * Ensure built-in agents (Concierge, Orchestrator) have the given skill slugs
 * in their `skills:` frontmatter. Used for one-time silent migration when new
 * load-bearing skills ship — users with existing AGENT.md files (which the
 * seeder doesn't overwrite) still get the new bundle without manual edits.
 *
 * No-op for slugs already present. Only mutates the two built-in slugs by name.
 * User-customized agents are deliberately untouched.
 */
export function ensureBuiltInAgentSkills(
  requiredSkills: ReadonlyArray<string>,
  options?: AgentStorageOptions,
): { updated: number } {
  const builtIns = ['concierge', 'orchestrator'];
  let updated = 0;
  for (const slug of builtIns) {
    const loaded = loadGlobalAgent(slug, options);
    if (!loaded) continue;
    const current = new Set(loaded.metadata.skills ?? []);
    const missing = requiredSkills.filter((s) => !current.has(s));
    if (missing.length === 0) continue;
    const next: AgentMetadata = {
      ...loaded.metadata,
      skills: [...(loaded.metadata.skills ?? []), ...missing],
    };
    try {
      writeGlobalAgent({ slug, metadata: next, systemPrompt: loaded.systemPrompt }, options);
      updated += 1;
    } catch {
      // Best-effort migration; loading must not fail because of a malformed write.
    }
  }
  return { updated };
}

// Re-export for convenience
export { statSync as _internalStatSync };
