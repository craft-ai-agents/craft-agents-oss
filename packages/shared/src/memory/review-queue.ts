import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import {
  GLOBAL_AGENTS_ROOT,
  isValidAgentSlug,
  isValidIsoDate,
  isValidMemoryEntryType,
} from './storage.ts';
import {
  MEMORY_REVIEW_QUEUE_FILE,
  type EnqueueMemoryReviewInput,
  type MemoryReviewItem,
  type MemoryReviewStatus,
  type MemoryStorageOptions,
  type ResolveMemoryReviewInput,
} from './types.ts';

export function getMemoryReviewQueueFile(options?: MemoryStorageOptions): string {
  return join(options?.globalAgentsDir ?? GLOBAL_AGENTS_ROOT, MEMORY_REVIEW_QUEUE_FILE);
}

export function listMemoryReviewItems(options?: MemoryStorageOptions): MemoryReviewItem[] {
  const file = getMemoryReviewQueueFile(options);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isMemoryReviewItem);
  } catch {
    return [];
  }
}

export function enqueueMemoryReviewItem(
  input: EnqueueMemoryReviewInput,
  options?: MemoryStorageOptions,
): MemoryReviewItem {
  validateEnqueueInput(input);
  const items = listMemoryReviewItems(options);
  const item: MemoryReviewItem = {
    id: randomUUID(),
    status: 'pending',
    action: input.action,
    scope: input.scope,
    agentSlug: input.scope === 'agent' ? input.agentSlug : undefined,
    name: input.name.trim(),
    type: input.type,
    body: sanitizeOptional(input.body),
    expires: input.expires ?? undefined,
    confidence: input.confidence,
    evidence: sanitizeOptional(input.evidence),
    sourceRunId: sanitizeOptional(input.sourceRunId),
    source: input.source ?? 'sidecar',
    createdAt: new Date().toISOString(),
  };
  writeReviewQueue([...items, item], options);
  return item;
}

export function resolveMemoryReviewItem(
  input: ResolveMemoryReviewInput,
  options?: MemoryStorageOptions,
): MemoryReviewItem | null {
  const id = input.id.trim();
  if (!id) throw new Error('review item id is required');
  if (!isResolvedStatus(input.status)) throw new Error('review status must be approved, rejected, or applied');

  const items = listMemoryReviewItems(options);
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return null;

  const next: MemoryReviewItem = {
    ...items[index]!,
    status: input.status,
    decidedAt: new Date().toISOString(),
    decisionReason: sanitizeOptional(input.decisionReason),
  };
  items[index] = next;
  writeReviewQueue(items, options);
  return next;
}

function validateEnqueueInput(input: EnqueueMemoryReviewInput): void {
  if (!['save', 'update', 'forget'].includes(input.action)) {
    throw new Error('review action must be save, update, or forget');
  }
  if (!['user', 'agent'].includes(input.scope)) {
    throw new Error('review scope must be user or agent');
  }
  if (input.scope === 'agent' && (!input.agentSlug || !isValidAgentSlug(input.agentSlug))) {
    throw new Error('agentSlug is required for agent memory review items');
  }
  if (!input.name.trim()) throw new Error('review item name is required');
  if (input.action !== 'forget') {
    if (!input.type || !isValidMemoryEntryType(input.type)) {
      throw new Error('review item type is required for save/update');
    }
    if (!input.body?.trim()) {
      throw new Error('review item body is required for save/update');
    }
  }
  if (typeof input.confidence !== 'number' || input.confidence < 0 || input.confidence > 1) {
    throw new Error('review item confidence must be between 0 and 1');
  }
  if (typeof input.expires === 'string' && input.expires !== '' && !isValidIsoDate(input.expires)) {
    throw new Error('review item expires must be an ISO date (YYYY-MM-DD)');
  }
}

function writeReviewQueue(items: MemoryReviewItem[], options?: MemoryStorageOptions): void {
  writeFileAtomic(getMemoryReviewQueueFile(options), JSON.stringify(items, null, 2) + '\n');
}

function writeFileAtomic(finalPath: string, data: string): void {
  mkdirSync(dirname(finalPath), { recursive: true });
  const tmpPath = `${finalPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmpPath, data, 'utf-8');
    renameSync(tmpPath, finalPath);
  } catch (err) {
    try { rmSync(tmpPath, { force: true }); } catch { /* ignore */ }
    throw err;
  }
}

function sanitizeOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isResolvedStatus(status: MemoryReviewStatus): status is Exclude<MemoryReviewStatus, 'pending'> {
  return status === 'approved' || status === 'rejected' || status === 'applied';
}

function isMemoryReviewItem(value: unknown): value is MemoryReviewItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<MemoryReviewItem>;
  return (
    typeof item.id === 'string' &&
    ['pending', 'approved', 'rejected', 'applied'].includes(item.status ?? '') &&
    ['save', 'update', 'forget'].includes(item.action ?? '') &&
    ['user', 'agent'].includes(item.scope ?? '') &&
    typeof item.name === 'string' &&
    typeof item.confidence === 'number' &&
    typeof item.source === 'string' &&
    typeof item.createdAt === 'string'
  );
}
