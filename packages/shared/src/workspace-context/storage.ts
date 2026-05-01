/**
 * Workspace Context — storage
 *
 * CRUD over per-workspace context docs at:
 *   <workspaceRoot>/context/<slug>/CONTEXT.md
 *
 * Each doc is a small markdown file with YAML frontmatter declaring the
 * doc's name, description, routing (which agents see it), and whether
 * it is enabled. Body content is free-form markdown.
 *
 * The routing model has one hard-coded rule the loader enforces:
 * the Concierge agent always receives every enabled doc, regardless of
 * the doc's `agents:` frontmatter. This is intentional — narrowing the
 * Concierge would defeat its job. Documented at the call sites that
 * filter by agent (loadActiveContextDocsForAgent).
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { CONCIERGE_SLUG, AGENT_SLUG_REGEX } from '../agent-definitions/types.ts';
import {
  CONTEXT_DOC_SLUG_REGEX,
  CONTEXT_FILE,
  type ContextDocMetadata,
  type ContextDocParseWarning,
  type ContextDocRouting,
  type LoadedContextDoc,
} from './types.ts';

// ============================================================================
// Paths
// ============================================================================

/** Root context dir for a workspace. */
export function getWorkspaceContextDir(workspaceRootPath: string): string {
  return join(workspaceRootPath, 'context');
}

export function getContextDocDir(workspaceRootPath: string, slug: string): string {
  return join(getWorkspaceContextDir(workspaceRootPath), slug);
}

export function getContextDocFile(workspaceRootPath: string, slug: string): string {
  return join(getContextDocDir(workspaceRootPath, slug), CONTEXT_FILE);
}

export function isValidContextDocSlug(slug: string): boolean {
  return CONTEXT_DOC_SLUG_REGEX.test(slug);
}

// ============================================================================
// Parsing
// ============================================================================

function warning(
  field: keyof ContextDocMetadata,
  code: ContextDocParseWarning['code'],
  message: string,
): ContextDocParseWarning {
  return { field, code, message };
}

/**
 * Coerce the raw `agents` frontmatter value into a routing rule.
 *
 * Accepted shapes:
 *   - missing / null         → broadcast (default)
 *   - "all"                  → broadcast
 *   - string[] of slugs      → targeted
 *   - "a, b, c"              → targeted (comma-separated convenience)
 *   - empty list / "" / "[]" → broadcast (treated as "no narrowing intended")
 *
 * Invalid shapes produce a warning and fall back to broadcast — fail open
 * rather than silently hiding the doc from every agent.
 */
function coerceRouting(value: unknown, warnings: ContextDocParseWarning[]): ContextDocRouting {
  if (value == null) return { mode: 'broadcast' };
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed.toLowerCase() === 'all') return { mode: 'broadcast' };
    const parts = trimmed
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return finalizeAgents(parts, warnings);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return { mode: 'broadcast' };
    const parts: string[] = [];
    let dropped = 0;
    for (const entry of value) {
      if (typeof entry === 'string' && entry.trim()) parts.push(entry.trim());
      else dropped += 1;
    }
    if (dropped > 0) {
      warnings.push(
        warning('routing', 'invalid-agents', `agents ignored ${dropped} non-string entr${dropped === 1 ? 'y' : 'ies'}.`),
      );
    }
    return finalizeAgents(parts, warnings);
  }
  warnings.push(
    warning('routing', 'invalid-agents', 'agents must be "all", a list of slugs, or omitted (defaults to broadcast).'),
  );
  return { mode: 'broadcast' };
}

function finalizeAgents(parts: string[], warnings: ContextDocParseWarning[]): ContextDocRouting {
  const cleaned = Array.from(
    new Set(
      parts
        .map((s) => s.toLowerCase())
        .filter((s) => {
          if (AGENT_SLUG_REGEX.test(s)) return true;
          warnings.push(
            warning('routing', 'invalid-agents', `agents dropped "${s}" — not a valid agent slug.`),
          );
          return false;
        }),
    ),
  );
  if (cleaned.length === 0) return { mode: 'broadcast' };
  return { mode: 'targeted', agents: cleaned };
}

function coerceEnabled(value: unknown, warnings: ContextDocParseWarning[]): boolean {
  if (value == null) return true;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lc = value.trim().toLowerCase();
    if (lc === 'true' || lc === 'yes') return true;
    if (lc === 'false' || lc === 'no') return false;
  }
  warnings.push(warning('enabled', 'invalid-enabled', 'enabled must be true or false; defaulting to true.'));
  return true;
}

export function parseContextFile(
  content: string,
): { metadata: ContextDocMetadata; body: string; warnings: ContextDocParseWarning[] } | null {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(content);
  } catch {
    return null;
  }

  const data = parsed.data as Record<string, unknown>;

  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (!name) return null;

  const warnings: ContextDocParseWarning[] = [];
  const description =
    typeof data.description === 'string' ? data.description.trim() || undefined : undefined;
  const routing = coerceRouting(data.agents, warnings);
  const enabled = coerceEnabled(data.enabled, warnings);

  return {
    metadata: { name, description, routing, enabled },
    body: parsed.content.trim(),
    warnings,
  };
}

