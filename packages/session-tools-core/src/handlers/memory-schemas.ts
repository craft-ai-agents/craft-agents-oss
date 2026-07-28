/**
 * Memory tool input schemas.
 *
 * Lives in a dedicated sibling module so handlers can import the Zod schemas
 * for `MemorySearchSchema.safeParse(args)` at entry WITHOUT creating a circular
 * import cycle (handlers need the schemas; SESSION_TOOL_DEFS in tool-defs.ts
 * needs the handlers).
 *
 * tool-defs.ts carries an in-file copy of these schemas syntactically for its
 * own internal use; runtime entry into handlers goes through this module.
 */
import { z } from 'zod';

export const MemorySearchSchema = z.object({
  query: z.string().min(1, 'query is required'),
  class: z.enum(['profile', 'semantic', 'episodic', 'procedural']).optional(),
  scopeId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
}).strict();

export type MemorySearchParsed = z.infer<typeof MemorySearchSchema>;

export const MemoryRecallSchema = z.object({
  id: z.string().min(1, 'id is required'),
}).strict();

export type MemoryRecallParsed = z.infer<typeof MemoryRecallSchema>;

export const MemoryCreateSchema = z.object({
  class: z.enum(['profile', 'semantic', 'episodic', 'procedural']),
  title: z.string().min(1, 'title is required'),
  content: z.string().min(1, 'content is required'),
  scope: z.enum(['session', 'project', 'workspace', 'agent', 'global']).optional().default('agent'),
  scopeId: z.string().optional(),
  tags: z.array(z.string()).optional().default([]),
  confidence: z.number().min(0).max(1).optional().default(0.8),
  sensitivity: z.enum(['public', 'internal', 'sensitive', 'secret']).optional().default('internal'),
  // Class-specific optional fields
  key: z.string().optional(),
  category: z.string().optional(),
  canonicalQuestion: z.string().optional(),
  sessionId: z.string().optional(),
  outcome: z.string().optional(),
  triggers: z.array(z.string()).optional(),
  successCount: z.number().int().nonnegative().optional(),
}).strict();

export type MemoryCreateParsed = z.infer<typeof MemoryCreateSchema>;

export const MemoryUpdateSchema = z.object({
  id: z.string().min(1, 'id is required'),
  title: z.string().optional(),
  content: z.string().optional(),
  scope: z.enum(['session', 'project', 'workspace', 'agent', 'global']).optional(),
  scopeId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  sensitivity: z.enum(['public', 'internal', 'sensitive', 'secret']).optional(),
  key: z.string().optional(),
  category: z.string().optional(),
  canonicalQuestion: z.string().optional(),
  outcome: z.string().optional(),
}).strict();

export type MemoryUpdateParsed = z.infer<typeof MemoryUpdateSchema>;

export const MemoryArchiveSchema = z.object({
  id: z.string().min(1, 'id is required'),
}).strict();

export type MemoryArchiveParsed = z.infer<typeof MemoryArchiveSchema>;
