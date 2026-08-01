import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';
import type { AnyMemory } from '@archstudio/shared/memory/types.ts';
import type { MemoryRepository } from '@archstudio/shared/memory/repository.ts';
import { MemoryRecallSchema } from './memory-schemas.ts';

/**
 * `memory_recall` parameters — hydrate a memory found via `memory_search`
 * into the agent's full context window.
 */
export interface MemoryRecallArgs {
  id: string;
}

const HARD_CAP = 4096;
const SNIPPET_MAX = 280;

/**
 * Per-class snippet extractor so memories of any class surface meaningful
 * text in `structuredContent.snippet` instead of silently dropping to ""
 * for episodic/procedural/profile variants whose primary fields differ.
 */
function summarizeForSnippet(memory: AnyMemory, max: number): string {
  const cls = memory.class;
  const any = memory as unknown as Record<string, unknown>;
  let raw = '';
  switch (cls) {
    // ProfileMemory has `key` + `previousValues` (not attributes/summary).
    case 'profile':
      raw = `${String(any.key ?? '')}: ${String(any.content ?? '')}`;
      break;
    case 'semantic':
      raw = String(any.text ?? any.summary ?? any.content ?? '');
      break;
    case 'episodic':
      raw = String(
        any.outcome ??
          any.summary ??
          ((any.decisions as string[] | undefined) ?? []).join('; '),
      );
      break;
    case 'procedural':
      raw = String(((any.steps as string[] | undefined) ?? []).join('\n') ?? any.summary ?? '');
      break;
    default:
      raw = String(any.summary ?? any.text ?? '');
      break;
  }
  return raw.replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Hydrate a memory by id and return the full `AnyMemory` JSON for the agent
 * to inspect. Use after `memory_search` returns candidate ids.
 *
 * The output is bounded by `HARD_CAP` (4 KB) so a ReAct loop won't blow its
 * context budget hydrating a single large semantic memory; a structured
 * summary alongside the truncated text lets downstream consumers (panel
 * UIs, log replay, etc.) keep working without parsing free-form text.
 */
export async function handleMemoryRecall(
  ctx: SessionToolContext,
  args: MemoryRecallArgs,
): Promise<ToolResult> {
  if (!ctx.callbacks?.getMemoryRepository) {
    return errorResponse('memory_recall is not available in this context.');
  }
  const parsed = MemoryRecallSchema.safeParse(args);
  if (!parsed.success) {
    return errorResponse(
      'memory_recall received invalid args: ' + (parsed.error.issues[0]?.message ?? 'unknown'),
    );
  }
  const id = parsed.data.id.trim();
  if (!id) {
    return errorResponse('memory_recall requires a non-empty `id` parameter.');
  }
  try {
    const repo: MemoryRepository = await ctx.callbacks.getMemoryRepository();
    const memory = await repo.getMemory(id);
    if (!memory) {
      return {
        content: [
          {
            type: 'text',
            text: `Memory "${id}" not found. It may be archived or never imported. Use memory_search to find candidates.`,
          },
        ],
        isError: true,
      };
    }
    const serialized = JSON.stringify(memory, null, 2);
    const truncated =
      serialized.length <= HARD_CAP
        ? serialized
        : serialized.slice(0, HARD_CAP) + '\n  // truncated -- call memory_recall again with a narrower id if you need the full text';
    const summary = {
      id: memory.id,
      class: memory.class,
      title: memory.title,
      snippet: summarizeForSnippet(memory, SNIPPET_MAX),
      confidence: (memory as unknown as { confidence?: number | null }).confidence ?? null,
      tags: (memory as unknown as { tags?: string[] }).tags ?? [],
      truncated: serialized.length > HARD_CAP,
    };
    return successResponse(truncated, summary);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return errorResponse(`memory_recall failed: ${message}`);
  }
}
