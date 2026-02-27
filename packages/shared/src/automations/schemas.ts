/**
 * Automations Schema Definitions
 *
 * Zod schemas for validating automations.json configuration.
 * Extracted from index.ts for better separation of concerns.
 */

import { z } from 'zod';
import type { ValidationIssue } from '../config/validators.ts';
import { APP_EVENTS, AGENT_EVENTS } from './types.ts';

// ============================================================================
// Zod Schemas
// ============================================================================

export const PromptActionSchema = z.object({
  type: z.literal('prompt'),
  prompt: z.string().min(1, 'Prompt cannot be empty'),
  llmConnection: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
});

/** Accepts prompt actions strictly; passes through legacy/unknown action types without erroring */
export const ActionDefinitionSchema = z.union([
  PromptActionSchema,
  z.object({ type: z.string() }).passthrough(),
]);

export const AutomationMatcherSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  matcher: z.string().optional(),
  cron: z.string().optional(),
  timezone: z.string().optional(),
  permissionMode: z.enum(['safe', 'ask', 'allow-all']).optional(),
  labels: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  actions: z.array(ActionDefinitionSchema).min(1, 'At least one action required'),
});

/**
 * Deprecated event name aliases.
 * Old names are accepted during schema validation and silently rewritten to canonical names.
 * A console.warn() is emitted at runtime so users know to update their configs.
 */
export const DEPRECATED_EVENT_ALIASES: Record<string, string> = {
  'TodoStateChange': 'SessionStatusChange',
};

/** All valid event names: canonical events + deprecated aliases. Derived from types.ts. */
export const VALID_EVENTS: readonly string[] = [
  ...APP_EVENTS,
  ...AGENT_EVENTS,
  ...Object.keys(DEPRECATED_EVENT_ALIASES),
];

export const AutomationsConfigSchema = z.object({
  version: z.number().optional(),
  automations: z.record(z.string(), z.array(AutomationMatcherSchema)).optional(),
}).transform((data) => {
  const automations = data.automations ?? {};

  // Filter out invalid event names, rewrite deprecated aliases, and warn
  const validAutomations: Record<string, z.infer<typeof AutomationMatcherSchema>[]> = {};
  const invalidEvents: string[] = [];

  for (const [event, matchers] of Object.entries(automations)) {
    if (VALID_EVENTS.includes(event)) {
      // Rewrite deprecated aliases to canonical names
      const canonical = DEPRECATED_EVENT_ALIASES[event];
      if (canonical) {
        console.warn(`[automations] Deprecated event name "${event}" — use "${canonical}" instead`);
        validAutomations[canonical] = [...(validAutomations[canonical] ?? []), ...matchers];
      } else {
        validAutomations[event] = [...(validAutomations[event] ?? []), ...matchers];
      }
    } else {
      invalidEvents.push(event);
    }
  }

  if (invalidEvents.length > 0) {
    console.warn(`[automations] Unknown event types ignored: ${invalidEvents.join(', ')}`);
  }

  return { version: data.version, automations: validAutomations };
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
