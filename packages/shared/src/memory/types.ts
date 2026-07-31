import { z } from 'zod';

// ================================================================
// Memory Source (where the memory came from)
// ================================================================

export const MemorySourceSchema = z.object({
  sessionId: z.string().optional(),
  messageId: z.string().optional(),
  toolCall: z.string().optional(),
  importOrigin: z.string().optional(), // e.g. 'hermes', 'craft-preferences', 'arch-md'
});

export type MemorySource = z.infer<typeof MemorySourceSchema>;

// ================================================================
// Sensitivity & Expiry
// ================================================================

export const SensitivitySchema = z.enum(['public', 'internal', 'sensitive', 'secret']);

export type Sensitivity = z.infer<typeof SensitivitySchema>;

export const ExpiryPolicySchema = z.object({
  /** ISO date after which this memory may be archived */
  expiresAt: z.string().optional(),
  /** Maximum number of days to keep */
  ttlDays: z.number().int().positive().optional(),
  /** If true, archive automatically when superseded */
  archiveOnSupersede: z.boolean().default(true),
});

export type ExpiryPolicy = z.infer<typeof ExpiryPolicySchema>;

// ================================================================
// Base Memory Entry (common fields across all classes)
// ================================================================

export const BaseMemorySchema = z.object({
  id: z.string(),
  /** Human-readable title */
  title: z.string().min(1),
  /** The durable content of the memory */
  content: z.string().min(1),
  /** What scope this memory belongs to */
  scope: z.enum(['session', 'project', 'workspace', 'agent', 'global']),
  /** Scope identifier — project slug, workspace id, agent id, etc. */
  scopeId: z.string().optional(),
  /** Confidence level (0.0 - 1.0) */
  confidence: z.number().min(0).max(1).default(0.8),
  /** Sensitivity classification */
  sensitivity: SensitivitySchema.default('internal'),
  /** Source trace */
  source: MemorySourceSchema.optional(),
  /** Expiration policy */
  expiry: ExpiryPolicySchema.optional(),
  /** ISO timestamp of creation */
  createdAt: z.string(),
  /** ISO timestamp of last update */
  updatedAt: z.string(),
  /** ID of the memory that superseded this one */
  supersededById: z.string().optional(),
  /** IDs of memories that this one supersedes */
  supersedesIds: z.array(z.string()).default([]),
  /** Tags for categorization */
  tags: z.array(z.string()).default([]),
  /** Whether this memory is archived (hidden from normal retrieval) */
  archived: z.boolean().default(false),
});

export type BaseMemory = z.infer<typeof BaseMemorySchema>;

// ================================================================
// 1. Profile Memory — who the owner is and stable preferences
// ================================================================

export const ProfileMemorySchema = BaseMemorySchema.extend({
  class: z.literal('profile'),
  /** The preference key (e.g. 'name', 'timezone', 'tone') */
  key: z.string(),
  /** Previous values for rollback */
  previousValues: z.array(z.unknown()).default([]),
});

export type ProfileMemory = z.infer<typeof ProfileMemorySchema>;

// ================================================================
// 2. Semantic Memory — durable facts about the world
// ================================================================

export const SemanticMemorySchema = BaseMemorySchema.extend({
  class: z.literal('semantic'),
  /** Category of knowledge */
  category: z.enum([
    'environment',   // machine config, OS, tools installed
    'project',       // project goals, tech stack, conventions
    'people',        // user preferences, team roles
    'convention',    // naming conventions, coding style
    'decision',      // architectural decisions, rationale
    'reference',     // useful links, docs, API info
    'custom',
  ]),
  /** Whether this fact was explicitly taught vs. inferred */
  explicit: z.boolean().default(true),
  /** The question this memory answers (for retrieval matching) */
  canonicalQuestion: z.string().optional(),
});

export type SemanticMemory = z.infer<typeof SemanticMemorySchema>;

// ================================================================
// 3. Episodic Memory — summaries of past sessions/runs
// ================================================================

export const EpisodicMemorySchema = BaseMemorySchema.extend({
  class: z.literal('episodic'),
  /** Session ID this episode refers to */
  sessionId: z.string(),
  /** Brief outcome summary */
  outcome: z.enum(['completed', 'interrupted', 'failed', 'abandoned']),
  /** Key decisions made during this episode */
  decisions: z.array(z.string()).default([]),
  /** Artifacts produced */
  artifacts: z.array(z.object({
    id: z.string(),
    type: z.string(),
    title: z.string(),
  })).default([]),
  /** Token cost */
  tokenCost: z.number().int().nonnegative().optional(),
  /** Duration in seconds */
  durationSeconds: z.number().int().nonnegative().optional(),
});

export type EpisodicMemory = z.infer<typeof EpisodicMemorySchema>;

// ================================================================
// 4. Procedural Memory — skills and proven workflows
// ================================================================

export const ProceduralMemorySchema = BaseMemorySchema.extend({
  class: z.literal('procedural'),
  /** Trigger conditions for this procedure */
  triggers: z.array(z.string()).default([]),
  /** Step-by-step instructions */
  steps: z.array(z.object({
    order: z.number().int(),
    description: z.string(),
    command: z.string().optional(),
    verification: z.string().optional(),
  })).default([]),
  /** Number of times this procedure has been successfully executed */
  successCount: z.number().int().nonnegative().default(0),
  /** Common pitfalls */
  pitfalls: z.array(z.string()).default([]),
  /** Dependencies (tools, packages, permissions) */
  dependencies: z.array(z.string()).default([]),
});

export type ProceduralMemory = z.infer<typeof ProceduralMemorySchema>;

// ================================================================
// Union type for any memory
// ================================================================

export const AnyMemorySchema = z.discriminatedUnion('class', [
  ProfileMemorySchema,
  SemanticMemorySchema,
  EpisodicMemorySchema,
  ProceduralMemorySchema,
]);

export type AnyMemory = z.infer<typeof AnyMemorySchema>;

// ================================================================
// Audit Entry
// ================================================================

export const AuditEntrySchema = z.object({
  id: z.string(),
  memoryId: z.string(),
  action: z.enum(['create', 'update', 'supersede', 'archive', 'restore', 'delete', 'import']),
  previousContent: z.string().optional(),
  newContent: z.string().optional(),
  source: MemorySourceSchema.optional(),
  timestamp: z.string(),
  actor: z.string().optional(),
});

export type AuditEntry = z.infer<typeof AuditEntrySchema>;

// ================================================================
// Query Types
// ================================================================

export interface MemoryQuery {
  class?: AnyMemory['class'] | AnyMemory['class'][];
  scope?: BaseMemory['scope'] | BaseMemory['scope'][];
  scopeId?: string;
  query?: string;           // FTS5 search text
  tags?: string[];
  category?: string;
  minConfidence?: number;
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
}

export interface MemorySearchResult {
  memory: AnyMemory;
  score: number;            // relevance score from FTS5
  snippet?: string;         // highlighted snippet
}

export type MemoryEdgeType =
  | 'supersedes'
  | 'same-session'
  | 'same-tag'
  | 'depends-on';

export interface MemoryEdge {
  id: string;
  sourceMemoryId: string;
  targetMemoryId: string;
  type: MemoryEdgeType;
  weight: number;
  provenance: 'system' | 'imported';
  createdAt: string;
  updatedAt: string;
}

export interface MemoryGraphData {
  memories: AnyMemory[];
  edges: MemoryEdge[];
}
