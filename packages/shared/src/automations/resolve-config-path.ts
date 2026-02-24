/**
 * Automations Config Path Resolver & Migration
 *
 * Resolves the correct config file path (automations.json, with tasks.json/hooks.json fallback)
 * and provides one-time migration from hooks.json → automations.json.
 *
 * Config file lineage: hooks.json (v1) → tasks.json (v2, never released) → automations.json (v2)
 */

import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { AUTOMATIONS_CONFIG_FILE, LEGACY_CONFIG_FILES } from './constants.ts';

/**
 * Generate a short 6-character hex ID for matcher identification.
 * Uses crypto.randomBytes for uniqueness (24 bits of entropy = 16M possibilities).
 */
export function generateShortId(): string {
  return randomBytes(3).toString('hex');
}

interface ConfigInspection {
  exists: boolean;
  valid: boolean;
  nonEmpty: boolean;
  parsed?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasAnyMatchers(eventMap: unknown): boolean {
  if (!isRecord(eventMap)) return false;
  return Object.values(eventMap).some(
    (matchers) => Array.isArray(matchers) && matchers.length > 0
  );
}

function inspectConfig(path: string): ConfigInspection {
  if (!existsSync(path)) {
    return { exists: false, valid: false, nonEmpty: false };
  }

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    if (!isRecord(parsed)) {
      return { exists: true, valid: false, nonEmpty: false };
    }

    const eventMap = parsed.automations ?? parsed.tasks ?? parsed.hooks;
    return {
      exists: true,
      valid: true,
      nonEmpty: hasAnyMatchers(eventMap),
      parsed,
    };
  } catch {
    return { exists: true, valid: false, nonEmpty: false };
  }
}

function getUniqueBackupPath(basePath: string): string {
  if (!existsSync(basePath)) return basePath;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${basePath}.${timestamp}`;
}

function toAutomationsConfig(sourceConfig: Record<string, unknown>): Record<string, unknown> {
  const config = { ...sourceConfig };

  // Rewrite top-level "hooks"/"tasks" → "automations"
  const eventMap = isRecord(config.automations) ? config.automations : (isRecord(config.tasks) ? config.tasks : (isRecord(config.hooks) ? config.hooks : {}));
  delete config.hooks;
  delete config.tasks;

  // Rewrite inner "hooks" arrays → "actions" in each matcher
  const automations: Record<string, unknown[]> = {};
  for (const [event, matchers] of Object.entries(eventMap)) {
    if (!Array.isArray(matchers)) continue;
    automations[event] = matchers.map((matcher: unknown) => {
      const matcherObj = isRecord(matcher) ? matcher : {};
      const { hooks: innerHooks, actions: innerActions, id, ...rest } = matcherObj;
      const matcherId = typeof id === 'string' && id.length > 0 ? id : generateShortId();
      return { id: matcherId, ...rest, actions: innerActions ?? innerHooks ?? [] };
    });
  }

  config.automations = automations;
  config.version = 2;
  return config;
}

/**
 * Resolve the automations config path for a workspace.
 * Prefers automations.json, falls back to tasks.json or hooks.json if they contain valid data.
 */
export function resolveAutomationsConfigPath(workspaceRoot: string): string {
  const automationsPath = join(workspaceRoot, AUTOMATIONS_CONFIG_FILE);
  const tasksPath = join(workspaceRoot, LEGACY_CONFIG_FILES[0]);
  const hooksPath = join(workspaceRoot, LEGACY_CONFIG_FILES[1]);

  const automationsInfo = inspectConfig(automationsPath);

  // If automations.json exists and is valid+non-empty, use it
  if (automationsInfo.exists && automationsInfo.valid && automationsInfo.nonEmpty) return automationsPath;

  // Fall back to tasks.json (dev-only, never released) if it has valid data
  const tasksInfo = inspectConfig(tasksPath);
  if (tasksInfo.exists && tasksInfo.valid && tasksInfo.nonEmpty) {
    console.warn(
      '[automations] Found tasks.json with valid data; it will be migrated to automations.json on load.'
    );
    return tasksPath;
  }

  // Fall back to hooks.json (v1) if it has valid data
  const hooksInfo = inspectConfig(hooksPath);
  if (hooksInfo.exists && hooksInfo.valid && hooksInfo.nonEmpty) {
    console.warn(
      '[automations] Found hooks.json with valid data; it will be migrated to automations.json on load.'
    );
    return hooksPath;
  }

  // Default — automations.json for new files
  if (automationsInfo.exists) return automationsPath;
  return automationsPath;
}

/**
 * Migrate hooks.json or tasks.json → automations.json if needed.
 *
 * Rewrites:
 * - Top-level "hooks"/"tasks" key → "automations"
 * - Inner matcher "hooks" arrays → "actions"
 * - Sets version to 2
 *
 * Creates source.json.old as backup.
 * No-op if automations.json already exists with valid data.
 *
 * @returns true if migration was performed, false otherwise
 */
export function migrateHooksToAutomations(workspaceRoot: string): boolean {
  const automationsPath = join(workspaceRoot, AUTOMATIONS_CONFIG_FILE);
  const automationsInfo = inspectConfig(automationsPath);

  // If automations.json already exists and has valid data, no migration needed
  if (automationsInfo.exists && automationsInfo.valid && automationsInfo.nonEmpty) return false;

  // Try to migrate from legacy config files (tasks.json, hooks.json)
  const sources = LEGACY_CONFIG_FILES.map(name => ({
    path: join(workspaceRoot, name),
    name,
  }));

  for (const source of sources) {
    const sourceInfo = inspectConfig(source.path);
    if (!sourceInfo.exists) continue;
    if (!sourceInfo.valid || !sourceInfo.parsed) {
      console.warn(`[automations] Migration skipped: ${source.name} exists but is invalid JSON`);
      continue;
    }
    if (!sourceInfo.nonEmpty) continue;

    try {
      const config = toAutomationsConfig(sourceInfo.parsed);

      // Write canonical automations.json
      writeFileSync(automationsPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');

      // Rename source → source.old (with timestamp fallback if needed)
      const backupPath = getUniqueBackupPath(join(workspaceRoot, `${source.name}.old`));
      renameSync(source.path, backupPath);

      console.warn(`[automations] Migrated ${source.name} → automations.json (backup at ${backupPath})`);
      return true;
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      console.warn(`[automations] Migration from ${source.name} failed; keeping existing files as-is:`, error);
      return false;
    }
  }

  return false;
}
