/**
 * Tasks Config Path Resolver & Migration
 *
 * Resolves the correct config file path (tasks.json or hooks.json fallback)
 * and provides one-time migration from hooks.json → tasks.json.
 */

import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

/**
 * Generate a short 6-character hex ID for matcher identification.
 * Uses crypto.randomBytes for uniqueness (24 bits of entropy = 16M possibilities).
 */
export function generateShortId(): string {
  return randomBytes(3).toString('hex');
}

/**
 * Resolve the tasks config path for a workspace.
 * Prefers tasks.json, falls back to hooks.json, defaults to tasks.json for new files.
 */
export function resolveTasksConfigPath(workspaceRoot: string): string {
  const tasksPath = join(workspaceRoot, 'tasks.json');
  if (existsSync(tasksPath)) return tasksPath;
  const hooksPath = join(workspaceRoot, 'hooks.json');
  if (existsSync(hooksPath)) return hooksPath;
  return tasksPath; // default for new files
}

/**
 * Migrate hooks.json → tasks.json if needed.
 *
 * Rewrites:
 * - Top-level "hooks" key → "tasks"
 * - Inner matcher "hooks" arrays → "actions"
 * - Sets version to 2
 *
 * Creates hooks.json.old as backup.
 * No-op if tasks.json already exists or hooks.json doesn't exist.
 *
 * @returns true if migration was performed, false otherwise
 */
export function migrateHooksToTasks(workspaceRoot: string): boolean {
  const tasksPath = join(workspaceRoot, 'tasks.json');
  const hooksPath = join(workspaceRoot, 'hooks.json');

  // Nothing to migrate
  if (existsSync(tasksPath) || !existsSync(hooksPath)) {
    return false;
  }

  try {
    const raw = readFileSync(hooksPath, 'utf-8');
    const config = JSON.parse(raw);

    // Rewrite top-level "hooks" → "tasks"
    const hooks = config.hooks ?? config.tasks ?? {};
    delete config.hooks;

    // Rewrite inner "hooks" arrays → "actions" in each matcher
    const tasks: Record<string, unknown[]> = {};
    for (const [event, matchers] of Object.entries(hooks)) {
      if (!Array.isArray(matchers)) continue;
      tasks[event] = matchers.map((matcher: Record<string, unknown>) => {
        const { hooks: innerHooks, actions: innerActions, ...rest } = matcher;
        return { id: generateShortId(), ...rest, actions: innerActions ?? innerHooks ?? [] };
      });
    }

    config.tasks = tasks;
    config.version = 2;

    // Write tasks.json first (atomic: if this fails, nothing changes)
    writeFileSync(tasksPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');

    // Rename hooks.json → hooks.json.old (backup)
    const backupPath = join(workspaceRoot, 'hooks.json.old');
    renameSync(hooksPath, backupPath);

    console.warn('[tasks] Migrated hooks.json → tasks.json (backup at hooks.json.old)');
    return true;
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Unknown error';
    console.warn('[tasks] Migration failed, keeping hooks.json:', error);
    // Clean up partial tasks.json if it was written
    try {
      if (existsSync(tasksPath) && existsSync(hooksPath)) {
        // Both exist means write succeeded but rename failed — remove the new file
        const { unlinkSync } = require('node:fs');
        unlinkSync(tasksPath);
      }
    } catch {
      // ignore cleanup errors
    }
    return false;
  }
}
