import type {
  BulkUpdateSessionsPatch,
  BulkUpdateSessionsResult,
} from '@craft-agent/shared/protocol'
import { resolveBulkLabels } from '@craft-agent/shared/sessions/collection'
import type { SessionMeta } from '@/atoms/sessions'

const COLLECTION_META_FIELDS = [
  'sessionStatus',
  'priority',
  'dueDate',
  'projectId',
  'labels',
  'isFlagged',
  'isArchived',
  'kanbanColumn',
] as const

type CollectionMetaField = (typeof COLLECTION_META_FIELDS)[number]
type CollectionMetaPatch = Pick<SessionMeta, CollectionMetaField>

export interface VisibleBulkSelectionSnapshot {
  /** Eligible targets in the exact order currently rendered by the host. */
  ids: readonly string[]
  /** Accessible count bound to the local action acceptance. */
  count: number
}

export interface CollectionBulkMetaSnapshot {
  affectedFields: readonly CollectionMetaField[]
  before: CollectionMetaPatch
  optimistic: CollectionMetaPatch
}

export interface OptimisticCollectionBulkOperation {
  readonly id: number
  readonly targetIds: readonly string[]
  readonly snapshotsById: ReadonlyMap<string, CollectionBulkMetaSnapshot>
}

export type BulkOutcomeAssessment =
  | {
      valid: true
      okIds: readonly string[]
      failedIds: readonly string[]
    }
  | {
      valid: false
      reason: 'bulk_outcome_malformed'
    }

