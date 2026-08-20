/**
 * Automations Schema Definitions
 *
 * Zod schemas for validating automations.json configuration.
 * Extracted from index.ts for better separation of concerns.
 */

import { NEVER, z } from 'zod';
import type { ValidationIssue } from '../config/validators.ts';
import { APP_EVENTS, AGENT_EVENTS, AUTOMATION_GRAPH_VERSION, type AutomationCondition, type AutomationEvent } from './types.ts';
import { THINKING_LEVEL_IDS, normalizeThinkingLevel } from '../agent/thinking-levels.ts';

// ============================================================================
// Zod Schemas
// ============================================================================

// Mirrors the workspace-default pattern in `config/storage.ts` so that the
// legacy 'think' value is silently migrated to a current thinking level.
const ThinkingLevelInputSchema = z
  .enum([...THINKING_LEVEL_IDS, 'think'])
  .transform((value) => normalizeThinkingLevel(value))
  .optional();

export const PromptActionSchema = z.object({
  type: z.literal('prompt'),
  prompt: z.string().min(1, 'Prompt cannot be empty'),
  llmConnection: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  thinkingLevel: ThinkingLevelInputSchema,
});

export const WebhookActionSchema = z.object({
  type: z.literal('webhook'),
  url: z.string().min(1, 'URL cannot be empty').refine(
    (url) => {
      // Allow env var templates — validated at runtime after expansion
      if (url.includes('$')) return true;
      // Literal URLs must be valid http/https
      try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        return false;
      }
    },
    'URL must be a valid http/https URL or contain $VAR templates'
  ),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  bodyFormat: z.enum(['json', 'form', 'raw']).optional(),
  body: z.unknown().optional(),
  captureResponse: z.boolean().optional(),
  auth: z.union([
    z.object({
      type: z.literal('basic'),
      username: z.string().min(1),
      password: z.string(),
    }),
    z.object({
      type: z.literal('bearer'),
      token: z.string().min(1),
    }),
  ]).optional(),
});

/** Knowledge ref object or env-expandable string */
const KnowledgeRefValueSchema = z.union([
  z.object({
    scheme: z.literal('siyuan'),
    kind: z.string().min(1),
    id: z.string().min(1),
    provider: z.string().optional(),
    connectionId: z.string().optional(),
  }),
  z.string().min(1),
]);

const CraftRefValueSchema = z.union([
  z.object({
    scheme: z.literal('craft'),
    kind: z.string().min(1),
    id: z.string().min(1),
  }),
  z.string().min(1),
]);

export const KnowledgeAutomationOpSchema = z.enum([
  'create_document',
  'append_block',
  'propose_patch',
  'set_attribute',
  'link_session',
  'publish_run',
]);

export const KnowledgeAutomationActionSchema = z.object({
  type: z.literal('knowledge'),
  op: KnowledgeAutomationOpSchema,
  notebook: z.string().optional(),
  path: z.string().optional(),
  markdown: z.string().optional(),
  parentRef: KnowledgeRefValueSchema.optional(),
  targetRef: KnowledgeRefValueSchema.optional(),
  knowledgeRef: KnowledgeRefValueSchema.optional(),
  craftRef: CraftRefValueSchema.optional(),
  relation: z.string().optional(),
  name: z.string().optional(),
  value: z.string().optional(),
  baseHash: z.string().optional(),
  patchMarkdown: z.string().optional(),
  runId: z.string().optional(),
  targetNotebook: z.string().optional(),
  targetPath: z.string().optional(),
  review: z.literal('required').optional(),
  attributes: z.record(z.string(), z.string()).optional(),
  /** DEFAULT false for ALL knowledge ops in v1 — always propose only except link_session */
  autoApply: z.boolean().optional(),
});

export const CloudRunSubmitActionSchema = z.object({
  type: z.literal('cloud_run.submit'),
  skillSlug: z.string().optional(),
  topic: z.string().optional(),
  labels: z.array(z.string()).optional(),
  callbackTag: z.string().optional(),
  sessionId: z.string().optional(),
});

