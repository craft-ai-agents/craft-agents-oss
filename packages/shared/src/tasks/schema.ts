/**
 * task.yaml schema — the declarative DAG spec for Tasks.
 *
 * A Task is an editable graph of nodes; each node is (in v1) a child session
 * spawned by the in-process Conductor (see packages/server-core/src/tasks/).
 * This module is the single source of truth for the spec shape: Zod schemas +
 * the TypeScript types inferred from them + thin parse helpers.
 *
 * v1 EXECUTES: `kind: 'session'` nodes wired by `depends_on` + `inputs`
 *   (with `${nodes.<id>.output[.field]}` / `${params.<name>}` references).
 * v1 PARSES BUT DEFERS: every other `kind` and the control-flow fields
 *   (`loop`, `when`, `route`, `for_each`, `aggregate`, `approval`, …). They are
 *   validated so hand-authored yaml round-trips, but the Conductor ignores them
 *   until P4. See sessions/.../tasks-architecture.md §5–§5a for the full design.
 *
 * Design note: the architecture draft used BOTH `type:` and `kind:` for a
 * node's role. We consolidate on a single `kind` discriminant (cleaner, avoids
 * the dual-field footgun the doc itself warns about) and accept `type` as a
 * deprecated alias normalized onto `kind`.
 */
import { z } from 'zod';
import type { PermissionMode } from '../agent/mode-types.ts';

// ---------------------------------------------------------------------------
// Enumerations (exported so validators / UI can reuse them)
// ---------------------------------------------------------------------------

/** Permission modes a node session can run under (fixed set, mirrors agent/mode-types). */
export const PERMISSION_MODES = ['safe', 'ask', 'allow-all'] as const satisfies readonly PermissionMode[];

/**
 * Node roles. Only `session` (and the dynamic `orchestrator` escape hatch)
 * carry execution in v1; the rest are pattern/control-flow kinds parsed now,
 * executed in P4.
 */
export const NODE_KINDS = [
  'session', 'orchestrator',
  'route', 'parallel', 'map', 'loop', 'approval',
  'synthesize', 'verify', 'judge', 'filter', 'aggregate', 'finally',
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const AGGREGATE_MODES = ['concat', 'vote', 'majority', 'filter', 'synthesize'] as const;
export const TRIGGER_RULES = ['all_success', 'none_failed_min_one_success', 'one_success', 'all_done'] as const;
export const PARAM_TYPES = ['string', 'number', 'boolean', 'enum', 'json', 'text'] as const;
export const OUTPUT_KINDS = ['param', 'artifact'] as const;
export const RETRY_WHEN = ['error', 'empty', 'invalid'] as const;
export const CACHE_MODES = ['pure', 'off'] as const;
export const TASK_RUNNERS = ['conduct', 'orchestrate'] as const;

// ---------------------------------------------------------------------------
// Repair (verification-loop) bounds — SINGLE SOURCE OF TRUTH.
// `max_iterations` caps how many times a FAIL verdict re-runs the repair frontier.
// Referenced by the schema (`max_iterations.max`), the runner (cap clamp + default),
// and the editor UI control so the three never drift.
// ---------------------------------------------------------------------------

/** Repair attempts allowed when a task omits `max_iterations`. */
export const DEFAULT_REPAIR_ATTEMPTS = 3;
/** Hard upper bound on `max_iterations` — a guardrail against runaway verify→repair loops. */
export const MAX_REPAIR_ATTEMPTS_CAP = 10;

// ---------------------------------------------------------------------------
// Primitive validators
// ---------------------------------------------------------------------------

/** Lowercase slug — used for task ids, node ids, and the on-disk folder name. */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const slug = (label: string) =>
  z.string().regex(SLUG_RE, `${label} must be a lowercase slug (a-z, 0-9, hyphens; no leading hyphen)`);

/** Identifier — used for param / output names (allows underscores + caps). */
const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const ident = (label: string) =>
  z.string().regex(IDENT_RE, `${label} must be an identifier (letters, digits, underscore; no leading digit)`);

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

/** An input binding: either a ref/template string, or { from, summarize }. */
export const InputRefSchema = z.union([
  z.string(),
  z.object({
    from: z.string().min(1),
    summarize: z.boolean().optional(),
  }),
]);

/** A declared node output handle (param/artifact split — parsed, deferred in v1). */
export const OutputDeclSchema = z.object({
  name: ident('output name'),
  kind: z.enum(OUTPUT_KINDS).optional(),
  type: z.string().optional(),
  enum: z.array(z.string()).optional(),
});

/** Bounded loop control (Loop-Until-Done). `max` is mandatory — an unbounded loop burns tokens forever. */
export const LoopSchema = z.object({
  until: z.string().min(1),
  max: z.number().int().positive(),
  else: z.string().optional(),
  carry: z.string().optional(),
});

export const RetrySchema = z.object({
  limit: z.number().int().min(0),
  backoff: z
    .object({
      base: z.number().positive().optional(),
      factor: z.number().positive().optional(),
      max: z.number().positive().optional(),
    })
    .optional(),
  when: z.enum(RETRY_WHEN).optional(),
});

export const TaskParamSchema = z.object({
  name: ident('param name'),
  type: z.enum(PARAM_TYPES).optional(),
  default: z.unknown().optional(),
  enum: z.array(z.string()).optional(),
});

export const TaskDefaultsSchema = z.object({
  model: z.string().min(1).optional(),
  llmConnection: z.string().min(1).optional(),
  permissionMode: z.enum(PERMISSION_MODES).optional(),
});

// ---------------------------------------------------------------------------
// Node schema
// ---------------------------------------------------------------------------

const TaskNodeObject = z.object({
  id: slug('node id'),
  /** Board tile label; defaults to `id` when omitted. */
  title: z.string().min(1).optional(),
  /** Instruction dispatched to the node session (may contain ${…} refs). Required for `session` nodes. */
  prompt: z.string().optional(),
  kind: z.enum(NODE_KINDS).default('session'),

  // Session-native fields (wired straight into CreateSessionOptions).
  model: z.string().min(1).optional(),
  /** LLM connection slug that serves `model` — required for non-default (e.g. pi/*) models to resolve a backend. */
  llmConnection: z.string().min(1).optional(),
  permissionMode: z.enum(PERMISSION_MODES).optional(),
  labels: z.array(z.string()).optional(),
  status: z.string().optional(),

  // Edges + data flow.
  depends_on: z.array(slug('depends_on entry')).optional(),
  inputs: z.record(z.string(), InputRefSchema).optional(),
  outputs: z.array(OutputDeclSchema).optional(),

  // Control-flow (parsed now, executed in P4).
  when: z.string().optional(),
  trigger: z.enum(TRIGGER_RULES).optional(),
  replicas: z.number().int().positive().optional(),
  aggregate: z.enum(AGGREGATE_MODES).optional(),
  loop: LoopSchema.optional(),
  for_each: z.string().optional(),
  max_parallel: z.number().int().positive().optional(),
  retry: RetrySchema.optional(),
  timeout: z.number().positive().optional(),
  cache: z.enum(CACHE_MODES).optional(),
  approval: z.boolean().optional(),
});

/**
 * Node schema with a legacy-alias preprocess: accept `type:` as a deprecated
 * alias for `kind:` (mapped only when `kind` is absent) and drop it, so the
 * draft yaml in the architecture doc (`type: orchestrator`) still parses.
 */
export const TaskNodeSchema = z.preprocess((raw) => {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>;
    if (r.kind === undefined && typeof r.type === 'string') {
      const { type: _legacyType, ...rest } = r;
      return { ...rest, kind: r.type };
    }
  }
  return raw;
}, TaskNodeObject);

