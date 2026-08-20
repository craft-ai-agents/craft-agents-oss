import type { BulkUpdateSessionsPatch } from '../protocol/dto.ts'

/**
 * Browser-safe session collection contracts and query helpers.
 *
 * This surface deliberately excludes session storage, JSONL, bundles,
 * validation, and collection-display persistence.
 */

export type {
  SessionPriority,
  CollectionViewMode,
  CollectionGroupBy,
  CollectionOrderBy,
  CollectionOrderDir,
  CollectionProperty,
  CollectionDisplay,
  DueRange,
  CollectionFilters,
} from './collection-types.ts'
export {
  DEFAULT_COLLECTION_DISPLAY,
  DEFAULT_COLLECTION_FILTERS,
  COLLECTION_GROUP_BY_VALUES,
  COLLECTION_ORDER_BY_VALUES,
  COLLECTION_PROPERTY_VALUES,
} from './collection-types.ts'

export type {
  CollectionSessionMeta,
  FilterSessionMetaOptions,
  DueBucket,
} from './collection-query.ts'
export {
  priorityWeight,
  localDayBounds,
  dueBucket,
  filterSessionMeta,
  compareSessions,
  querySessionMetas,
} from './collection-query.ts'

export {
  LEXORANK_MAX_LENGTH,
  lexorankValidate,
  lexorankBetween,
  lexorankN,
  backfillRanks,
} from './lexorank.ts'

/** Reject ambiguous replacement-plus-delta label patches before mutation. */
export function assertValidBulkLabelPatch(patch: BulkUpdateSessionsPatch): void {
  if (
    patch.labels !== undefined
    && (patch.addLabels !== undefined || patch.removeLabels !== undefined)
  ) {
    throw new Error('bulk_labels_conflict')
  }
}

/**
 * Resolve replacement or delta label operations for one session.
 * Delta order is stable: existing labels, then new additions, then removals.
 */
export function resolveBulkLabels(
  currentLabels: readonly string[] | undefined,
  patch: BulkUpdateSessionsPatch,
): string[] | undefined {
  assertValidBulkLabelPatch(patch)

  if (patch.labels !== undefined) return [...new Set(patch.labels)]
  if (patch.addLabels === undefined && patch.removeLabels === undefined) return undefined

  const next = new Set(currentLabels ?? [])
  for (const labelId of patch.addLabels ?? []) next.add(labelId)
  for (const labelId of patch.removeLabels ?? []) next.delete(labelId)
  return [...next]
}
