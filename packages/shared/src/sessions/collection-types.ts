/**
 * Sessions collection display / filter contracts (PRD §5).
 * Pure types only — no I/O.
 */

import type { SessionPriority } from '../protocol/dto.ts'

export type { SessionPriority }

/** Collection surface mode (list navigator, kanban board, dense table). */
export type CollectionViewMode = 'list' | 'board' | 'table'

/** Grouping dimension for list/table (board uses this for secondary subsections). */
export type CollectionGroupBy =
  | 'none'
  | 'status'
  | 'priority'
  | 'project'
  | 'dueDate'
  | 'label'

/** Sort key for collection ordering. */
export type CollectionOrderBy =
  | 'rank'
  | 'priority'
  | 'dueDate'
  | 'lastMessageAt'
  | 'createdAt'
  | 'name'

/** Optional property columns / chips controllable via Display. */
export type CollectionProperty =
  | 'status'
  | 'priority'
  | 'project'
  | 'labels'
  | 'dueDate'
  | 'model'
  | 'updated'
  | 'created'
  | 'flag'

export type CollectionOrderDir = 'asc' | 'desc'

/**
 * Workspace-persisted collection display settings.
 * Stored at `{workspace}/collection/display.json`.
 */
export interface CollectionDisplay {
  version: 1
  groupBy: CollectionGroupBy
  orderBy: CollectionOrderBy
  orderDir: CollectionOrderDir
  visibleProperties: CollectionProperty[]
  showEmptyGroups: boolean
  showCompleted: boolean
}

/** Due-date filter chip value. */
export type DueRange =
  | { type: 'none' }
  | { type: 'overdue' }
  | { type: 'today' }
  | { type: 'next_n_days'; days: number }
  | { type: 'range'; start: number; end: number }

/**
 * Collection filter chips.
 * AND across dimensions; OR within each array dimension.
 */
export interface CollectionFilters {
  status?: string[]
  priority?: SessionPriority[]
  projectId?: string[]
  labels?: string[]
  due?: DueRange
  flagged?: boolean
  hasUnread?: boolean
  model?: string[]
}

/** Default Display for new workspaces / missing files (plan B2.2). */
export const DEFAULT_COLLECTION_DISPLAY: CollectionDisplay = {
  version: 1,
  groupBy: 'none',
  orderBy: 'rank',
  orderDir: 'asc',
  visibleProperties: [
    'status',
    'priority',
    'project',
    'labels',
    'dueDate',
    'updated',
    'flag',
  ],
  showEmptyGroups: false,
  showCompleted: true,
}

/** Default empty filters (no chips active). */
export const DEFAULT_COLLECTION_FILTERS: CollectionFilters = {}

/** Allowed enum values (shared by normalize). */
export const COLLECTION_GROUP_BY_VALUES: readonly CollectionGroupBy[] = [
  'none',
  'status',
  'priority',
  'project',
  'dueDate',
  'label',
] as const

export const COLLECTION_ORDER_BY_VALUES: readonly CollectionOrderBy[] = [
  'rank',
  'priority',
  'dueDate',
  'lastMessageAt',
  'createdAt',
  'name',
] as const

export const COLLECTION_PROPERTY_VALUES: readonly CollectionProperty[] = [
  'status',
  'priority',
  'project',
  'labels',
  'dueDate',
  'model',
  'updated',
  'created',
  'flag',
] as const
