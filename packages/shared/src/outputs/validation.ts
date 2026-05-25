import { basename, isAbsolute, relative, resolve } from 'node:path';
import type {
  OutputAsset,
  OutputAssetRole,
  OutputKind,
  OutputLink,
  OutputManifest,
  OutputOrigin,
  OutputPreview,
  OutputPreviewMode,
  OutputReceipt,
  OutputStatus,
} from './types.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OUTPUT_KINDS: ReadonlySet<OutputKind> = new Set([
  'report',
  'document',
  'image',
  'video',
  'audio',
  'dataset',
  'code',
  'model',
  'receipt',
  'external-action',
  'collection',
  'other',
]);
const OUTPUT_STATUSES: ReadonlySet<OutputStatus> = new Set(['draft', 'published', 'failed', 'cancelled']);
const ASSET_ROLES: ReadonlySet<OutputAssetRole> = new Set([
  'primary',
  'supporting',
  'source',
  'thumbnail',
  'attachment',
]);
const RECEIPT_STATUSES = new Set(['succeeded', 'failed', 'pending']);
const LINK_ROLES = new Set(['primary', 'source', 'related', 'external']);
const ORIGIN_SOURCES = new Set(['workflow', 'session', 'automation', 'manual']);
const PREVIEW_MODES: ReadonlySet<OutputPreviewMode> = new Set([
  'markdown',
  'text',
  'json',
  'image',
  'video',
  'audio',
  'model',
  'pdf',
  'excalidraw',
  'presentation',
  'table',
  'chart',
  'workflow',
  'receipt',
  'external-link',
  'web',
]);

export function isValidOutputId(outputId: string): boolean {
  return UUID_REGEX.test(outputId);
}

export function assertValidOutputId(outputId: string): void {
  if (!isValidOutputId(outputId)) {
    throw new Error(`Invalid output id: ${outputId}`);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isContainedPath(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function isSafeRelativeAssetPath(assetPath: string): boolean {
  if (!assetPath || assetPath.includes('\0') || isAbsolute(assetPath)) return false;
  const base = resolve('/output-bundle');
  const resolved = resolve(base, assetPath);
  return isContainedPath(base, resolved) && basename(assetPath) !== '';
}

export function isIsoDateString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isUrlString(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isOutputOrigin(value: unknown): value is OutputOrigin {
  if (!isRecord(value)) return false;
  if (typeof value.source !== 'string' || !ORIGIN_SOURCES.has(value.source)) return false;
  for (const field of [
    'workflowRunId',
    'workflowSlug',
    'workflowName',
    'stepId',
    'sessionId',
    'agentSlug',
    'agentName',
    'automationId',
  ] as const) {
    if (!isOptionalString(value[field])) return false;
  }
  return true;
}

function isOutputAsset(value: unknown): value is OutputAsset {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || !value.id) return false;
  if (typeof value.label !== 'string' || !value.label) return false;
  if (typeof value.role !== 'string' || !ASSET_ROLES.has(value.role as OutputAssetRole)) return false;
  if (typeof value.path !== 'string' || !value.path || value.path.includes('\0')) return false;
  if (!isOptionalString(value.mimeType)) return false;
  if (value.sizeBytes !== undefined) {
    if (typeof value.sizeBytes !== 'number' || !Number.isInteger(value.sizeBytes) || value.sizeBytes < 0) return false;
  }
  if (!isOptionalString(value.sha256)) return false;
  return true;
}

function isOutputReceipt(value: unknown): value is OutputReceipt {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || !value.id) return false;
  if (typeof value.provider !== 'string' || !value.provider) return false;
  if (typeof value.action !== 'string' || !value.action) return false;
  if (typeof value.status !== 'string' || !RECEIPT_STATUSES.has(value.status)) return false;
  if (!isIsoDateString(value.occurredAt)) return false;
  if (!isOptionalString(value.externalId)) return false;
  if (value.url !== undefined && !isUrlString(value.url)) return false;
  if (!isOptionalString(value.displayText)) return false;
  if (value.metadata !== undefined && !isRecord(value.metadata)) return false;
  return true;
}

function isOutputLink(value: unknown): value is OutputLink {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || !value.id) return false;
  if (typeof value.label !== 'string' || !value.label) return false;
  if (!isUrlString(value.url)) return false;
  if (value.role !== undefined && (typeof value.role !== 'string' || !LINK_ROLES.has(value.role))) return false;
  return true;
}

function isOutputPreview(value: unknown, assetIds: ReadonlySet<string>): value is OutputPreview {
  if (!isRecord(value)) return false;
  if (typeof value.mode !== 'string' || !PREVIEW_MODES.has(value.mode as OutputPreviewMode)) return false;
  if (value.assetId !== undefined) {
    if (typeof value.assetId !== 'string' || !assetIds.has(value.assetId)) return false;
  }
  if (!isOptionalString(value.inlineText)) return false;
  return true;
}

export function isOutputManifest(value: unknown, expectedOutputId?: string): value is OutputManifest {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== 1) return false;
  if (typeof value.id !== 'string' || !isValidOutputId(value.id)) return false;
  if (expectedOutputId !== undefined && value.id !== expectedOutputId) return false;
  if (typeof value.workspaceId !== 'string' || !value.workspaceId) return false;
  if (typeof value.title !== 'string' || !value.title) return false;
  if (typeof value.slug !== 'string' || !value.slug) return false;
  if (typeof value.kind !== 'string' || !OUTPUT_KINDS.has(value.kind as OutputKind)) return false;
  if (typeof value.status !== 'string' || !OUTPUT_STATUSES.has(value.status as OutputStatus)) return false;
  if (typeof value.summary !== 'string') return false;
  if (!isIsoDateString(value.createdAt) || !isIsoDateString(value.updatedAt)) return false;
  if (value.completedAt !== undefined && !isIsoDateString(value.completedAt)) return false;
  if (!isOutputOrigin(value.origin)) return false;
  if (!Array.isArray(value.assets) || !value.assets.every(isOutputAsset)) return false;
  if (!Array.isArray(value.receipts) || !value.receipts.every(isOutputReceipt)) return false;
  if (!Array.isArray(value.links) || !value.links.every(isOutputLink)) return false;

  const assetIds = new Set<string>();
  for (const asset of value.assets) {
    if (assetIds.has(asset.id)) return false;
    assetIds.add(asset.id);
  }

  if (value.primary !== undefined) {
    if (!isOutputAsset(value.primary)) return false;
    if (!assetIds.has(value.primary.id)) return false;
  }
  if (value.preview !== undefined && !isOutputPreview(value.preview, assetIds)) return false;
  if (value.tags !== undefined && !isStringArray(value.tags)) return false;
  return true;
}

export function assertOutputManifest(value: unknown, expectedOutputId?: string): asserts value is OutputManifest {
  if (!isOutputManifest(value, expectedOutputId)) {
    const suffix = expectedOutputId ? `: ${expectedOutputId}` : '';
    throw new Error(`Invalid output manifest${suffix}`);
  }
}
