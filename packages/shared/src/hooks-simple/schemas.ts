/**
 * Hooks Configuration Schemas
 *
 * Zod schemas for validating hooks.json configuration files.
 */

import { z } from 'zod';

// ============================================================
// Hook Action Schemas
// ============================================================

const commandHookSchema = z.object({
  type: z.literal('command'),
  command: z.string().min(1, 'Command cannot be empty'),
  timeout: z.number().int().positive().optional(),
  cwd: z.string().optional(),
});

const promptHookSchema = z.object({
  type: z.literal('prompt'),
  prompt: z.string().min(1, 'Prompt cannot be empty'),
  permissionMode: z.enum(['safe', 'ask', 'allow-all']).optional(),
  model: z.string().optional(),
  labels: z.array(z.string()).optional(),
  enabledSourceSlugs: z.array(z.string()).optional(),
});

const eventLogHookSchema = z.object({
  type: z.literal('event-log'),
  logFile: z.string().optional(),
});

const hookActionSchema = z.discriminatedUnion('type', [
  commandHookSchema,
  promptHookSchema,
  eventLogHookSchema,
]);

// ============================================================
// Event Type Schemas
// ============================================================

const appEventTypes = [
  'LabelAdd',
  'LabelRemove',
  'PermissionModeChange',
  'FlagChange',
  'TodoStateChange',
  'SchedulerTick',
  'LabelConfigChange',
] as const;

const agentEventTypes = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'SessionStart',
  'SessionEnd',
  'SubagentStart',
  'SubagentStop',
] as const;

const allEventTypes = [...appEventTypes, ...agentEventTypes] as const;

export const hookEventTypeSchema = z.enum(allEventTypes);

// ============================================================
// Hook Matcher Schema
// ============================================================

const hookMatcherSchema = z.object({
  matcher: z.string().optional(),
  cron: z.string().optional(),
  timezone: z.string().optional(),
  permissionMode: z.enum(['safe', 'ask', 'allow-all']).optional(),
  labels: z.array(z.string()).optional(),
  hooks: z.array(hookActionSchema).min(1, 'At least one hook action is required'),
}).refine(
  (data) => {
    // Cron is only valid for SchedulerTick events (validated at config level)
    // matcher and cron are both optional
    return true;
  },
);

// ============================================================
// Hooks Config Schema
// ============================================================

/** Schema for the hooks record (event type -> matchers array) */
const hooksRecordSchema = z.record(
  z.string(),
  z.array(hookMatcherSchema),
).optional().default({});

/** Full hooks.json schema */
export const hooksConfigSchema = z.object({
  version: z.literal(1),
  hooks: hooksRecordSchema,
}).transform((data) => {
  // Validate that all keys are valid event types
  const validKeys = new Set(allEventTypes);
  const hooks: Record<string, z.infer<typeof hookMatcherSchema>[]> = {};
  for (const [key, value] of Object.entries(data.hooks)) {
    if (validKeys.has(key as any)) {
      hooks[key] = value;
    }
  }
  return { ...data, hooks };
});

export type HooksConfigInput = z.input<typeof hooksConfigSchema>;
export type HooksConfigOutput = z.output<typeof hooksConfigSchema>;

// ============================================================
// Validation Helpers
// ============================================================

export interface HooksValidationResult {
  valid: boolean;
  errors: HooksValidationError[];
  warnings: HooksValidationWarning[];
}

export interface HooksValidationError {
  path: string;
  message: string;
}

export interface HooksValidationWarning {
  path: string;
  message: string;
}

/**
 * Validate a hooks configuration object.
 * Returns structured validation result.
 */
export function validateHooksConfigObject(config: unknown): HooksValidationResult {
  const result: HooksValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
  };

  const parsed = hooksConfigSchema.safeParse(config);
  if (!parsed.success) {
    result.valid = false;
    for (const issue of parsed.error.issues) {
      result.errors.push({
        path: issue.path.join('.'),
        message: issue.message,
      });
    }
    return result;
  }

  const data = parsed.data;

  // Additional semantic validation
  for (const [eventType, matchers] of Object.entries(data.hooks)) {
    if (!matchers) continue;

    for (let i = 0; i < matchers.length; i++) {
      const matcher = matchers[i]!;
      const matcherPath = `hooks.${eventType}[${i}]`;

      // Validate cron is only used with SchedulerTick
      if (matcher.cron && eventType !== 'SchedulerTick') {
        result.warnings.push({
          path: `${matcherPath}.cron`,
          message: `cron field is only used with SchedulerTick events (found on ${eventType})`,
        });
      }

      // Validate matcher regex is valid
      if (matcher.matcher) {
        try {
          new RegExp(matcher.matcher);
        } catch {
          result.valid = false;
          result.errors.push({
            path: `${matcherPath}.matcher`,
            message: `Invalid regex pattern: ${matcher.matcher}`,
          });
        }
      }

      // Validate cron expression
      if (matcher.cron) {
        const cronValid = isValidCronExpression(matcher.cron);
        if (!cronValid) {
          result.valid = false;
          result.errors.push({
            path: `${matcherPath}.cron`,
            message: `Invalid cron expression: ${matcher.cron}`,
          });
        }
      }

      // Warn about command hooks without explicit permissionMode
      for (let j = 0; j < matcher.hooks.length; j++) {
        const action = matcher.hooks[j]!;
        if (action.type === 'command' && !matcher.permissionMode) {
          result.warnings.push({
            path: `${matcherPath}.hooks[${j}]`,
            message: 'Command hook without explicit permissionMode will require permission approval',
          });
        }
      }
    }
  }

  return result;
}

/**
 * Basic cron expression validation.
 * Supports standard 5-field cron and our shorthand formats.
 */
function isValidCronExpression(expr: string): boolean {
  const trimmed = expr.trim();

  // Shorthand: "HH:MM", "weekdays HH:MM", "weekends HH:MM"
  if (/^(?:(?:weekdays|weekends)\s+)?\d{1,2}:\d{2}$/.test(trimmed)) {
    return true;
  }

  // Interval: "*/2h", "*/30m"
  if (/^\*\/\d+[hm]$/.test(trimmed)) {
    return true;
  }

  // Standard 5-field cron
  const parts = trimmed.split(/\s+/);
  if (parts.length === 5) {
    // Basic validation: each field should contain valid cron chars
    return parts.every(part => /^[\d,\-\*\/]+$/.test(part!));
  }

  return false;
}

/**
 * Format validation result as human-readable string.
 */
export function formatHooksValidationResult(result: HooksValidationResult): string {
  const lines: string[] = [];

  if (result.valid && result.warnings.length === 0) {
    lines.push('✓ hooks.json is valid');
    return lines.join('\n');
  }

  if (!result.valid) {
    lines.push('✗ hooks.json has errors:');
    for (const error of result.errors) {
      lines.push(`  ERROR at ${error.path}: ${error.message}`);
    }
  } else {
    lines.push('✓ hooks.json is valid (with warnings):');
  }

  if (result.warnings.length > 0) {
    lines.push('');
    lines.push('  Warnings:');
    for (const warning of result.warnings) {
      lines.push(`  WARN at ${warning.path}: ${warning.message}`);
    }
  }

  return lines.join('\n');
}
