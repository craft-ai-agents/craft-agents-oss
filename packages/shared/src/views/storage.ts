/**
 * Views Storage
 *
 * Filesystem-based storage for workspace view configurations.
 * Views are stored at {workspaceRootPath}/views.json
 *
 * Views are dynamic, expression-based filters computed at runtime.
 * Session views are never persisted on sessions — purely runtime-evaluated.
 * Knowledge views (domain: 'knowledge') share the same file (schema v2).
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ViewConfig, ViewDomain } from './types.ts';
import { getDefaultKnowledgeViews, getDefaultViews } from './defaults.ts';
import { debug } from '../utils/debug.ts';
import { readJsonFileSync } from '../utils/files.ts';

const VIEWS_FILE = 'views.json';
const CURRENT_VERSION = 2;

/**
 * Views configuration file structure.
 */
export interface ViewsConfig {
  /** Schema version — 2 adds knowledge domain + knowledge defaults merge */
  version: number;
  /** Array of view definitions */
  views: ViewConfig[];
}

function viewDomain(view: ViewConfig): ViewDomain {
  return view.domain ?? 'sessions';
}

/**
 * Merge missing default knowledge views by id (never overwrite user entries).
 * Treats missing/1 version as all-session domain for back-compat.
 */
/**
 * P5 audit fix: early research-needs-review seeds used bare `workflow_status`
 * while mutation allowlist + kernel path require `knowledge-workflow_status`.
 * Rewrite known stock defaults in-place when they still carry the bare key so
 * existing workspaces pick up the aligned filter without manual re-seed.
 * User-edited expressions/filters on the same id are left alone when they no
 * longer match the bare-key stock shape.
 */
function migrateStockKnowledgeView(view: ViewConfig): ViewConfig {
  if (view.id !== 'research-needs-review' || view.domain !== 'knowledge') return view;
  const attrs = view.knowledgeFilter?.attributes;
  if (!attrs || !Object.prototype.hasOwnProperty.call(attrs, 'workflow_status')) return view;
  if (Object.prototype.hasOwnProperty.call(attrs, 'knowledge-workflow_status')) return view;
  const nextAttrs = { ...attrs };
  nextAttrs['knowledge-workflow_status'] = nextAttrs['workflow_status']!;
  delete nextAttrs['workflow_status'];
  const nextActions = (view.presetActions ?? []).map((a) =>
    a.type === 'set_attribute' && a.name === 'workflow_status'
      ? { ...a, name: 'knowledge-workflow_status' }
      : a,
  );
  return {
    ...view,
    knowledgeFilter: { ...view.knowledgeFilter!, attributes: nextAttrs },
    presetActions: nextActions.length ? nextActions : view.presetActions,
  };
}

export function ensureKnowledgeDefaults(config: ViewsConfig): ViewsConfig {
  const views = Array.isArray(config.views) ? [...config.views] : [];
  // v1 / missing version: treat every entry as sessions when domain absent
  const normalized = views.map((v) => {
    const withDomain = v.domain ? v : { ...v, domain: 'sessions' as const };
    return migrateStockKnowledgeView(withDomain);
  });
  const existingIds = new Set(normalized.map((v) => v.id));
  for (const def of getDefaultKnowledgeViews()) {
    if (!existingIds.has(def.id)) {
      normalized.push(def);
      existingIds.add(def.id);
    }
  }
  return {
    version: CURRENT_VERSION,
    views: normalized,
  };
}

/**
 * Load views configuration from workspace.
 * Returns default views if no file exists or parsing fails.
 * Also handles migration from old labels/config.json smartLabels key.
 * Merges getDefaultKnowledgeViews() that are missing by id (don't overwrite user).
 */
