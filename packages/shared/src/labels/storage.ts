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
 * Starter set organized into color families:
 * - Development (blue): Code, Bug, Automation
 * - Content (purple): Writing, Research, Design
 * - Marketing (rose/orange): Sales, New Contracts, Outreach, Responses
 * - Product (teal/emerald): Discovery, Specs, Launch, Feedback
 * Plus flat valued labels: Priority (number), Project (string)
 *
 * Children use hue-shifted shades of their parent color to show visual hierarchy.
 * English names are stable seed ids; UI localizes via label.default.* when unchanged.
 */
export function getDefaultLabelConfig(): WorkspaceLabelConfig {
  return {
    version: 1,
    labels: [
      {
        id: 'development',
        name: 'Development',
        color: { light: '#3B82F6', dark: '#60A5FA' },
        children: [
          {
            id: 'code',
            name: 'Code',
            color: { light: '#4F46E5', dark: '#818CF8' }, // indigo shift
          },
          {
            id: 'bug',
            name: 'Bug',
            color: { light: '#0EA5E9', dark: '#38BDF8' }, // sky shift
          },
          {
            id: 'automation',
            name: 'Automation',
            color: { light: '#06B6D4', dark: '#22D3EE' }, // cyan shift
          },
        ],
      },
      {
        id: 'content',
        name: 'Content',
        color: { light: '#8B5CF6', dark: '#A78BFA' },
        children: [
          {
            id: 'writing',
            name: 'Writing',
            color: { light: '#7C3AED', dark: '#C4B5FD' }, // deeper violet
          },
          {
            id: 'research',
            name: 'Research',
            color: { light: '#A855F7', dark: '#C084FC' }, // lighter purple
          },
          {
            id: 'design',
            name: 'Design',
            color: { light: '#D946EF', dark: '#E879F9' }, // fuchsia shift
          },
        ],
      },
      {
        id: 'marketing',
        name: 'Marketing',
        color: { light: '#F43F5E', dark: '#FB7185' }, // rose
        children: [
          {
            id: 'sales',
            name: 'Sales',
            color: { light: '#E11D48', dark: '#FB7185' },
          },
          {
            id: 'new-contracts',
            name: 'New Contracts',
            color: { light: '#F97316', dark: '#FB923C' }, // orange
          },
          {
            id: 'outreach',
            name: 'Outreach',
            color: { light: '#EA580C', dark: '#FDBA74' },
          },
          {
            id: 'responses',
            name: 'Responses',
            color: { light: '#FB7185', dark: '#FDA4AF' },
          },
        ],
      },
      {
        id: 'product',
        name: 'Product',
        color: { light: '#14B8A6', dark: '#2DD4BF' }, // teal
        children: [
          {
            id: 'discovery',
            name: 'Discovery',
            color: { light: '#0D9488', dark: '#5EEAD4' },
          },
          {
            id: 'specs',
            name: 'Specs',
            color: { light: '#10B981', dark: '#34D399' }, // emerald
          },
          {
            id: 'launch',
            name: 'Launch',
            color: { light: '#059669', dark: '#6EE7B7' },
          },
          {
            id: 'feedback',
            name: 'Feedback',
            color: { light: '#34D399', dark: '#A7F3D0' },
          },
        ],
      },
      {
        id: 'priority',
        name: 'Priority',
        color: { light: '#F59E0B', dark: '#FBBF24' },
        valueType: 'number',
      },
      {
        id: 'project',
        name: 'Project',
        color: 'foreground/50',
        valueType: 'string',
      },
    ],
  };
}

/**
 * Insert any missing stock default labels (e.g. marketing/product groups added in P2)
 * without clobbering user-authored labels or reordering customs.
 * Returns true when the config was mutated.
 *
 * Strategy:
 * - Skip root insertion when the tree has no stock *group* roots yet
 *   (empty wipe, pure custom tree, or only valued leaves like priority).
 * - For each stock root: if missing, insert near its stock neighbors among roots.
 * - For each stock child under a stock parent that already exists: if missing as a
 *   child of that parent AND not already present elsewhere in the tree, append under parent.
 * - Never overwrite existing names/colors/structure for ids that already exist.
 */
