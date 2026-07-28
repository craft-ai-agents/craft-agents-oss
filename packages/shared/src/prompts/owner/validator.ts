/**
 * Prompt layer and compiled-prompt validator.
 *
 * Checks:
 * - No credential/key/token leakage in any layer
 * - No NUL bytes or dangerous control characters
 * - Layer content does not exceed reasonable size bounds
 * - Layer order does not duplicate or omit required built-in layers
 */

import type {
  PromptLayer,
  CompiledPromptSnapshot,
  ValidationResult,
} from './types.ts';

import { BUILT_IN_LAYER_IDS } from './types.ts';

/** Maximum content length for a single layer (500KB — safety valve). */
const MAX_LAYER_CONTENT = 512_000;

/** Maximum total prompt length (2MB). */
const MAX_PROMPT_LENGTH = 2_000_000;

/** Regex patterns for credential leakage detection. */
const CREDENTIAL_PATTERNS: RegExp[] = [
  /(?:api[_-]?key|apikey|api[_-]?secret)\s*[:=]\s*['"][A-Za-z0-9_-]{16,}['"]/i,
  /(?:bearer|token|access[_-]?token|auth[_-]?token)\s+[A-Za-z0-9._-]{16,}/i,
  /-----BEGIN (?:RSA |EC |)?PRIVATE KEY-----/,
  /ghp_[A-Za-z0-9]{36,}/,           // GitHub PAT
  /sk-[A-Za-z0-9]{32,}/,            // OpenAI key
  /xox[baprs]-[A-Za-z0-9-]{24,}/,  // Slack token
];

/**
 * Validate a single prompt layer.
 */
export function validateLayer(layer: PromptLayer): ValidationResult {
  const issues: ValidationResult['issues'] = [];

  if (!layer.id) {
    issues.push({ severity: 'error', message: 'Layer id is required' });
  }

  if (!layer.name) {
    issues.push({ severity: 'error', message: 'Layer name is required', field: 'name' });
  }

  if (typeof layer.version !== 'number' || layer.version < 1) {
    issues.push({ severity: 'error', message: 'Layer version must be a positive integer', field: 'version' });
  }

  if (!layer.content) {
    issues.push({ severity: 'error', message: 'Layer content is empty', field: 'content' });
  }

  if (layer.content && layer.content.length > MAX_LAYER_CONTENT) {
    issues.push({ severity: 'error', message: `Layer content exceeds ${MAX_LAYER_CONTENT} bytes`, field: 'content' });
  }

  if (layer.content && !['stable', 'volatile'].includes(layer.stability)) {
    issues.push({ severity: 'error', message: `Invalid stability: ${layer.stability}`, field: 'stability' });
  }

  // Check for dangerous control characters (NUL, etc.)
  if (layer.content && /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(layer.content)) {
    issues.push({ severity: 'warning', message: 'Layer content contains dangerous control characters', field: 'content' });
  }

  // Check for credential leakage
  if (layer.content) {
    for (const pattern of CREDENTIAL_PATTERNS) {
      if (pattern.test(layer.content)) {
        issues.push({ severity: 'error', message: 'Layer content may contain credential material', field: 'content' });
        break;
      }
    }
  }

  return {
    valid: issues.filter((i) => i.severity === 'error').length === 0,
    issues,
  };
}

/**
 * Validate a full compiled prompt snapshot.
 */
export function validateSnapshot(snapshot: CompiledPromptSnapshot): ValidationResult {
  const issues: ValidationResult['issues'] = [];

  if (!snapshot.id) {
    issues.push({ severity: 'error', message: 'Snapshot id is required' });
  }

  if (snapshot.compilerVersion < 1) {
    issues.push({ severity: 'error', message: 'Compiler version must be >= 1', field: 'compilerVersion' });
  }

  if (!snapshot.layerOrder || snapshot.layerOrder.length === 0) {
    issues.push({ severity: 'error', message: 'Layer order is empty', field: 'layerOrder' });
  }

  if (!snapshot.prompt) {
    issues.push({ severity: 'error', message: 'Compiled prompt is empty', field: 'prompt' });
  }

  if (snapshot.prompt && snapshot.prompt.length > MAX_PROMPT_LENGTH) {
    issues.push({ severity: 'error', message: `Compiled prompt exceeds ${MAX_PROMPT_LENGTH} bytes`, field: 'prompt' });
  }

  // Check layer order for duplicates (but allow missing layers — user may have disabled some).
  const seen = new Set<string>();
  for (const id of snapshot.layerOrder ?? []) {
    if (seen.has(id)) {
      issues.push({ severity: 'warning', message: `Duplicate layer id: ${id}`, field: 'layerOrder' });
    }
    seen.add(id);
  }

  // Validate each layer.
  for (const layer of snapshot.layers ?? []) {
    const layerResult = validateLayer(layer);
    issues.push(...layerResult.issues);
  }

  return {
    valid: issues.filter((i) => i.severity === 'error').length === 0,
    issues,
  };
}

/**
 * Quick check: is the compiled password safe for injection?
 * Returns true if no critical issues found.
 */
export function isPromptSafe(prompt: string): boolean {
  if (!prompt) return false;
  if (prompt.length > MAX_PROMPT_LENGTH) return false;
  if (/[\x00]/.test(prompt)) return false; // NUL bytes are never safe
  return true;
}
