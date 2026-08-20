import type { CollectionDisplay, SessionPriority } from '@craft-agent/shared/sessions/collection'

export interface TableGroupBucket {
  key: string
  label: string
  count: number
}

export interface TableGroup<TItem> {
  bucket: TableGroupBucket | null
  items: TItem[]
}

interface EmptyTableGroupsOptions {
  groupBy: CollectionDisplay['groupBy']
  priorities: readonly SessionPriority[]
  statusById: ReadonlyMap<string, { id: string; label: string }>
  projectNameById: ReadonlyMap<string, string>
  labelById: ReadonlyMap<string, string>
  t: (key: string, options?: Record<string, unknown>) => string
}

/**
 * Enumerates the configured buckets for Display's "Show empty groups" option.
 * It deliberately includes the synthetic no-project/no-label buckets because
 * they are valid group targets even when currently empty.
 */
export function emptyTableGroupBuckets({
  groupBy,
  priorities,
  statusById,
  projectNameById,
  labelById,
  t,
}: EmptyTableGroupsOptions): TableGroupBucket[] {
  switch (groupBy) {
    case 'status':
      return [...statusById.values()].map(({ id, label }) => ({ key: `status:${id}`, label, count: 0 }))
    case 'priority':
      return priorities.map((priority) => ({ key: `priority:${priority}`, label: t(`priority.${priority}`), count: 0 }))
    case 'project':
      return [
        { key: 'project:', label: t('collection.bulk.noProject'), count: 0 },
        ...[...projectNameById].map(([id, label]) => ({ key: `project:${id}`, label, count: 0 })),
      ]
    case 'dueDate':
      return ['overdue', 'today', 'this_week', 'later', 'none'].map((bucket) => ({
        key: `due:${bucket}`,
        label: t(`collection.display.dueBucket.${bucket}`),
        count: 0,
      }))
    case 'label':
      return [
        { key: 'label:none', label: t('collection.display.labelNone'), count: 0 },
        ...[...labelById].map(([id, label]) => ({ key: `label:${id}`, label, count: 0 })),
      ]
    case 'none':
      return []
  }
}

/** Adds configured empty buckets without replacing populated or unknown buckets. */
export function withEmptyTableGroups<TItem>(
  groups: readonly TableGroup<TItem>[],
  showEmptyGroups: boolean,
  emptyBuckets: readonly TableGroupBucket[],
): TableGroup<TItem>[] {
  if (!showEmptyGroups) return [...groups]

  const result = [...groups]
  const keys = new Set(result.flatMap((group) => group.bucket ? [group.bucket.key] : []))
  for (const bucket of emptyBuckets) {
    if (keys.has(bucket.key)) continue
    result.push({ bucket, items: [] })
  }
  return result
}
