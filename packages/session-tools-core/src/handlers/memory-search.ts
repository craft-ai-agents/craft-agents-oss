import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';
import type { MemoryQuery, MemorySearchResult } from '@archstudio/shared/memory/types.ts';
import type { MemoryRepository } from '@archstudio/shared/memory/repository.ts';
import { MemorySearchSchema } from './memory-schemas.ts';

/**
 * `memory_search` parameters — called by the agent to discover memories.
 *
 * - `query` is required and is fed to FTS5 (server-side bm25 ranking).
 * - `class`, `scopeId` are optional filters that narrow the result set.
 * - `limit` defaults to 10 and is clamped server-side to [1, 50].
 */
export interface MemorySearchArgs {
  query: string;
  class?: 'profile' | 'semantic' | 'episodic' | 'procedural';
  scopeId?: string;
  limit?: number;
}

const SNIPPET_MAX = 280;
const LIMIT_MIN = 1;
const LIMIT_MAX = 50;
const LIMIT_DEFAULT = 10;
const MIN_QUERY_LEN = 2;

/**
 * Search the user's memory store via FTS5 and emit the top hits as a markdown
 * bullet list (for direct LLM ingestion) AND a structured payload (for
 * MemoryPanel/long-lived consumer UI). Pair with `memory_recall(id)` once
 * the agent has picked a candidate from the result set.
 */
export async function handleMemorySearch(
  ctx: SessionToolContext,
  args: MemorySearchArgs,
): Promise<ToolResult> {
  if (!ctx.callbacks?.getMemoryRepository) {
    return errorResponse('memory_search is not available in this context.');
  }
  const parsed = MemorySearchSchema.safeParse(args);
  if (!parsed.success) {
    return errorResponse(
      'memory_search received invalid args: ' + (parsed.error.issues[0]?.message ?? 'unknown'),
    );
  }
  const a = parsed.data;
  const queryText = a.query.trim();
  if (queryText.length < MIN_QUERY_LEN) {
    return errorResponse(
      `"${queryText}" is too short for FTS5 ranking. Use at least ${MIN_QUERY_LEN} characters.`,
    );
  }
  try {
    const repo: MemoryRepository = await ctx.callbacks.getMemoryRepository();
    const limit = Math.min(Math.max(a.limit ?? LIMIT_DEFAULT, LIMIT_MIN), LIMIT_MAX);
    const dbQuery: MemoryQuery = {
      query: queryText,
      limit,
      ...(a.class ? { class: a.class } : {}),
      ...(a.scopeId ? { scopeId: a.scopeId } : {}),
    };
    const hits: MemorySearchResult[] = await repo.searchMemories(dbQuery);

    if (hits.length === 0) {
      return successResponse(
        `No memories matched "${queryText}". Try a broader query or remove filters.`,
        { query: queryText, hits: [] as Array<Record<string, unknown>> },
      );
    }

    const lines: string[] = [
      `${hits.length} memor${hits.length === 1 ? 'y' : 'ies'} matched "${queryText}":`,
    ];
    for (const h of hits) {
      const tail = h.snippet
        ? ` -- ${h.snippet.slice(0, SNIPPET_MAX).replace(/\s+/g, ' ').trim()}`
        : '';
      lines.push(
        `- ${h.memory.title} (id=${h.memory.id}, class=${h.memory.class}, score=${h.score.toFixed(2)})${tail}`,
      );
    }
    return successResponse(lines.join('\n'), {
      query: queryText,
      hits: hits.map((h) => ({
        id: h.memory.id,
        title: h.memory.title,
        class: h.memory.class,
        score: Number(h.score.toFixed(3)),
        snippet: (h.snippet ?? '').slice(0, SNIPPET_MAX),
      })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return errorResponse(`memory_search failed: ${message}`);
  }
}
