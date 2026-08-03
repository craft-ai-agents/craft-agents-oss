import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';
import type { MemoryRepository } from '@archstudio/shared/memory/repository.ts';
import { MemoryCreateSchema } from './memory-schemas.ts';

/**
 * `memory_create` parameters — instruct the agent to persist a new memory
 * into the long-term store. The agent supplies a class, title, content, and
 * optional tags/scope/confidence. Class-specific fields (key, category, etc.)
 * are passed through when the class demands them.
 */
export interface MemoryCreateArgs {
  class: 'profile' | 'semantic' | 'episodic' | 'procedural';
  title: string;
  content: string;
  scope?: 'session' | 'project' | 'workspace' | 'agent' | 'global';
  scopeId?: string;
  tags?: string[];
  confidence?: number;
  sensitivity?: 'public' | 'internal' | 'sensitive' | 'secret';
  key?: string;
  category?: string;
  canonicalQuestion?: string;
  sessionId?: string;
  outcome?: string;
  triggers?: string[];
  successCount?: number;
}

/**
 * Create a new memory in the user's long-term store so it shows up in
 * `memory_search` results and can be recalled later with `memory_recall`.
 *
 * The handler constructs an `AnyMemory` from the agent-supplied fields,
 * stamps the source with the current session id, and delegates to the
 * repository's `createMemory` (which wraps the INSERT + FTS index +
 * optional audit entry in a single transaction).
 */
export async function handleMemoryCreate(
  ctx: SessionToolContext,
  args: MemoryCreateArgs,
): Promise<ToolResult> {
  if (!ctx.callbacks?.getMemoryRepository) {
    return errorResponse('memory_create is not available in this context.');
  }

  const parsed = MemoryCreateSchema.safeParse(args);
  if (!parsed.success) {
    return errorResponse(
      'memory_create received invalid args: ' + (parsed.error.issues[0]?.message ?? 'unknown'),
    );
  }

  const a = parsed.data;
  const now = new Date().toISOString();

  // Build the discriminator field and class-specific extras.
  const base = {
    id: `mem:${ctx.sessionId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    title: a.title,
    content: a.content,
    scope: a.scope ?? 'agent',
    scopeId: a.scopeId ?? undefined,
    confidence: a.confidence ?? 0.8,
    sensitivity: a.sensitivity ?? 'internal',
    source: { sessionId: ctx.sessionId },
    createdAt: now,
    updatedAt: now,
    tags: a.tags ?? [],
    archived: false,
  };

  let memory: Record<string, unknown>;

  switch (a.class) {
    case 'profile':
      memory = {
        ...base,
        class: 'profile' as const,
        key: a.key ?? a.title,
        previousValues: [],
      };
      break;
    case 'semantic':
      memory = {
        ...base,
        class: 'semantic' as const,
        category: a.category ?? 'custom',
        explicit: true,
        canonicalQuestion: a.canonicalQuestion,
      };
      break;
    case 'episodic':
      memory = {
        ...base,
        class: 'episodic' as const,
        sessionId: a.sessionId ?? ctx.sessionId,
        outcome: a.outcome ?? 'completed',
        decisions: [],
        artifacts: [],
        tokenCost: undefined,
        durationSeconds: undefined,
      };
      break;
    case 'procedural':
      memory = {
        ...base,
        class: 'procedural' as const,
        triggers: a.triggers ?? [],
        steps: [],
        successCount: a.successCount ?? 0,
        pitfalls: [],
        dependencies: [],
      };
      break;
  }

  try {
    const repo: MemoryRepository = await ctx.callbacks.getMemoryRepository();
    const created = repo.createMemory(memory as any);
    return successResponse(
      `Memory created: "${created.title}" (id=${created.id}, class=${created.class})`,
      {
        id: created.id,
        class: created.class,
        title: created.title,
      },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return errorResponse(`memory_create failed: ${message}`);
  }
}
