import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';
import type { MemoryRepository } from '@archstudio/shared/memory/repository.ts';
import { MemoryArchiveSchema } from './memory-schemas.ts';

/**
 * `memory_archive` parameters — mark a memory as archived so it no longer
 * appears in normal `memory_search` results. Archived memories can be
 * restored through the MemoryPanel or a future `memory_restore` tool.
 */
export interface MemoryArchiveArgs {
  id: string;
}

/**
 * Archive (soft-delete) a memory by id. The memory is marked `archived: true`
 * and excluded from normal search results. The data is not deleted — a future
 * restore tool or the MemoryPanel can un-archive it.
 *
 * Returns a success response when done. Errors if the id doesn't exist.
 */
export async function handleMemoryArchive(
  ctx: SessionToolContext,
  args: MemoryArchiveArgs,
): Promise<ToolResult> {
  if (!ctx.callbacks?.getMemoryRepository) {
    return errorResponse('memory_archive is not available in this context.');
  }

  const parsed = MemoryArchiveSchema.safeParse(args);
  if (!parsed.success) {
    return errorResponse(
      'memory_archive received invalid args: ' + (parsed.error.issues[0]?.message ?? 'unknown'),
    );
  }

  const id = parsed.data.id.trim();
  if (!id) {
    return errorResponse('memory_archive requires a non-empty `id` parameter.');
  }

  try {
    const repo: MemoryRepository = await ctx.callbacks.getMemoryRepository();
    const archived = repo.archiveMemory(id);
    return successResponse(
      `Memory archived: "${archived.title}" (id=${archived.id}, class=${archived.class})`,
      {
        id: archived.id,
        class: archived.class,
        title: archived.title,
      },
    );
  } catch (e: any) {
    if (e?.message?.includes?.('not found')) {
      return errorResponse(`Memory "${id}" not found. Use memory_search to find candidates.`);
    }
    const message = e instanceof Error ? e.message : String(e);
    return errorResponse(`memory_archive failed: ${message}`);
  }
}
