import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';
import type { MemoryRepository } from '@archstudio/shared/memory/repository.ts';
import { MemoryUpdateSchema } from './memory-schemas.ts';

/**
 * `memory_update` parameters — patch an existing memory by id.
 * Only supplied fields are updated; omitted fields keep their current value.
 */
export interface MemoryUpdateArgs {
  id: string;
  title?: string;
  content?: string;
  scope?: 'session' | 'project' | 'workspace' | 'agent' | 'global';
  scopeId?: string;
  tags?: string[];
  confidence?: number;
  sensitivity?: 'public' | 'internal' | 'sensitive' | 'secret';
  key?: string;
  category?: string;
  canonicalQuestion?: string;
  outcome?: string;
}

/**
 * Update an existing memory by id. Only the fields the agent supplies are
 * patched — everything else is preserved. Uses the repository's
 * `updateMemory` (UPDATE + FTS reindex + optional audit in a single
 * transaction).
 *
 * Returns a success response with the updated memory's id, class, and
 * title. Errors if the id doesn't exist or the repository throws.
 */
export async function handleMemoryUpdate(
  ctx: SessionToolContext,
  args: MemoryUpdateArgs,
): Promise<ToolResult> {
  if (!ctx.callbacks?.getMemoryRepository) {
    return errorResponse('memory_update is not available in this context.');
  }

  const parsed = MemoryUpdateSchema.safeParse(args);
  if (!parsed.success) {
    return errorResponse(
      'memory_update received invalid args: ' + (parsed.error.issues[0]?.message ?? 'unknown'),
    );
  }

  const a = parsed.data;

  try {
    const repo: MemoryRepository = await ctx.callbacks.getMemoryRepository();

    // Build the patch object from only the supplied fields.
    const patch: Record<string, unknown> = {};
    const supplied = new Set(Object.keys(a) as (keyof typeof a)[]);
    const patchable: (keyof typeof a)[] = [
      'title', 'content', 'scope', 'scopeId', 'tags',
      'confidence', 'sensitivity',
      'key', 'category', 'canonicalQuestion', 'outcome',
    ];
    for (const key of patchable) {
      if (supplied.has(key) && a[key] !== undefined) {
        patch[key as string] = a[key];
      }
    }

    if (Object.keys(patch).length === 0) {
      return errorResponse('memory_update: no patchable fields supplied. Provide at least one field to update.');
    }

    const updated = repo.updateMemory(a.id, patch);
    return successResponse(
      `Memory updated: "${updated.title}" (id=${updated.id}, class=${updated.class})`,
      {
        id: updated.id,
        class: updated.class,
        title: updated.title,
        updatedFields: Object.keys(patch),
      },
    );
  } catch (e: any) {
    if (e?.message?.includes?.('not found')) {
      return errorResponse(`Memory "${a.id}" not found. Use memory_search to find candidates.`);
    }
    const message = e instanceof Error ? e.message : String(e);
    return errorResponse(`memory_update failed: ${message}`);
  }
}
