/**
 * Path Rules Types
 *
 * Types for path-based automatic label assignment.
 * When a session's workingDirectory matches a configured path,
 * the corresponding label is automatically applied.
 */

/**
 * Path matching mode
 * - exact: workingDirectory must exactly equal the rule path
 * - prefix: workingDirectory must be the rule path or a subdirectory of it
 */
export type PathMatchMode = 'exact' | 'prefix';

/**
 * A single path-to-label mapping rule
 */
export interface PathRule {
  /** Unique rule ID for stable UI keys and deduplication */
  id: string;
  /** Absolute path to match against session workingDirectory */
  path: string;
  /** Match mode: exact = strict equality, prefix = path or subdirectory */
  match: PathMatchMode;
  /** Label ID to apply (must exist in labels config) */
  labelId: string;
  /** Optional value for valued labels (stored as "labelId::value") */
  value?: string;
  /** Whether this rule is active (defaults to true) */
  enabled?: boolean;
  /** Human-readable description of this rule */
  description?: string;
}

/**
 * Path rules configuration file schema
 * Stored at: ~/.craft-agent/workspaces/{workspaceId}/labels/path-rules.json
 */
export interface PathRulesConfig {
  /** Schema version for future migrations */
  version: 1;
  /** List of path-to-label mapping rules */
  rules: PathRule[];
}

/**
 * Result of evaluating path rules against a workingDirectory
 */
export interface PathRuleMatch {
  /** The rule that matched */
  rule: PathRule;
  /** The label entry to add (bare labelId or "labelId::value") */
  labelEntry: string;
}
