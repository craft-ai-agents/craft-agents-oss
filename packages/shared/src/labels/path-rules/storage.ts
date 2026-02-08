/**
 * Path Rules Storage
 *
 * Load and save path rules configuration.
 * Stored at: ~/.craft-agent/workspaces/{workspaceId}/labels/path-rules.json
 */

import * as fs from 'fs';
import * as path from 'path';
import type { PathRulesConfig, PathRule } from './types.ts';

const PATH_RULES_FILENAME = 'path-rules.json';

/**
 * Get the path to the path-rules.json file for a workspace.
 */
export function getPathRulesPath(workspaceRootPath: string): string {
  return path.join(workspaceRootPath, 'labels', PATH_RULES_FILENAME);
}

/**
 * Create a default empty path rules config.
 */
function createDefaultConfig(): PathRulesConfig {
  return {
    version: 1,
    rules: [],
  };
}

/**
 * Validate a path rule has required fields.
 */
function isValidRule(rule: unknown): rule is PathRule {
  if (typeof rule !== 'object' || rule === null) return false;
  const r = rule as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.path === 'string' &&
    (r.match === 'exact' || r.match === 'prefix') &&
    typeof r.labelId === 'string'
  );
}

/**
 * Load path rules configuration from disk.
 * Returns default empty config if file doesn't exist or is invalid.
 */
export function loadPathRulesConfig(workspaceRootPath: string): PathRulesConfig {
  const configPath = getPathRulesPath(workspaceRootPath);

  try {
    if (!fs.existsSync(configPath)) {
      return createDefaultConfig();
    }

    const content = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(content);

    // Validate basic structure
    if (typeof parsed !== 'object' || parsed === null) {
      console.warn('[PathRules] Invalid config structure, using default');
      return createDefaultConfig();
    }

    // Validate and filter rules
    const rules: PathRule[] = [];
    if (Array.isArray(parsed.rules)) {
      for (const rule of parsed.rules) {
        if (isValidRule(rule)) {
          rules.push(rule);
        } else {
          console.warn('[PathRules] Skipping invalid rule:', rule);
        }
      }
    }

    return {
      version: 1,
      rules,
    };
  } catch (error) {
    console.warn('[PathRules] Failed to load config, using default:', error);
    return createDefaultConfig();
  }
}

/**
 * Save path rules configuration to disk.
 * Creates the labels directory if it doesn't exist.
 */
export function savePathRulesConfig(
  workspaceRootPath: string,
  config: PathRulesConfig
): void {
  const configPath = getPathRulesPath(workspaceRootPath);
  const labelsDir = path.dirname(configPath);

  // Ensure labels directory exists
  if (!fs.existsSync(labelsDir)) {
    fs.mkdirSync(labelsDir, { recursive: true });
  }

  const content = JSON.stringify(config, null, 2);
  fs.writeFileSync(configPath, content, 'utf-8');
}

/**
 * Generate a unique rule ID.
 */
export function generateRuleId(): string {
  return `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
