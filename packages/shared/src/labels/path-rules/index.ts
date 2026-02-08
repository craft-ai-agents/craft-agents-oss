/**
 * Path Rules Module
 *
 * Automatic label assignment based on session workingDirectory.
 */

export type {
  PathRule,
  PathRulesConfig,
  PathMatchMode,
  PathRuleMatch,
} from './types.ts';

export {
  evaluatePathRules,
  applyPathRuleMatches,
} from './evaluator.ts';

export {
  loadPathRulesConfig,
  savePathRulesConfig,
  getPathRulesPath,
  generateRuleId,
} from './storage.ts';