export function ensureStockDefaultLabels(config: WorkspaceLabelConfig): boolean {
  const defaults = getDefaultLabelConfig().labels;
  // Group roots indicate a stock-seeded tree. Valued leaves (priority/project) alone
  // must not trigger full re-seed when a test/user only created one label.
  const groupStockRootIds = new Set(
    defaults.filter((l) => (l.children?.length ?? 0) > 0).map((l) => l.id),
  );
  const existingIds = new Set(flattenLabels(config.labels).map((l) => l.id));
  const hasGroupStockRoot = config.labels.some((l) => groupStockRootIds.has(l.id));

  let changed = false;
  const defaultRootOrder = defaults.map((l) => l.id);

  // 1) Ensure stock root groups exist — only when the tree already has a group root
  if (hasGroupStockRoot) {
    for (const stockRoot of defaults) {
      if (existingIds.has(stockRoot.id)) continue;

      // Place after nearest preceding stock root that already exists; else before nearest following; else append.
      const stockIdx = defaultRootOrder.indexOf(stockRoot.id);
      let insertAt = config.labels.length;
      for (let i = stockIdx - 1; i >= 0; i--) {
        const prevIdx = config.labels.findIndex((l) => l.id === defaultRootOrder[i]);
        if (prevIdx !== -1) {
          insertAt = prevIdx + 1;
          break;
        }
      }
      for (let i = stockIdx + 1; i < defaultRootOrder.length; i++) {
        const nextIdx = config.labels.findIndex((l) => l.id === defaultRootOrder[i]);
        if (nextIdx !== -1 && nextIdx < insertAt) {
          insertAt = nextIdx;
          break;
        }
      }

      // Deep-clone stock node so callers cannot mutate defaults
      const clone: LabelConfig = JSON.parse(JSON.stringify(stockRoot));
      config.labels.splice(insertAt, 0, clone);
      for (const id of flattenLabels([clone]).map((l) => l.id)) {
        existingIds.add(id);
      }
      changed = true;
    }
  }

  // 2) Ensure stock children exist under their stock parents (when parent already present)
  for (const stockRoot of defaults) {
    if (!stockRoot.children?.length) continue;
    const parent = findLabelById(config.labels, stockRoot.id);
    if (!parent) continue;

    if (!parent.children) parent.children = [];
    const childOrder = stockRoot.children.map((c) => c.id);

    for (const stockChild of stockRoot.children) {
      // Skip if id already exists anywhere (user may have moved/created it)
      if (existingIds.has(stockChild.id)) continue;

      const stockIdx = childOrder.indexOf(stockChild.id);
      let insertAt = parent.children.length;
      for (let i = stockIdx - 1; i >= 0; i--) {
        const prevIdx = parent.children.findIndex((c) => c.id === childOrder[i]);
        if (prevIdx !== -1) {
          insertAt = prevIdx + 1;
          break;
        }
      }
      for (let i = stockIdx + 1; i < childOrder.length; i++) {
        const nextIdx = parent.children.findIndex((c) => c.id === childOrder[i]);
        if (nextIdx !== -1 && nextIdx < insertAt) {
          insertAt = nextIdx;
          break;
        }
      }

      const clone: LabelConfig = JSON.parse(JSON.stringify(stockChild));
      parent.children.splice(insertAt, 0, clone);
      existingIds.add(clone.id);
      changed = true;
    }
  }

  return changed;
}

/**
 * Load workspace label configuration.
 * Returns empty config if no file exists or parsing fails.
 * Auto-migrates old Tailwind color format to EntityColor on first load.
 * Ensures newly seeded stock labels (e.g. marketing/product) exist.
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

    let dirty = false;

    // Seed any stock defaults missing from older workspace configs (P2: marketing/product).
    if (ensureStockDefaultLabels(config)) {
      dirty = true;
      debug('[loadLabelConfig] Inserted missing stock default labels');
    }

    // Auto-migrate old Tailwind class colors (e.g., "text-accent") to new EntityColor format.
    // If migration occurs, write the updated config back to disk.
    const migrated = migrateLabelColors(config);
    if (migrated) {
      dirty = true;
      debug('[loadLabelConfig] Migrated old color format');
    }

    if (dirty) {
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


