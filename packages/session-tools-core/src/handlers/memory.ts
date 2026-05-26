import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse } from '../response.ts';

export type MemoryScope = 'agent' | 'user';
export type MemoryType = 'user' | 'feedback' | 'project' | 'reference';

export interface SaveMemoryToolInput {
  scope?: MemoryScope;
  name: string;
  type: MemoryType;
  content: string;
  expires?: string;
}

export interface UpdateMemoryToolInput {
  scope?: MemoryScope;
  name: string;
  content?: string;
  expires?: string | null;
}

export interface ForgetMemoryToolInput {
  scope?: MemoryScope;
  name: string;
}

export interface RecallMemoryToolInput {
  query: string;
  scopes?: MemoryScope[];
  limit?: number;
}

export interface MemoryMutationResult {
  ok: boolean;
  scope?: MemoryScope;
  name?: string;
  file?: string;
  error?: string;
}

export interface RecalledMemoryEntry {
  scope: MemoryScope;
  agentSlug?: string;
  name: string;
  type: MemoryType;
  content: string;
  score: number;
  reason: string;
  excerpt: string;
}

export interface RecallMemoryResult {
  ok: boolean;
  query?: string;
  results?: RecalledMemoryEntry[];
  error?: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MEMORY_TYPES: ReadonlySet<string> = new Set(['user', 'feedback', 'project', 'reference']);

function normalizeScope(scope: MemoryScope | undefined): MemoryScope {
  return scope ?? 'agent';
}

function validateScope(scope: unknown): string | null {
  if (scope === undefined || scope === 'agent' || scope === 'user') return null;
  return 'scope must be "agent" or "user".';
}

function validateScopes(scopes: unknown): string | null {
  if (scopes === undefined) return null;
  if (!Array.isArray(scopes) || scopes.length === 0) {
    return 'scopes must be a non-empty array of "agent" and/or "user".';
  }
  for (const scope of scopes) {
    const error = validateScope(scope);
    if (error) return error;
  }
  return null;
}

function validateName(name: unknown): string | null {
  if (typeof name !== 'string' || name.trim().length === 0) {
    return 'name is required and cannot be empty.';
  }
  if (name.trim().length > 128) {
    return 'name must be 128 characters or fewer.';
  }
  if (/[\r\n]/.test(name)) {
    return 'name must be a single line.';
  }
  return null;
}

function validateExpires(expires: unknown): string | null {
  if (expires === undefined || expires === null) return null;
  if (typeof expires !== 'string' || !ISO_DATE_RE.test(expires)) {
    return 'expires must be an ISO date in YYYY-MM-DD format, or null when supported.';
  }
  return null;
}

function memorySuccess(message: string, structuredContent: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: 'text', text: message }],
    structuredContent,
    isError: false,
  };
}

function memoryPayload(result: {
  ok: true;
  scope: MemoryScope;
  name: string;
  file?: string;
}): Record<string, unknown> {
  return result.file
    ? { ok: result.ok, scope: result.scope, name: result.name, file: result.file }
    : { ok: result.ok, scope: result.scope, name: result.name };
}

function normalizeLimit(limit: unknown): number | undefined {
  if (limit === undefined) return undefined;
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return Number.NaN;
  return Math.floor(limit);
}

