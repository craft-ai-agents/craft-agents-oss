/**
 * Label Storage
 *
 * Filesystem-based storage for workspace label configurations.
 * Labels are stored at {workspaceRootPath}/labels/config.json
 *
 * Hierarchy: Labels form a nested JSON tree. IDs are simple slugs.
 * New workspaces are seeded with default labels (Development + Content groups).
 * Labels are visual by color only (colored circles in the UI).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { WorkspaceLabelConfig, LabelConfig } from './types.ts';
import { flattenLabels, findLabelById } from './tree.ts';
import { readJsonFileSync } from '../utils/files.ts';
import { migrateLabelColors } from '../colors/migrate.ts';
import { debug } from '../utils/debug.ts';

const LABEL_CONFIG_DIR = 'labels';
const LABEL_CONFIG_FILE = 'labels/config.json';

/**
 * Get default label configuration.
 *
 * Procurement workflow task types. Each label carries an `autoRules` regex that
 * matches the distinctive phrase of the matching task-launcher message (see
 * apps/webui .../input/task-forms.ts `toMessage`), so a session is auto-classified
 * by task type the moment the user sends it — no manual tagging. The same rules
 * also catch hand-typed messages that use the same wording.
 *
 * Patterns are mutually exclusive across the five task messages:
 *   找料      "帮我找一下 X"                          → 帮我找一下 / 找料
 *   找替代料   "帮我找 X 的替代料"                      → 替代料
 *   型号比对   "需求型号 X，报价型号 Y，能不能替代…"     → 能不能替代
 *   补供应商   "帮我按 X 补几个供应商候选"              → 供应商候选
 *   生成单据   "把 X 这单按 Y 生成请款单（PI）"         → 生成请款单 / 生成单据
 */
export function getDefaultLabelConfig(): WorkspaceLabelConfig {
  return {
    version: 1,
    labels: [
      {
        id: 'find',
        name: '找料',
        color: { light: '#3B82F6', dark: '#60A5FA' }, // blue
        autoRules: [
          { pattern: '帮我找一下|找料', valueTemplate: '找料', description: '找料任务' },
        ],
      },
      {
        id: 'alternative',
        name: '替代料',
        color: { light: '#8B5CF6', dark: '#A78BFA' }, // purple
        autoRules: [
          { pattern: '替代料', valueTemplate: '替代料', description: '找替代料任务' },
        ],
      },
      {
        id: 'compare',
        name: '型号比对',
        color: { light: '#F59E0B', dark: '#FBBF24' }, // amber
        autoRules: [
          { pattern: '能不能替代|能否替代', valueTemplate: '型号比对', description: '能不能替任务' },
        ],
      },
      {
        id: 'supplier',
        name: '供应商',
        color: { light: '#14B8A6', dark: '#2DD4BF' }, // teal
        autoRules: [
          { pattern: '供应商候选|补.{0,6}供应商', valueTemplate: '供应商', description: '补供应商任务' },
        ],
      },
      {
        id: 'doc',
        name: '单据',
        color: { light: '#F43F5E', dark: '#FB7185' }, // rose
        autoRules: [
          { pattern: '生成请款单|生成单据|生成.{0,6}发票|开请款', valueTemplate: '单据', description: '生成单据任务' },
        ],
      },
    ],
  };
}

/**
 * Load workspace label configuration.
 * Returns empty config if no file exists or parsing fails.
 * Auto-migrates old Tailwind color format to EntityColor on first load.
 */
export function loadLabelConfig(workspaceRootPath: string): WorkspaceLabelConfig {
  const configPath = join(workspaceRootPath, LABEL_CONFIG_FILE);

  // If no config file exists, seed with defaults and persist to disk.
  // This ensures existing workspaces (created before default labels existed) get populated.
  if (!existsSync(configPath)) {
    const defaults = getDefaultLabelConfig();
    debug('[loadLabelConfig] No config found, seeding with default labels');
    saveLabelConfig(workspaceRootPath, defaults);
    return defaults;
  }

  try {
    const config = readJsonFileSync<WorkspaceLabelConfig>(configPath);

    // Auto-migrate old Tailwind class colors (e.g., "text-accent") to new EntityColor format.
    // If migration occurs, write the updated config back to disk.
    const migrated = migrateLabelColors(config);
    if (migrated) {
      debug('[loadLabelConfig] Migrated old color format, writing back');
      saveLabelConfig(workspaceRootPath, config);
    }

    return config;
  } catch (error) {
    debug('[loadLabelConfig] Failed to parse config:', error);
    return getDefaultLabelConfig();
  }
}

/**
 * Save workspace label configuration to disk.
 * Creates the labels directory if missing.
 */
export function saveLabelConfig(
  workspaceRootPath: string,
  config: WorkspaceLabelConfig
): void {
  const labelDir = join(workspaceRootPath, LABEL_CONFIG_DIR);
  const configPath = join(workspaceRootPath, LABEL_CONFIG_FILE);

  if (!existsSync(labelDir)) {
    mkdirSync(labelDir, { recursive: true });
  }

  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    debug('[saveLabelConfig] Failed to save config:', error);
    throw error;
  }
}

/**
 * Get the label tree (root-level labels with nested children).
 * Primary accessor for the UI — returns the tree structure as-is from config.
 */
export function listLabels(workspaceRootPath: string): LabelConfig[] {
  const config = loadLabelConfig(workspaceRootPath);
  return config.labels;
}

/**
 * Get all labels as a flat list (tree flattened depth-first).
 * Useful for lookups, session label validation, and non-hierarchical display.
 */
export function listLabelsFlat(workspaceRootPath: string): LabelConfig[] {
  const config = loadLabelConfig(workspaceRootPath);
  return flattenLabels(config.labels);
}

/**
 * Get a single label by ID (searches the entire tree).
 * Returns null if not found.
 */
export function getLabel(
  workspaceRootPath: string,
  labelId: string
): LabelConfig | null {
  const config = loadLabelConfig(workspaceRootPath);
  return findLabelById(config.labels, labelId) || null;
}

/**
 * Check if a label ID exists in this workspace (searches entire tree)
 */
export function isValidLabelId(
  workspaceRootPath: string,
  labelId: string
): boolean {
  const config = loadLabelConfig(workspaceRootPath);
  return !!findLabelById(config.labels, labelId);
}

/**
 * Validate label ID format.
 * Simple slug: lowercase alphanumeric + hyphens, no leading/trailing hyphens.
 * Examples: "bug", "frontend", "my-label"
 */
export function isValidLabelIdFormat(labelId: string): boolean {
  if (!labelId) return false;
  const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
  return SLUG_PATTERN.test(labelId);
}