/** Accepts known actions strictly; passes through legacy/unknown action types without erroring */
export const ActionDefinitionSchema = z.union([
  PromptActionSchema,
  WebhookActionSchema,
  KnowledgeAutomationActionSchema,
  CloudRunSubmitActionSchema,
  z.object({ type: z.string() }).passthrough(),
]);

// ============================================================================
// Condition Schemas
// ============================================================================

const VALID_WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export const TimeConditionSchema = z.object({
  condition: z.literal('time'),
  after: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM format').optional(),
  before: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM format').optional(),
  weekday: z.array(z.enum(VALID_WEEKDAYS)).optional(),
  timezone: z.string().optional(),
});

export const StateConditionSchema = z.object({
  condition: z.literal('state'),
  field: z.string().min(1, 'Field name cannot be empty'),
  value: z.unknown().optional(),
  from: z.unknown().optional(),
  to: z.unknown().optional(),
  contains: z.string().optional(),
  not_value: z.unknown().optional(),
}).superRefine((data, ctx) => {
  const hasValue = data.value !== undefined;
  const hasFromOrTo = data.from !== undefined || data.to !== undefined;
  const hasContains = data.contains !== undefined;
  const hasNotValue = data.not_value !== undefined;

  const operatorCount =
    (hasValue ? 1 : 0) +
    (hasFromOrTo ? 1 : 0) +
    (hasContains ? 1 : 0) +
    (hasNotValue ? 1 : 0);

  if (operatorCount === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'State condition must have at least one operator (value, from/to, contains, or not_value)',
      path: ['field'],
    });
    return;
  }

  if (operatorCount > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'State condition must use exactly one operator group (value, from/to, contains, or not_value)',
      path: ['field'],
    });
  }
});

export const AutomationConditionSchema: z.ZodType<AutomationCondition> = z.lazy(() =>
  z.discriminatedUnion('condition', [
    TimeConditionSchema,
    StateConditionSchema,
    z.object({
      condition: z.enum(['and', 'or', 'not']),
      conditions: z.array(AutomationConditionSchema).min(1, 'Logical condition must have at least one sub-condition'),
    }),
  ])
);

// ============================================================================
// Matcher Schema
// ============================================================================

export const AutomationMatcherSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  matcher: z.string().optional(),
  cron: z.string().optional(),
  timezone: z.string().optional(),
  permissionMode: z.enum(['safe', 'ask', 'allow-all']).optional(),
  labels: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  conditions: z.array(AutomationConditionSchema).optional(),
  // Telegram forum-topic name (1–128 chars). Silently ignored at runtime when
  // no supergroup is paired or the Telegram adapter is not connected.
  telegramTopic: z.string().min(1).max(128).optional(),
  /** Attribute names this matcher documents as trusted for set_attribute */
  attributeAllowList: z.array(z.string()).optional(),
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

const CANONICAL_AUTOMATION_EVENTS = new Set<string>([...APP_EVENTS, ...AGENT_EVENTS]);

function isAutomationEvent(value: string): value is AutomationEvent {
  return CANONICAL_AUTOMATION_EVENTS.has(value);
}

const AutomationGraphEventSchema = z.string().transform((event, context): AutomationEvent => {
  const canonical = DEPRECATED_EVENT_ALIASES[event] ?? event;
  if (isAutomationEvent(canonical)) return canonical;
  context.addIssue({
    code: z.ZodIssueCode.custom,
    message: `Unknown automation event "${event}"`,
  });
  return NEVER;
});

// ============================================================================
// Graph Authoring Projection Schemas
// ============================================================================

const AutomationGraphPositionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
}).strict();

const AutomationGraphNodeBaseSchema = z.object({
  id: z.string().min(1).max(128),
  label: z.string().max(512).optional(),
  position: AutomationGraphPositionSchema,
});