// ---------------------------------------------------------------------------
// Task schema
// ---------------------------------------------------------------------------

export const TaskSpecSchema = z
  .object({
    id: slug('task id'),
    title: z.string().min(1),
    goal: z.string().min(1),
    /** Freeform rubric the orchestrator grades the final result against (verification gate). Falls back to `goal`. */
    acceptance_criteria: z.string().min(1).optional(),
    project: z.string().min(1).optional(),
    /** Working directory for the orchestrator and every child session. Absolute path; when
     *  omitted the orchestrator's own working directory (project/workspace default) is used and
     *  children inherit it at dispatch. */
    cwd: z.string().min(1).optional(),
    runner: z.enum(TASK_RUNNERS).default('conduct'),
    /** Source slugs enabled on the orchestrator and every child session (per-session enabled sources). */
    sources: z.array(z.string().min(1)).optional(),
    /** Skill slugs applied as context: dispatched child prompts carry [skill:slug] mentions, so the
     *  agent pipeline resolves each SKILL.md and blocks tools until it is read. */
    skills: z.array(z.string().min(1)).optional(),
    defaults: TaskDefaultsSchema.optional(),
    params: z.array(TaskParamSchema).optional(),
    /** Total (input+output) token budget across all node sessions; USD is a derived display only. */
    token_budget: z.number().int().positive().optional(),
    max_parallel: z.number().int().positive().optional(),
    /** Max repair attempts on a FAIL verdict (re-run the repair frontier). 0 disables repair;
     *  capped at MAX_REPAIR_ATTEMPTS_CAP. Omitted → runner uses DEFAULT_REPAIR_ATTEMPTS. */
    max_iterations: z.number().int().min(0).max(MAX_REPAIR_ATTEMPTS_CAP).optional(),
    nodes: z.array(TaskNodeSchema).min(1, 'A task must define at least one node'),
    /** Named task outputs → reference strings, e.g. { result: "${nodes.review.output}" }. */
    outputs: z.record(z.string(), z.string()).optional(),
  })
  .superRefine((spec, ctx) => {
    const seen = new Set<string>();
    spec.nodes.forEach((node, i) => {
      if (seen.has(node.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate node id "${node.id}"`,
          path: ['nodes', i, 'id'],
        });
      }
      seen.add(node.id);
      // v1 executes session nodes; they must carry a prompt.
      if (node.kind === 'session' && (!node.prompt || node.prompt.trim() === '')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Node "${node.id}" is a session node and must have a non-empty prompt`,
          path: ['nodes', i, 'prompt'],
        });
      }
    });
  });

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type InputRef = z.infer<typeof InputRefSchema>;
export type OutputDecl = z.infer<typeof OutputDeclSchema>;
export type Loop = z.infer<typeof LoopSchema>;
export type Retry = z.infer<typeof RetrySchema>;
export type TaskParam = z.infer<typeof TaskParamSchema>;
export type TaskDefaults = z.infer<typeof TaskDefaultsSchema>;
export type TaskNode = z.infer<typeof TaskNodeSchema>;
export type TaskSpec = z.infer<typeof TaskSpecSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A node's materialized dependency list (never undefined). */
export function nodeDeps(node: TaskNode): string[] {
  return node.depends_on ?? [];
}

/** The board tile label for a node. */
export function nodeTitle(node: TaskNode): string {
  return node.title ?? node.id;
}

/** Parse an unknown value (parsed yaml/json) into a TaskSpec. */
export function parseTaskSpec(raw: unknown) {
  return TaskSpecSchema.safeParse(raw);
}
