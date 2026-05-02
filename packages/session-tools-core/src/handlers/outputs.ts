import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse } from '../response.ts';

export type OutputKind =
  | 'report'
  | 'document'
  | 'image'
  | 'video'
  | 'audio'
  | 'dataset'
  | 'code'
  | 'receipt'
  | 'external-action'
  | 'collection'
  | 'other';

export type OutputAssetRole = 'primary' | 'supporting' | 'source' | 'thumbnail' | 'attachment';

export interface CreateOutputFileInput {
  path: string;
  label?: string;
  role?: OutputAssetRole;
}

export interface CreateOutputLinkInput {
  label: string;
  url: string;
  role?: 'primary' | 'source' | 'related' | 'external';
}

export interface CreateOutputReceiptInput {
  provider: string;
  action: string;
  status: 'succeeded' | 'failed' | 'pending';
  externalId?: string;
  url?: string;
  displayText?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateOutputToolInput {
  title: string;
  kind: OutputKind;
  summary: string;
  content?: string;
  contentMimeType?: 'text/markdown' | 'text/plain' | 'application/json';
  files?: CreateOutputFileInput[];
  links?: CreateOutputLinkInput[];
  receipts?: CreateOutputReceiptInput[];
  tags?: string[];
}

export interface CreateOutputResult {
  ok: boolean;
  outputId?: string;
  route?: string;
  file?: string;
  error?: string;
}

const OUTPUT_KINDS: ReadonlySet<string> = new Set([
  'report',
  'document',
  'image',
  'video',
  'audio',
  'dataset',
  'code',
  'receipt',
  'external-action',
  'collection',
  'other',
]);

const CONTENT_MIME_TYPES: ReadonlySet<string> = new Set([
  'text/markdown',
  'text/plain',
  'application/json',
]);

function validateString(value: unknown, field: string): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return `${field} is required and cannot be empty.`;
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateUrl(value: string, field: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return `${field} must be an http(s) URL.`;
    return null;
  } catch {
    return `${field} must be a valid URL.`;
  }
}

function validateOutputInput(args: CreateOutputToolInput): string | null {
  const titleError = validateString(args.title, 'title');
  if (titleError) return titleError;
  const summaryError = validateString(args.summary, 'summary');
  if (summaryError) return summaryError;
  if (!OUTPUT_KINDS.has(args.kind)) return `kind must be one of: ${Array.from(OUTPUT_KINDS).join(', ')}.`;
  if (args.content !== undefined && typeof args.content !== 'string') return 'content must be a string when provided.';
  if (args.contentMimeType !== undefined && !CONTENT_MIME_TYPES.has(args.contentMimeType)) {
    return 'contentMimeType must be one of: text/markdown, text/plain, application/json.';
  }
  if (args.contentMimeType === 'application/json' && args.content !== undefined) {
    try {
      JSON.parse(args.content);
    } catch {
      return 'content must be valid JSON when contentMimeType is application/json.';
    }
  }
  if (args.files !== undefined) {
    if (!Array.isArray(args.files)) return 'files must be an array when provided.';
    for (const [index, file] of args.files.entries()) {
      if (!isRecord(file)) return `files[${index}] must be an object.`;
      const pathError = validateString(file.path, `files[${index}].path`);
      if (pathError) return pathError;
      if (file.label !== undefined && typeof file.label !== 'string') return `files[${index}].label must be a string.`;
      if (file.role !== undefined && !['primary', 'supporting', 'source', 'thumbnail', 'attachment'].includes(String(file.role))) {
        return `files[${index}].role is unsupported.`;
      }
    }
  }
  if (args.links !== undefined) {
    if (!Array.isArray(args.links)) return 'links must be an array when provided.';
    for (const [index, link] of args.links.entries()) {
      if (!isRecord(link)) return `links[${index}] must be an object.`;
      const labelError = validateString(link.label, `links[${index}].label`);
      if (labelError) return labelError;
      const urlError = validateString(link.url, `links[${index}].url`) ?? validateUrl(String(link.url), `links[${index}].url`);
      if (urlError) return urlError;
    }
  }
  if (args.receipts !== undefined) {
    if (!Array.isArray(args.receipts)) return 'receipts must be an array when provided.';
    for (const [index, receipt] of args.receipts.entries()) {
      if (!isRecord(receipt)) return `receipts[${index}] must be an object.`;
      const providerError = validateString(receipt.provider, `receipts[${index}].provider`);
      if (providerError) return providerError;
      const actionError = validateString(receipt.action, `receipts[${index}].action`);
      if (actionError) return actionError;
      if (!['succeeded', 'failed', 'pending'].includes(String(receipt.status))) return `receipts[${index}].status is unsupported.`;
      if (receipt.url !== undefined) {
        const urlError = validateUrl(String(receipt.url), `receipts[${index}].url`);
        if (urlError) return urlError;
      }
    }
  }
  if (args.tags !== undefined && (!Array.isArray(args.tags) || args.tags.some((tag) => typeof tag !== 'string'))) {
    return 'tags must be an array of strings when provided.';
  }
  return null;
}

export async function handleCreateOutput(
  ctx: SessionToolContext,
  args: CreateOutputToolInput,
): Promise<ToolResult> {
  if (!ctx.createOutput) {
    return errorResponse('create_output is not available in this context.');
  }

  const validationError = validateOutputInput(args);
  if (validationError) return errorResponse(validationError);

  const input: CreateOutputToolInput = {
    ...args,
    title: args.title.trim(),
    summary: args.summary.trim(),
  };

  try {
    const result = await ctx.createOutput(input);
    if (!result.ok) return errorResponse(result.error ?? 'Failed to create output.');
    const outputId = result.outputId ?? 'unknown';
    const route = result.route ?? (result.outputId ? `/outputs/${result.outputId}` : undefined);
    const text = route
      ? `Created output "${input.title}" at ${route}.`
      : `Created output "${input.title}".`;
    return {
      content: [{ type: 'text', text }],
      structuredContent: {
        ok: true,
        outputId,
        route,
        file: result.file,
      },
      isError: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(`Failed to create output: ${message}`);
  }
}