/** Bind selection and disclosed count to one flattened visible-ID order. */
export function snapshotVisibleEligibleSelection(
  selectedIds: ReadonlySet<string>,
  visibleSessionIds: readonly string[],
): VisibleBulkSelectionSnapshot {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const id of visibleSessionIds) {
    if (!selectedIds.has(id) || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return { ids, count: ids.length }
}

function collectionPatchForMeta(
  meta: SessionMeta,
  patch: BulkUpdateSessionsPatch,
): Partial<CollectionMetaPatch> {
  const next: Partial<CollectionMetaPatch> = {}
  if (patch.sessionStatus !== undefined) next.sessionStatus = patch.sessionStatus
  if (patch.priority !== undefined) next.priority = patch.priority
  if (patch.dueDate !== undefined) next.dueDate = patch.dueDate
  if (patch.projectId !== undefined) next.projectId = patch.projectId ?? undefined

  const labels = resolveBulkLabels(meta.labels, patch)
  if (labels !== undefined) next.labels = labels

  if (patch.isFlagged !== undefined) next.isFlagged = patch.isFlagged
  if (patch.isArchived !== undefined) next.isArchived = patch.isArchived
  if (patch.kanbanColumn !== undefined) next.kanbanColumn = patch.kanbanColumn ?? undefined
  return next
}

function collectionSnapshot(meta: SessionMeta): CollectionMetaPatch {
  return {
    sessionStatus: meta.sessionStatus,
    priority: meta.priority,
    dueDate: meta.dueDate,
    projectId: meta.projectId,
    labels: meta.labels,
    isFlagged: meta.isFlagged,
    isArchived: meta.isArchived,
    kanbanColumn: meta.kanbanColumn,
  }
}

/** Capture exact pre-mutation fields and immutable optimistic projections. */
export function createOptimisticCollectionBulkOperation(
  id: number,
  metaMap: ReadonlyMap<string, SessionMeta>,
  targetIds: readonly string[],
  patch: BulkUpdateSessionsPatch,
): OptimisticCollectionBulkOperation | null {
  const snapshotsById = new Map<string, CollectionBulkMetaSnapshot>()
  const seen = new Set<string>()

  for (const sessionId of targetIds) {
    if (seen.has(sessionId)) return null
    seen.add(sessionId)
    const meta = metaMap.get(sessionId)
    if (!meta) return null

    const before = collectionSnapshot(meta)
    const metaPatch = collectionPatchForMeta(meta, patch)
    snapshotsById.set(sessionId, {
      affectedFields: Object.keys(metaPatch) as CollectionMetaField[],
      before,
      optimistic: { ...before, ...metaPatch },
    })
  }

  return { id, targetIds: [...targetIds], snapshotsById }
}

/** Apply every target projection in one immutable metadata-map write. */
export function applyOptimisticCollectionBulkOperation(
  metaMap: ReadonlyMap<string, SessionMeta>,
  operation: OptimisticCollectionBulkOperation,
): Map<string, SessionMeta> {
  const next = new Map(metaMap)
  for (const [sessionId, snapshot] of operation.snapshotsById) {
    const current = next.get(sessionId)
    if (!current) continue
    next.set(sessionId, { ...current, ...snapshot.optimistic })
  }
  return next
}

/**
 * Restore only a proven failed operation's affected fields. Any replacement of
 * the optimistic record is authoritative and blocks stale rollback.
 */
export function rollbackMatchingCollectionBulkOperation(
  current: SessionMeta,
  snapshot: CollectionBulkMetaSnapshot,
  expectedOptimisticMeta: SessionMeta,
): Partial<CollectionMetaPatch> {
  if (current !== expectedOptimisticMeta) return {}

  const rollback: Partial<CollectionMetaPatch> = {}
  for (const field of snapshot.affectedFields) {
    switch (field) {
      case 'sessionStatus':
        rollback.sessionStatus = snapshot.before.sessionStatus
        break
      case 'priority':
        rollback.priority = snapshot.before.priority
        break
      case 'dueDate':
        rollback.dueDate = snapshot.before.dueDate
        break
      case 'projectId':
        rollback.projectId = snapshot.before.projectId
        break
      case 'labels':
        rollback.labels = snapshot.before.labels
        break
      case 'isFlagged':
        rollback.isFlagged = snapshot.before.isFlagged
        break
      case 'isArchived':
        rollback.isArchived = snapshot.before.isArchived
        break
      case 'kanbanColumn':
        rollback.kanbanColumn = snapshot.before.kanbanColumn
        break
    }
  }
  return rollback
}

/** Require a complete one-to-one durable outcome for every requested target. */
export function assessBulkUpdateOutcome(
  targetIds: readonly string[],
  result: BulkUpdateSessionsResult | unknown,
): BulkOutcomeAssessment {
  if (!result || typeof result !== 'object') {
    return { valid: false, reason: 'bulk_outcome_malformed' }
  }
  if (
    !('ok' in result)
    || !('failed' in result)
    || !Array.isArray(result.ok)
    || !Array.isArray(result.failed)
  ) {
    return { valid: false, reason: 'bulk_outcome_malformed' }
  }

  const targets = new Set(targetIds)
  if (targets.size !== targetIds.length) {
    return { valid: false, reason: 'bulk_outcome_malformed' }
  }

  const seen = new Set<string>()
  const okIds: string[] = []
  const failedIds: string[] = []
  for (const id of result.ok) {
    if (typeof id !== 'string' || !targets.has(id) || seen.has(id)) {
      return { valid: false, reason: 'bulk_outcome_malformed' }
    }
    seen.add(id)
    okIds.push(id)
  }
  for (const failure of result.failed) {
    if (
      !failure
      || typeof failure !== 'object'
      || !('id' in failure)
      || typeof failure.id !== 'string'
    ) {
      return { valid: false, reason: 'bulk_outcome_malformed' }
    }
    const { id } = failure
    if (!targets.has(id) || seen.has(id)) {
      return { valid: false, reason: 'bulk_outcome_malformed' }
    }
    seen.add(id)
    failedIds.push(id)
  }

  if (seen.size !== targets.size) {
    return { valid: false, reason: 'bulk_outcome_malformed' }
  }
  return { valid: true, okIds, failedIds }
}

/** Per-session currentness guard for overlapping local bulk operations. */
export function createCollectionBulkOperationRegistry() {
  let nextOperationId = 0
  const currentOperationBySessionId = new Map<string, number>()

  return {
    nextId(): number {
      nextOperationId += 1
      return nextOperationId
    },
    hasCurrentTargets(): boolean {
      return currentOperationBySessionId.size > 0
    },
    begin(operation: OptimisticCollectionBulkOperation): void {
      for (const sessionId of operation.targetIds) {
        currentOperationBySessionId.set(sessionId, operation.id)
      }
    },
    isCurrent(operation: OptimisticCollectionBulkOperation, sessionId: string): boolean {
      return currentOperationBySessionId.get(sessionId) === operation.id
    },
    resolve(operation: OptimisticCollectionBulkOperation, sessionId: string): void {
      if (currentOperationBySessionId.get(sessionId) === operation.id) {
        currentOperationBySessionId.delete(sessionId)
      }
    },
  }
}

/** Shared across all collection hosts; transient and reset on reload. */
export const collectionBulkOperationRegistry = createCollectionBulkOperationRegistry()