export async function handleSaveMemory(
  ctx: SessionToolContext,
  args: SaveMemoryToolInput,
): Promise<ToolResult> {
  if (!ctx.saveMemory) {
    return errorResponse('save_memory is not available in this context.');
  }

  const scopeError = validateScope(args.scope);
  if (scopeError) return errorResponse(scopeError);
  const nameError = validateName(args.name);
  if (nameError) return errorResponse(nameError);
  if (!MEMORY_TYPES.has(args.type)) {
    return errorResponse('type must be one of: user, feedback, project, reference.');
  }
  if (typeof args.content !== 'string' || args.content.trim().length === 0) {
    return errorResponse('content is required and cannot be empty.');
  }
  const expiresError = validateExpires(args.expires);
  if (expiresError) return errorResponse(expiresError);

  const input = { ...args, name: args.name.trim(), scope: normalizeScope(args.scope) };

  try {
    const result = await ctx.saveMemory(input);
    if (!result.ok) {
      return errorResponse(result.error ?? 'Failed to save memory.');
    }
    const savedName = result.name ?? input.name;
    const savedScope = result.scope ?? input.scope;
    const fileText = result.file ? ` in ${result.file}` : '';
    return memorySuccess(
      `Saved ${savedScope} memory "${savedName}"${fileText}.`,
      memoryPayload({ ok: true, scope: savedScope, name: savedName, file: result.file }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(`Failed to save memory: ${message}`);
  }
}

export async function handleUpdateMemory(
  ctx: SessionToolContext,
  args: UpdateMemoryToolInput,
): Promise<ToolResult> {
  if (!ctx.updateMemory) {
    return errorResponse('update_memory is not available in this context.');
  }

  const scopeError = validateScope(args.scope);
  if (scopeError) return errorResponse(scopeError);
  const nameError = validateName(args.name);
  if (nameError) return errorResponse(nameError);
  if (args.content !== undefined && (typeof args.content !== 'string' || args.content.trim().length === 0)) {
    return errorResponse('content, when provided, cannot be empty.');
  }
  if (args.content === undefined && args.expires === undefined) {
    return errorResponse('Provide content, expires, or both. Pass expires: null to clear an existing expiration.');
  }
  const expiresError = validateExpires(args.expires);
  if (expiresError) return errorResponse(expiresError);

  const input = { ...args, name: args.name.trim(), scope: normalizeScope(args.scope) };

  try {
    const result = await ctx.updateMemory(input);
    if (!result.ok) {
      return errorResponse(result.error ?? 'Failed to update memory.');
    }
    const updatedName = result.name ?? input.name;
    const updatedScope = result.scope ?? input.scope;
    return memorySuccess(
      `Updated ${updatedScope} memory "${updatedName}".`,
      memoryPayload({ ok: true, scope: updatedScope, name: updatedName, file: result.file }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(`Failed to update memory: ${message}`);
  }
}

export async function handleForgetMemory(
  ctx: SessionToolContext,
  args: ForgetMemoryToolInput,
): Promise<ToolResult> {
  if (!ctx.forgetMemory) {
    return errorResponse('forget_memory is not available in this context.');
  }

  const scopeError = validateScope(args.scope);
  if (scopeError) return errorResponse(scopeError);
  const nameError = validateName(args.name);
  if (nameError) return errorResponse(nameError);

  const input = { ...args, name: args.name.trim(), scope: normalizeScope(args.scope) };

  try {
    const result = await ctx.forgetMemory(input);
    if (!result.ok) {
      return errorResponse(result.error ?? 'Failed to forget memory.');
    }
    const forgottenName = result.name ?? input.name;
    const forgottenScope = result.scope ?? input.scope;
    return memorySuccess(
      `Forgot ${forgottenScope} memory "${forgottenName}".`,
      memoryPayload({ ok: true, scope: forgottenScope, name: forgottenName, file: result.file }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(`Failed to forget memory: ${message}`);
  }
}

export async function handleRecallMemory(
  ctx: SessionToolContext,
  args: RecallMemoryToolInput,
): Promise<ToolResult> {
  if (!ctx.recallMemory) {
    return errorResponse('recall_memory is not available in this context.');
  }

  if (typeof args.query !== 'string' || args.query.trim().length === 0) {
    return errorResponse('query is required and cannot be empty.');
  }
  const scopesError = validateScopes(args.scopes);
  if (scopesError) return errorResponse(scopesError);
  const limit = normalizeLimit(args.limit);
  if (Number.isNaN(limit) || (limit !== undefined && (limit < 1 || limit > 25))) {
    return errorResponse('limit must be a number between 1 and 25.');
  }

  const input: RecallMemoryToolInput = {
    query: args.query.trim(),
    scopes: args.scopes,
    limit,
  };

  try {
    const result = await ctx.recallMemory(input);
    if (!result.ok) {
      return errorResponse(result.error ?? 'Failed to recall memory.');
    }
    const entries = result.results ?? [];
    return memorySuccess(
      entries.length === 0
        ? `No matching memories for "${input.query}".`
        : `Recalled ${entries.length} memories for "${input.query}".`,
      {
        ok: true,
        query: result.query ?? input.query,
        results: entries,
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(`Failed to recall memory: ${message}`);
  }
}
