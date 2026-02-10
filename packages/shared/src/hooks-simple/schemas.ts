/**
 * Hooks Schema Definitions
 *
 * Zod schemas for validating hooks.json configuration.
 * Extracted from index.ts for better separation of concerns.
 */

import { z } from 'zod';
import type { ValidationIssue } from '../config/validators.ts';

// ============================================================================
// Zod Schemas
// ============================================================================

export const CommandHookSchema = z.object({
  type: z.literal('command'),
  command: z.string().min(1, 'Command cannot be empty'),
  timeout: z.number().positive().optional(),
});

export const PromptHookSchema = z.object({
  type: z.literal('prompt'),
  prompt: z.string().min(1, 'Prompt cannot be empty'),
});

export const HookDefinitionSchema = z.discriminatedUnion('type', [
  CommandHookSchema,
  PromptHookSchema,
]);

export const HookMatcherSchema = z.object({
  matcher: z.string().optional(),
  cron: z.string().optional(),
  timezone: z.string().optional(),
  permissionMode: z.enum(['safe', 'ask', 'allow-all']).optional(),
  labels: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  hooks: z.array(HookDefinitionSchema).min(1, 'At least one hook required'),
});

export const VALID_EVENTS = [
  // App events
  'LabelAdd', 'LabelRemove', 'LabelConfigChange', 'PermissionModeChange', 'FlagChange', 'TodoStateChange', 'SchedulerTick',
  // Agent/SDK events
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Notification',
  'UserPromptSubmit', 'SessionStart', 'SessionEnd', 'Stop',
  'SubagentStart', 'SubagentStop', 'PreCompact', 'PermissionRequest', 'Setup',
] as const;

export const HooksConfigSchema = z.object({
  version: z.number().optional(),
  hooks: z.record(z.string(), z.array(HookMatcherSchema)).optional().default({}),
}).transform((data) => {
  // Filter out invalid event names and warn
  const validHooks: Record<string, z.infer<typeof HookMatcherSchema>[]> = {};
  const invalidEvents: string[] = [];

  for (const [event, matchers] of Object.entries(data.hooks)) {
    if (VALID_EVENTS.includes(event as (typeof VALID_EVENTS)[number])) {
      validHooks[event] = matchers;
    } else {
      invalidEvents.push(event);
    }
  }

  if (invalidEvents.length > 0) {
    console.warn(`[hooks] Unknown event types ignored: ${invalidEvents.join(', ')}`);
  }

  return { version: data.version, hooks: validHooks };
});

// ============================================================================
// Schema Utilities
// ============================================================================

/**
 * Convert Zod error to ValidationIssues (matches validators.ts pattern)
 */
export function zodErrorToIssues(error: z.ZodError, file: string): ValidationIssue[] {
  return error.issues.map((issue) => ({
    file,
    path: issue.path.join('.') || 'root',
    message: issue.message,
    severity: 'error' as const,
  }));
}