export function serializeContextDoc(metadata: ContextDocMetadata, body: string): string {
  const data: Record<string, unknown> = { name: metadata.name };
  if (metadata.description) data.description = metadata.description;
  // Always serialize routing explicitly — makes the file's intent self-evident.
  data.agents = metadata.routing.mode === 'broadcast' ? 'all' : metadata.routing.agents;
  // Only serialize enabled when false; default-true stays implicit and clean.
  if (!metadata.enabled) data.enabled = false;
  return matter.stringify(body.trimEnd() + '\n', data);
}

// ============================================================================
// Load
// ============================================================================

function loadDocFromDir(
  workspaceRootPath: string,
  dir: string,
  slug: string,
): LoadedContextDoc | null {
  const file = join(dir, CONTEXT_FILE);
  if (!existsSync(file)) return null;
  let raw: string;
  try {
    raw = readFileSync(file, 'utf-8');
  } catch {
    return null;
  }
  const parsed = parseContextFile(raw);
  if (!parsed) return null;
  return {
    slug,
    metadata: parsed.metadata,
    body: parsed.body,
    path: dir,
    workspaceRootPath,
    parseWarnings: parsed.warnings.length > 0 ? parsed.warnings : undefined,
  };
}

/** Load every context doc in a workspace, regardless of enabled/routing. */
export function loadAllContextDocs(workspaceRootPath: string): LoadedContextDoc[] {
  const root = getWorkspaceContextDir(workspaceRootPath);
  if (!existsSync(root)) return [];
  const out: LoadedContextDoc[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!isValidContextDocSlug(entry.name)) continue;
    const doc = loadDocFromDir(workspaceRootPath, join(root, entry.name), entry.name);
    if (doc) out.push(doc);
  }
  // Stable order by slug — caller can re-sort, but this is a sane default
  // for the picker UI and for prompt assembly.
  out.sort((a, b) => a.slug.localeCompare(b.slug));
  return out;
}

export function loadContextDoc(
  workspaceRootPath: string,
  slug: string,
): LoadedContextDoc | null {
  if (!isValidContextDocSlug(slug)) return null;
  return loadDocFromDir(
    workspaceRootPath,
    getContextDocDir(workspaceRootPath, slug),
    slug,
  );
}

/**
 * Return the docs that should be injected into a given agent's system prompt.
 *
 * Rules (applied in order):
 *   1. Skip disabled docs.
 *   2. The Concierge always receives every enabled doc — no narrowing.
 *   3. Broadcast docs are visible to every agent.
 *   4. Targeted docs are visible only to the named agents.
 *
 * Pass `agentSlug = null` for "ad-hoc / no specific agent" sessions —
 * those receive only broadcast docs. (User confirmed: ad-hoc sessions
 * inherit broadcast.)
 */
export function loadActiveContextDocsForAgent(
  workspaceRootPath: string,
  agentSlug: string | null,
): LoadedContextDoc[] {
  const normalizedAgentSlug = typeof agentSlug === 'string'
    ? agentSlug.trim().toLowerCase()
    : null;
  const all = loadAllContextDocs(workspaceRootPath).filter((d) => d.metadata.enabled);
  if (normalizedAgentSlug === CONCIERGE_SLUG) return all;
  return all.filter((doc) => {
    if (doc.metadata.routing.mode === 'broadcast') return true;
    if (normalizedAgentSlug == null) return false;
    return doc.metadata.routing.agents.includes(normalizedAgentSlug);
  });
}

// ============================================================================
// Mutations
// ============================================================================

export interface UpsertContextDocInput {
  slug: string;
  metadata: ContextDocMetadata;
  body: string;
}

export function upsertContextDoc(
  workspaceRootPath: string,
  input: UpsertContextDocInput,
): LoadedContextDoc {
  if (!isValidContextDocSlug(input.slug)) {
    throw new Error(
      `Invalid context doc slug: "${input.slug}" (lowercase letters, digits, hyphens; 1-64 chars)`,
    );
  }
  if (!input.metadata.name.trim()) {
    throw new Error('Context doc name is required.');
  }
  const dir = getContextDocDir(workspaceRootPath, input.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, CONTEXT_FILE),
    serializeContextDoc(input.metadata, input.body),
    'utf-8',
  );
  const loaded = loadContextDoc(workspaceRootPath, input.slug);
  if (!loaded) throw new Error(`Failed to re-load context doc "${input.slug}" after write`);
  return loaded;
}

export function deleteContextDoc(workspaceRootPath: string, slug: string): boolean {
  if (!isValidContextDocSlug(slug)) return false;
  const dir = getContextDocDir(workspaceRootPath, slug);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}
