/**
 * Hooks Configuration Validation
 *
 * Validates hooks.json files from disk.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { debug } from '../utils/debug.ts';
import {
  validateHooksConfigObject,
  formatHooksValidationResult,
  type HooksValidationResult,
} from './schemas.ts';

/**
 * Validate a hooks.json file at the given workspace path.
 *
 * @param workspacePath - Absolute path to the workspace directory
 * @returns Validation result with errors and warnings
 */
export function validateHooksConfig(workspacePath: string): HooksValidationResult {
  const hooksPath = join(workspacePath, 'hooks.json');

  if (!existsSync(hooksPath)) {
    return {
      valid: true,
      errors: [],
      warnings: [{ path: 'hooks.json', message: 'File does not exist (no hooks configured)' }],
    };
  }

  let content: string;
  try {
    content = readFileSync(hooksPath, 'utf-8');
  } catch (error) {
    return {
      valid: false,
      errors: [{
        path: 'hooks.json',
        message: `Cannot read file: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }],
      warnings: [],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    return {
      valid: false,
      errors: [{
        path: 'hooks.json',
        message: `Invalid JSON: ${error instanceof Error ? error.message : 'Parse error'}`,
      }],
      warnings: [],
    };
  }

  return validateHooksConfigObject(parsed);
}

/**
 * Load and validate a hooks.json file.
 * Returns the parsed config if valid, null if invalid or missing.
 */
export function loadAndValidateHooksConfig(workspacePath: string): {
  config: import('./types.ts').HooksConfig | null;
  result: HooksValidationResult;
} {
  const result = validateHooksConfig(workspacePath);

  if (!result.valid) {
    debug(`[HooksValidation] Invalid hooks.json at ${workspacePath}: ${result.errors.map(e => e.message).join(', ')}`);
    return { config: null, result };
  }

  const hooksPath = join(workspacePath, 'hooks.json');
  if (!existsSync(hooksPath)) {
    return { config: null, result };
  }

  try {
    const content = readFileSync(hooksPath, 'utf-8');
    const parsed = JSON.parse(content);
    return { config: parsed, result };
  } catch {
    return { config: null, result };
  }
}

export { formatHooksValidationResult };