const AutomationGraphMatcherDataSchema = AutomationMatcherSchema
  .omit({ actions: true })
  .strict();

const AutomationGraphPromptDataSchema = PromptActionSchema
  .omit({ type: true })
  .strict();

const AutomationGraphWebhookDataSchema = WebhookActionSchema
  .omit({ type: true })
  .strict();

export const AutomationGraphNodeSchema = z.discriminatedUnion('kind', [
  AutomationGraphNodeBaseSchema.extend({
    kind: z.literal('trigger'),
    data: z.object({ event: AutomationGraphEventSchema }).strict(),
  }).strict(),
  AutomationGraphNodeBaseSchema.extend({
    kind: z.literal('matcher'),
    data: AutomationGraphMatcherDataSchema,
  }).strict(),
  AutomationGraphNodeBaseSchema.extend({
    kind: z.literal('prompt'),
    data: AutomationGraphPromptDataSchema,
  }).strict(),
  AutomationGraphNodeBaseSchema.extend({
    kind: z.literal('webhook'),
    data: AutomationGraphWebhookDataSchema,
  }).strict(),
  AutomationGraphNodeBaseSchema.extend({
    kind: z.literal('annotation'),
    data: z.object({ text: z.string().max(10_000).optional() }).strict(),
  }).strict(),
  AutomationGraphNodeBaseSchema.extend({
    kind: z.literal('group'),
    data: z.object({ memberIds: z.array(z.string().min(1).max(128)).optional() }).strict(),
  }).strict(),
  AutomationGraphNodeBaseSchema.extend({
    kind: z.literal('decision'),
    data: z.object({ expression: z.string().max(10_000).optional() }).strict(),
  }).strict(),
]);

export const AutomationGraphEdgeSchema = z.object({
  id: z.string().min(1).max(128),
  source: z.string().min(1).max(128),
  target: z.string().min(1).max(128),
  kind: z.enum(['flow', 'metadata']),
}).strict();

export const AutomationGraphSchema = z.object({
  version: z.literal(AUTOMATION_GRAPH_VERSION),
  nodes: z.array(AutomationGraphNodeSchema).max(500),
  edges: z.array(AutomationGraphEdgeSchema).max(2_000),
}).strict();

export const SaveAutomationGraphPayloadSchema = z.object({
  workspaceId: z.string().min(1).max(512),
  graph: AutomationGraphSchema,
  baseRevision: z.string().min(1).max(128),
}).strict();

export const AutomationsConfigSchema = z.object({
  version: z.number().optional(),
  craftSeedVersion: z.number().int().nonnegative().optional(),
  automations: z.record(z.string(), z.array(AutomationMatcherSchema)).optional(),
  automationGraph: AutomationGraphSchema.optional(),
}).transform((data) => {
  const automations = data.automations ?? {};

  // Filter out invalid event names, rewrite deprecated aliases, and warn.
  const validAutomations: Partial<Record<AutomationEvent, z.infer<typeof AutomationMatcherSchema>[]>> = {};
  const invalidEvents: string[] = [];

  for (const [event, matchers] of Object.entries(automations)) {
    const canonical = DEPRECATED_EVENT_ALIASES[event] ?? event;
    if (isAutomationEvent(canonical)) {
      if (canonical !== event) {
        console.warn(`[automations] Deprecated event name "${event}" — use "${canonical}" instead`);
      }
      validAutomations[canonical] = [...(validAutomations[canonical] ?? []), ...matchers];
    } else {
      invalidEvents.push(event);
    }
  }

  if (invalidEvents.length > 0) {
    console.warn(`[automations] Unknown event types ignored: ${invalidEvents.join(', ')}`);
  }

  return {
    version: data.version,
    craftSeedVersion: data.craftSeedVersion,
    automations: validAutomations,
    automationGraph: data.automationGraph,
  };
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
