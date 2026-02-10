/**
 * Hook System Validation
 *
 * Validators for hooks.json configuration files.
 * Used by PreToolUse hooks and workspace validators.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { HooksConfigSchema, zodErrorToIssues } from './schemas.ts';
import { isValidLabelId } from '../labels/storage.ts';
import { extractLabelId } from '../labels/values.ts';
import { Cron } from 'croner';
import type { ValidationResult, ValidationIssue } from '../config/validators.ts';
import type { HooksConfig, HooksValidationResult } from './types.ts';

/**
 * Validate hooks config (internal - returns parsed config)
 */
export function validateHooksConfig(content: unknown): HooksValidationResult {
  const result = HooksConfigSchema.safeParse(content);

  if (result.success) {
    return { valid: true, errors: [], config: result.data as HooksConfig };
  }

  const errors = result.error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });

  return { valid: false, errors, config: null };
}

/**
 * Validate hooks config from a JSON string (no disk reads).
 * Used by PreToolUse hook to validate before writing to disk.
 * Follows the same pattern as other config validators in validators.ts.
 */
export function validateHooksContent(jsonString: string): ValidationResult {
  const file = 'hooks.json';
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // Parse JSON
  let content: unknown;
  try {
    content = JSON.parse(jsonString);
  } catch (e) {
    return {
      valid: false,
      errors: [{
        file,
        path: '',
        message: `Invalid JSON: ${e instanceof Error ? e.message : 'Unknown error'}`,
        severity: 'error',
      }],
      warnings: [],
    };
  }

  // Validate schema
  const result = HooksConfigSchema.safeParse(content);
  if (!result.success) {
    errors.push(...zodErrorToIssues(result.error, file));
    return { valid: false, errors, warnings };
  }

  // Semantic validations
  const config = result.data;

  // Check for empty hooks array
  const hookCount = Object.values(config.hooks).reduce(
    (sum, matchers) => sum + (matchers?.length ?? 0),
    0
  );
  if (hookCount === 0) {
    warnings.push({
      file,
      path: 'hooks',
      message: 'No hooks configured',
      severity: 'warning',
      suggestion: 'Add hook definitions under event names like StatusChange, LabelAdd, etc.',
    });
  }

  // Validate regex patterns, cron expressions, and timezones in matchers
  for (const [event, matchers] of Object.entries(config.hooks)) {
    if (!matchers) continue;
    for (let i = 0; i < matchers.length; i++) {
      const matcher = matchers[i];
      if (!matcher) continue;
      // Warn about allow-all permission mode
      if (matcher.permissionMode === 'allow-all') {
        warnings.push({
          file,
          path: `hooks.${event}[${i}].permissionMode`,
          message: 'permissionMode "allow-all" bypasses all security checks — use with caution',
          severity: 'warning',
          suggestion: 'Consider using "safe" or "ask" permission mode instead',
        });
      }

      if (matcher.matcher) {
        // ReDoS prevention: limit regex complexity
        const MAX_REGEX_LENGTH = 500;
        if (matcher.matcher.length > MAX_REGEX_LENGTH) {
          errors.push({
            file,
            path: `hooks.${event}[${i}].matcher`,
            message: `Regex pattern too long (${matcher.matcher.length} chars, max ${MAX_REGEX_LENGTH})`,
            severity: 'error',
            suggestion: 'Simplify the regex pattern or split into multiple matchers',
          });
        } else {
          try {
            // Validate regex syntax
            new RegExp(matcher.matcher);

            // Reject catastrophic backtracking (ReDoS) patterns
            // Detect nested quantifiers: a group containing a quantifier that itself has a quantifier
            const nestedQuantifiers = /\([^)]*[+*][^)]*\)[+*{]/;
            // Also detect repeated alternation like (a|a)+ and adjacent greedy quantifiers like .*.*
            const riskyPatterns = /(\.\*){2,}|(\.\+){2,}|\([^)]*\|[^)]*\)[+*{]/;
            if (nestedQuantifiers.test(matcher.matcher) || riskyPatterns.test(matcher.matcher)) {
              errors.push({
                file,
                path: `hooks.${event}[${i}].matcher`,
                message: 'Regex pattern rejected: potential catastrophic backtracking (ReDoS)',
                severity: 'error',
                suggestion: 'Avoid nested quantifiers like (a+)+, (.*)+, (.+)*, ([a-z]+)+, and repeated alternation like (a|a)+',
              });
            }
          } catch (e) {
            errors.push({
              file,
              path: `hooks.${event}[${i}].matcher`,
              message: `Invalid regex pattern: ${e instanceof Error ? e.message : 'Unknown error'}`,
              severity: 'error',
              suggestion: 'Fix the regex pattern or remove the matcher to match all events',
            });
          }
        }
      }

      // Validate cron expressions
      if (matcher.cron) {
        try {
          new Cron(matcher.cron);
        } catch (e) {
          errors.push({
            file,
            path: `hooks.${event}[${i}].cron`,
            message: `Invalid cron expression: ${e instanceof Error ? e.message : 'Unknown error'}`,
            severity: 'error',
            suggestion: 'Use standard 5-field cron format: minute hour day-of-month month day-of-week',
          });
        }
      }

      // Validate timezone
      if (matcher.timezone) {
        try {
          Intl.DateTimeFormat(undefined, { timeZone: matcher.timezone });
        } catch {
          errors.push({
            file,
            path: `hooks.${event}[${i}].timezone`,
            message: `Invalid timezone: ${matcher.timezone}`,
            severity: 'error',
            suggestion: 'Use IANA timezone format like "Europe/Budapest" or "America/New_York"',
          });
        }
      }

      // Warn if cron is used on non-SchedulerTick event
      if (matcher.cron && event !== 'SchedulerTick') {
        warnings.push({
          file,
          path: `hooks.${event}[${i}].cron`,
          message: `Cron expressions are only used for SchedulerTick events`,
          severity: 'warning',
          suggestion: `Move this hook to the SchedulerTick event or use matcher instead`,
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate hooks.json from workspace path (reads from disk).
 * Follows the same pattern as other validators in validators.ts.
 */
export function validateHooks(workspaceRoot: string): ValidationResult {
  const configPath = join(workspaceRoot, 'hooks.json');
  const file = 'hooks.json';

  // Hooks config is optional - no config means no hooks (valid state)
  if (!existsSync(configPath)) {
    return {
      valid: true,
      errors: [],
      warnings: [{
        file,
        path: '',
        message: 'hooks.json does not exist (no hooks configured)',
        severity: 'warning',
      }],
    };
  }

  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch (e) {
    return {
      valid: false,
      errors: [{
        file,
        path: '',
        message: `Cannot read file: ${e instanceof Error ? e.message : 'Unknown error'}`,
        severity: 'error',
      }],
      warnings: [],
    };
  }

  // First validate content (JSON + schema)
  const contentResult = validateHooksContent(raw);
  if (!contentResult.valid) {
    return contentResult;
  }

  // Additional workspace-aware validations
  const warnings = [...contentResult.warnings];

  // Validate labels exist in workspace
  try {
    const config = JSON.parse(raw) as { hooks?: Record<string, Array<{ labels?: string[] }>> };
    if (config.hooks) {
      for (const [event, matchers] of Object.entries(config.hooks)) {
        if (!matchers) continue;
        for (let i = 0; i < matchers.length; i++) {
          const matcher = matchers[i];
          if (matcher?.labels) {
            for (const label of matcher.labels) {
              // Extract label ID (handles "priority::3" -> "priority")
              const labelId = extractLabelId(label);
              if (!isValidLabelId(workspaceRoot, labelId)) {
                warnings.push({
                  file,
                  path: `hooks.${event}[${i}].labels`,
                  message: `Label "${labelId}" does not exist in workspace`,
                  severity: 'warning',
                  suggestion: `Create this label in labels/config.json or use an existing label ID`,
                });
              }
            }
          }
        }
      }
    }
  } catch {
    // JSON already validated, this shouldn't happen
  }

  return {
    valid: contentResult.valid,
    errors: contentResult.errors,
    warnings,
  };
}
