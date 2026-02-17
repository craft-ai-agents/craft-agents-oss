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
  id: z.string().optional(),
  name: z.string().optional(),
  matcher: z.string().optional(),
  cron: z.string().optional(),
  timezone: z.string().optional(),
  permissionMode: z.enum(['safe', 'ask', 'allow-all']).optional(),
  labels: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  // Accept both "actions" (v2) and "hooks" (v1) — normalized to "hooks" internally
  hooks: z.array(HookDefinitionSchema).optional(),
  actions: z.array(HookDefinitionSchema).optional(),
}).refine(
  (data) => (data.hooks?.length ?? 0) + (data.actions?.length ?? 0) > 0,
  { message: 'At least one action required (in "actions" or "hooks" array)' },
).transform((data) => {
  // Normalize: merge actions into hooks, drop actions key
  const merged = [...(data.hooks ?? []), ...(data.actions ?? [])];
  const { actions: _actions, ...rest } = data;
  return { ...rest, hooks: merged };
});

/**
 * Deprecated event name aliases.
 * Old names are accepted during schema validation and silently rewritten to canonical names.
 * A console.warn() is emitted at runtime so users know to update their configs.
 */
export const DEPRECATED_EVENT_ALIASES: Record<string, string> = {
  'TodoStateChange': 'SessionStatusChange',
};

export const VALID_EVENTS = [
  // App events
  'LabelAdd', 'LabelRemove', 'LabelConfigChange', 'PermissionModeChange', 'FlagChange', 'SessionStatusChange', 'SchedulerTick',
  // Deprecated aliases (still accepted, rewritten in transform)
  'TodoStateChange',
  // Agent/SDK events
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Notification',
  'UserPromptSubmit', 'SessionStart', 'SessionEnd', 'Stop',
  'SubagentStart', 'SubagentStop', 'PreCompact', 'PermissionRequest', 'Setup',
] as const;

export const HooksConfigSchema = z.object({
  version: z.number().optional(),
  // Accept both "tasks" (v2) and "hooks" (v1) top-level keys
  hooks: z.record(z.string(), z.array(HookMatcherSchema)).optional(),
  tasks: z.record(z.string(), z.array(HookMatcherSchema)).optional(),
}).transform((data) => {
  // Normalize: merge tasks into hooks, use hooks as canonical internal key
  const merged = { ...(data.hooks ?? {}), ...(data.tasks ?? {}) };
  data.hooks = Object.keys(merged).length > 0 ? merged : {};
  delete (data as Record<string, unknown>).tasks;
  // Filter out invalid event names, rewrite deprecated aliases, and warn
  const validHooks: Record<string, z.infer<typeof HookMatcherSchema>[]> = {};
  const invalidEvents: string[] = [];

  for (const [event, matchers] of Object.entries(data.hooks)) {
    if (VALID_EVENTS.includes(event as (typeof VALID_EVENTS)[number])) {
      // Rewrite deprecated aliases to canonical names
      const canonical = DEPRECATED_EVENT_ALIASES[event];
      if (canonical) {
        console.warn(`[hooks] Deprecated event name "${event}" — use "${canonical}" instead`);
        // Merge with existing matchers for the canonical name if any
        validHooks[canonical] = [...(validHooks[canonical] ?? []), ...matchers];
      } else {
        validHooks[event] = [...(validHooks[event] ?? []), ...matchers];
      }
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