export function loadViewsConfig(workspaceRootPath: string): ViewsConfig {
  const configPath = join(workspaceRootPath, VIEWS_FILE);

  // If no views.json exists, check for legacy smartLabels in labels/config.json
  // and migrate them. Otherwise seed with defaults.
  if (!existsSync(configPath)) {
    const migrated = migrateFromSmartLabels(workspaceRootPath);
    if (migrated) {
      debug('[loadViewsConfig] Migrated from legacy smartLabels');
      const merged = ensureKnowledgeDefaults(migrated);
      if (merged.version !== migrated.version || merged.views.length !== migrated.views.length) {
        saveViewsConfig(workspaceRootPath, merged);
      }
      return merged;
    }

    // No legacy data — seed with session + knowledge defaults
    const defaults: ViewsConfig = {
      version: CURRENT_VERSION,
      views: [...getDefaultViews(), ...getDefaultKnowledgeViews()],
    };
    debug('[loadViewsConfig] No config found, seeding with default views');
    saveViewsConfig(workspaceRootPath, defaults);
    return defaults;
  }

  try {
    const raw = readJsonFileSync<ViewsConfig>(configPath);
    const version = typeof raw.version === 'number' ? raw.version : 1;
    const base: ViewsConfig = {
      version,
      views: Array.isArray(raw.views) ? raw.views : [],
    };
    const merged = ensureKnowledgeDefaults(base);
    // Persist upgrade to v2 when we added knowledge defaults or bumped version
    const needsWrite =
      merged.version !== base.version ||
      merged.views.length !== base.views.length ||
      base.version < CURRENT_VERSION;
    if (needsWrite) {
      saveViewsConfig(workspaceRootPath, merged);
    }
    return merged;
  } catch (error) {
    debug('[loadViewsConfig] Failed to parse config:', error);
    return {
      version: CURRENT_VERSION,
      views: [...getDefaultViews(), ...getDefaultKnowledgeViews()],
    };
  }
}

/**
 * Save views configuration to disk (always writes version 2).
 */
export function saveViewsConfig(
  workspaceRootPath: string,
  config: ViewsConfig
): void {
  const configPath = join(workspaceRootPath, VIEWS_FILE);
  const toWrite: ViewsConfig = {
    version: CURRENT_VERSION,
    views: config.views ?? [],
  };

  try {
    writeFileSync(configPath, JSON.stringify(toWrite, null, 2), 'utf-8');
  } catch (error) {
    debug('[saveViewsConfig] Failed to save config:', error);
    throw error;
  }
}

/**
 * List views for a workspace.
 * When domain is set, only views for that domain are returned
 * (missing domain treated as 'sessions').
 */
export function listViews(
  workspaceRootPath: string,
  domain?: ViewDomain,
): ViewConfig[] {
  const config = loadViewsConfig(workspaceRootPath);
  const views = config.views ?? [];
  if (!domain) return views;
  return views.filter((v) => viewDomain(v) === domain);
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
 * Migrate legacy smartLabels from labels/config.json to views.json.
 * Renames IDs from "smart-*" to "view-*" prefix.
 * Returns the migrated config if migration occurred, null otherwise.
 */
function migrateFromSmartLabels(workspaceRootPath: string): ViewsConfig | null {
  const labelsConfigPath = join(workspaceRootPath, 'labels', 'config.json');
  if (!existsSync(labelsConfigPath)) return null;

  try {
    const labelsConfig = readJsonFileSync<Record<string, any>>(labelsConfigPath);
    if (!labelsConfig.smartLabels || !Array.isArray(labelsConfig.smartLabels)) return null;

    // Migrate: rename IDs from smart-* to view-*
    const views: ViewConfig[] = labelsConfig.smartLabels.map((sl: any) => ({
      ...sl,
      domain: 'sessions' as const,
      id: sl.id?.startsWith('smart-') ? sl.id.replace('smart-', 'view-') : sl.id,
    }));

    const config: ViewsConfig = { version: CURRENT_VERSION, views };
    saveViewsConfig(workspaceRootPath, config);

    // Remove smartLabels from labels config to avoid confusion
    delete labelsConfig.smartLabels;
    writeFileSync(labelsConfigPath, JSON.stringify(labelsConfig, null, 2), 'utf-8');

    return config;
  } catch {
    return null;
  }
}
