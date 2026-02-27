/**
 * Views Storage
 *
 * Filesystem-based storage for workspace view configurations.
 * Views are stored at {workspaceRootPath}/.craft-agent/views.json
 *
 * Views are dynamic, expression-based filters computed at runtime from session state.
 * They are never persisted on sessions — purely runtime-evaluated.
 */

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ViewConfig } from './types.ts';
import { getDefaultViews } from './defaults.ts';
import { debug } from '../utils/debug.ts';
import { readJsonFileSync } from '../utils/files.ts';
import { getWorkspaceStateDir } from '../workspaces/paths.ts';

const VIEWS_FILE = '.craft-agent/views.json';
const LEGACY_VIEWS_FILE = 'views.json';

/**
 * Views configuration file structure.
 */
export interface ViewsConfig {
  /** Schema version */
  version: number;
  /** Array of view definitions */
  views: ViewConfig[];
}

/**
 * Load views configuration from workspace.
 * Returns default views if no file exists or parsing fails.
 * Also handles migration from legacy labels/config.json smartLabels key.
 */
export function loadViewsConfig(workspaceRootPath: string): ViewsConfig {
  const configPath = join(workspaceRootPath, VIEWS_FILE);
  const legacyConfigPath = join(workspaceRootPath, LEGACY_VIEWS_FILE);

  if (!existsSync(configPath) && existsSync(legacyConfigPath)) {
    migrateLegacyViewsConfig(workspaceRootPath);
  }

  // If no .craft-agent/views.json exists, check for legacy smartLabels in labels/config.json
  // and migrate them. Otherwise seed with defaults.
  if (!existsSync(configPath)) {
    const migrated = migrateFromSmartLabels(workspaceRootPath);
    if (migrated) {
      debug('[loadViewsConfig] Migrated from legacy smartLabels');
      return migrated;
    }

    // No legacy data — seed with defaults
    const defaults: ViewsConfig = { version: 1, views: getDefaultViews() };
    debug('[loadViewsConfig] No config found, seeding with default views');
    saveViewsConfig(workspaceRootPath, defaults);
    return defaults;
  }

  try {
    const config = readJsonFileSync<ViewsConfig>(configPath);
    return config;
  } catch (error) {
    debug('[loadViewsConfig] Failed to parse config:', error);
    return { version: 1, views: getDefaultViews() };
  }
}

/**
 * Save views configuration to disk.
 */
export function saveViewsConfig(
  workspaceRootPath: string,
  config: ViewsConfig
): void {
  const configPath = join(workspaceRootPath, VIEWS_FILE);
  const stateDir = getWorkspaceStateDir(workspaceRootPath);

  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
  }

  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    debug('[saveViewsConfig] Failed to save config:', error);
    throw error;
  }
}

/**
 * List views for a workspace.
 * Returns the views array from config (seeded with defaults if missing).
 */
export function listViews(workspaceRootPath: string): ViewConfig[] {
  const config = loadViewsConfig(workspaceRootPath);
  return config.views ?? [];
}

/**
 * Save views to the workspace config.
 * Replaces the entire views array.
 */
export function saveViews(
  workspaceRootPath: string,
  views: ViewConfig[]
): void {
  const config = loadViewsConfig(workspaceRootPath);
  config.views = views;
  saveViewsConfig(workspaceRootPath, config);
}

/**
 * Migrate legacy smartLabels from labels/config.json to .craft-agent/views.json.
 * Renames IDs from "smart-*" to "view-*" prefix.
 * Returns the migrated config if migration occurred, null otherwise.
 */
function migrateFromSmartLabels(workspaceRootPath: string): ViewsConfig | null {
  const labelsConfigPath = join(workspaceRootPath, '.craft-agent', 'labels', 'config.json');
  const legacyLabelsConfigPath = join(workspaceRootPath, 'labels', 'config.json');
  const labelsPath = existsSync(labelsConfigPath) ? labelsConfigPath : legacyLabelsConfigPath;
  if (!existsSync(labelsPath)) return null;

  try {
    const labelsConfig = readJsonFileSync<Record<string, any>>(labelsPath);
    if (!labelsConfig.smartLabels || !Array.isArray(labelsConfig.smartLabels)) return null;

    // Migrate: rename IDs from smart-* to view-*
    const views: ViewConfig[] = labelsConfig.smartLabels.map((sl: any) => ({
      ...sl,
      id: sl.id?.startsWith('smart-') ? sl.id.replace('smart-', 'view-') : sl.id,
    }));

    const config: ViewsConfig = { version: 1, views };
    saveViewsConfig(workspaceRootPath, config);

    // Remove smartLabels from labels config to avoid confusion
    delete labelsConfig.smartLabels;
    writeFileSync(labelsPath, JSON.stringify(labelsConfig, null, 2), 'utf-8');

    return config;
  } catch {
    return null;
  }
}

function migrateLegacyViewsConfig(workspaceRootPath: string): void {
  const configPath = join(workspaceRootPath, VIEWS_FILE);
  const legacyConfigPath = join(workspaceRootPath, LEGACY_VIEWS_FILE);
  const stateDir = getWorkspaceStateDir(workspaceRootPath);

  if (!existsSync(legacyConfigPath) || existsSync(configPath)) return;

  if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
  copyFileSync(legacyConfigPath, configPath);
}
