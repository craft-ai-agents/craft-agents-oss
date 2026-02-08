/**
 * Path Rules Evaluator
 *
 * Core evaluation engine for path-based label rules.
 * Matches session workingDirectory against configured path rules
 * and returns labels to apply.
 *
 * Evaluation flow:
 * 1. Filter enabled rules only
 * 2. Normalize paths for cross-platform comparison
 * 3. Sort by path length (longest first) for deterministic matching
 * 4. Match each rule against workingDirectory
 * 5. Validate labelId exists in label tree
 * 6. Return deduplicated label entries
 */

import * as path from 'path';
import type { PathRule, PathRuleMatch, PathRulesConfig } from './types.ts';
import type { LabelConfig } from '../types.ts';

/**
 * Normalize a path for comparison.
 * Resolves to absolute path and normalizes separators.
 * On Windows, converts to lowercase for case-insensitive comparison.
 */
function normalizePath(inputPath: string): string {
  const normalized = path.normalize(path.resolve(inputPath));
  // Windows file system is case-insensitive
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/**
 * Check if workingDirectory matches a rule path.
 *
 * For 'exact' mode: paths must be exactly equal after normalization.
 * For 'prefix' mode: workingDirectory must be the rule path or a subdirectory.
 *
 * Uses path.relative() to avoid false positives like /a/b matching /a/b2.
 */
function matchesPath(
  rulePath: string,
  workingDirectory: string,
  mode: 'exact' | 'prefix'
): boolean {
  const normalizedRule = normalizePath(rulePath);
  const normalizedWorkDir = normalizePath(workingDirectory);

  if (mode === 'exact') {
    return normalizedRule === normalizedWorkDir;
  }

  // Prefix match: workingDirectory is the rule path or a subdirectory
  // path.relative returns:
  // - '' if paths are equal
  // - relative path without '..' if workDir is inside ruleDir
  // - path starting with '..' if workDir is outside ruleDir
  const rel = path.relative(normalizedRule, normalizedWorkDir);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Recursively find a label by ID in the label tree.
 */
function findLabelById(labels: LabelConfig[], labelId: string): LabelConfig | undefined {
  for (const label of labels) {
    if (label.id === labelId) {
      return label;
    }
    if (label.children) {
      const found = findLabelById(label.children, labelId);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Evaluate path rules against a session's workingDirectory.
 *
 * @param workingDirectory - The session's working directory (absolute path)
 * @param config - Path rules configuration
 * @param labels - Label tree for validation (optional, skips validation if not provided)
 * @returns Array of matches with label entries to apply
 */
export function evaluatePathRules(
  workingDirectory: string | undefined,
  config: PathRulesConfig,
  labels?: LabelConfig[]
): PathRuleMatch[] {
  if (!workingDirectory) {
    return [];
  }

  // Filter to enabled rules only
  const enabledRules = config.rules.filter(rule => rule.enabled !== false);

  // Sort by path length (longest first) for deterministic matching
  // Longer paths are more specific and should take precedence
  const sortedRules = [...enabledRules].sort((a, b) => b.path.length - a.path.length);

  const matches: PathRuleMatch[] = [];
  const seenLabelEntries = new Set<string>();

  for (const rule of sortedRules) {
    if (!matchesPath(rule.path, workingDirectory, rule.match)) {
      continue;
    }

    // Validate labelId exists in label tree if labels provided
    if (labels && !findLabelById(labels, rule.labelId)) {
      console.warn(
        `[PathRules] Rule "${rule.id}" references non-existent label "${rule.labelId}", skipping`
      );
      continue;
    }

    // Build label entry: bare id or "id::value"
    const labelEntry = rule.value ? `${rule.labelId}::${rule.value}` : rule.labelId;

    // Deduplicate: same label entry from multiple rules = keep first only
    if (seenLabelEntries.has(labelEntry)) {
      continue;
    }
    seenLabelEntries.add(labelEntry);

    matches.push({ rule, labelEntry });
  }

  return matches;
}

/**
 * Apply path rule matches to a session's labels array.
 * Only adds labels that don't already exist (additive, never removes).
 *
 * @param currentLabels - Current session labels (may be undefined)
 * @param matches - Path rule matches to apply
 * @returns Updated labels array (or undefined if no changes)
 */
export function applyPathRuleMatches(
  currentLabels: string[] | undefined,
  matches: PathRuleMatch[]
): string[] | undefined {
  if (matches.length === 0) {
    return currentLabels;
  }

  const existingLabels = new Set(currentLabels ?? []);
  const newLabels: string[] = [];

  for (const match of matches) {
    // Check if this exact label entry already exists
    // For valued labels, check both exact match and bare id
    if (!existingLabels.has(match.labelEntry)) {
      // For valued labels, also check if a different value already exists
      // e.g., if "priority::2" exists, don't add "priority::3"
      const bareId = match.labelEntry.split('::')[0];
      const hasExistingValue = Array.from(existingLabels).some(
        l => l === bareId || l.startsWith(`${bareId}::`)
      );
      if (!hasExistingValue) {
        newLabels.push(match.labelEntry);
      }
    }
  }

  if (newLabels.length === 0) {
    return currentLabels;
  }

  return [...(currentLabels ?? []), ...newLabels];
}
