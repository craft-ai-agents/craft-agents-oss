/**
 * Pure filter/sort for sessions collection views (list, board, table).
 */

import type { SessionPriority } from '../protocol/dto.ts'
import type {
  CollectionDisplay,
  CollectionFilters,
  CollectionOrderBy,
  CollectionOrderDir,
  DueRange,
} from './collection-types.ts'

export type { CollectionFilters, DueRange }

/** Minimal session shape needed for filter/sort (renderer SessionMeta-compatible). */
export interface CollectionSessionMeta {
  id: string
  name?: string
  sessionStatus?: string
  priority?: SessionPriority | null
  dueDate?: number | null
  projectId?: string | null
  labels?: string[]
  isFlagged?: boolean
  hasUnread?: boolean
  model?: string | null
  rank?: string | null
  lastMessageAt?: number | null
  createdAt?: number | null
}


export type DueBucket = 'overdue' | 'today' | 'this_week' | 'later' | 'none'

export interface FilterSessionMetaOptions {
  showCompleted: boolean
  now?: number
  /**
   * Workspace status config lookup. When provided, a status with
   * `category === 'closed'` is treated as terminal even if its id is not the
   * built-in `done`/`cancelled` (custom statuses: `closed`, `shipped`, ...).
   */
  statusById?: ReadonlyMap<string, { category?: string }>
}

const PRIORITY_WEIGHT: Record<SessionPriority, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
  none: 0,
}

const TERMINAL_STATUSES: Record<string, true> = {
  done: true,
  cancelled: true,
}

export function priorityWeight(p: SessionPriority | null | undefined): number {
  return PRIORITY_WEIGHT[p ?? 'none'] ?? 0
}

export function localDayBounds(now: number): { start: number; end: number } {
  const d = new Date(now)
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const end = start + 24 * 60 * 60 * 1000 - 1
  return { start, end }
}

export function dueBucket(dueDate: number | null | undefined, now: number): DueBucket {
  if (dueDate == null || !Number.isFinite(dueDate)) return 'none'
  const { start: todayStart } = localDayBounds(now)
  if (dueDate < todayStart) return 'overdue'
  const todayEnd = todayStart + 24 * 60 * 60 * 1000 - 1
  if (dueDate <= todayEnd) return 'today'
  const day = new Date(todayStart).getDay()
  const daysUntilSunday = (7 - day) % 7
  const weekEnd = todayStart + (daysUntilSunday + 1) * 24 * 60 * 60 * 1000 - 1
  if (dueDate <= weekEnd) return 'this_week'
  return 'later'
}

function matchesDue(dueDate: number | null | undefined, due: DueRange, now: number): boolean {
  const hasDue = dueDate != null && Number.isFinite(dueDate)
  switch (due.type) {
    case 'none':
      return !hasDue
    case 'overdue':
      return hasDue && dueBucket(dueDate, now) === 'overdue'
    case 'today':
      return hasDue && dueBucket(dueDate, now) === 'today'
    case 'next_n_days': {
      if (!hasDue) return false
      const { start } = localDayBounds(now)
      const end = start + due.days * 24 * 60 * 60 * 1000 - 1
      return dueDate! >= start && dueDate! <= end
    }
    case 'range':
      if (!hasDue) return false
      return dueDate! >= due.start && dueDate! <= due.end
    default:
      return true
  }
}

/**
 * Filter one session. AND across chip dimensions; OR within multi-value chips.
 * EC-5: showCompleted=false hides terminal statuses unless an explicit status
 * chip includes that terminal id.
 */
export function filterSessionMeta(
  meta: CollectionSessionMeta,
  f: CollectionFilters,
  showCompletedOrOpts: boolean | FilterSessionMetaOptions,
  nowArg: number = Date.now(),
): boolean {
  const showCompleted =
    typeof showCompletedOrOpts === 'boolean' ? showCompletedOrOpts : showCompletedOrOpts.showCompleted
  const now =
    typeof showCompletedOrOpts === 'boolean'
      ? nowArg
      : (showCompletedOrOpts.now ?? nowArg)
  const statusById =
    typeof showCompletedOrOpts === 'boolean' ? undefined : showCompletedOrOpts.statusById

  const status = meta.sessionStatus ?? 'todo'
  const statusChips = f.status ?? []
  const statusChipSet = new Set(statusChips)

  const isTerminal = TERMINAL_STATUSES[status] === true || statusById?.get(status)?.category === 'closed'

  if (!showCompleted && isTerminal && !statusChipSet.has(status)) {
    return false
  }

  if (statusChips.length > 0 && !statusChipSet.has(status)) return false

  if (f.priority && f.priority.length > 0) {
    const p = meta.priority ?? 'none'
    if (!f.priority.includes(p)) return false
  }

  if (f.projectId && f.projectId.length > 0) {
    const pid = meta.projectId ?? ''
    if (!f.projectId.includes(pid)) return false
  }

  if (f.labels && f.labels.length > 0) {
    const labels = meta.labels ?? []
    if (!f.labels.some((l) => labels.includes(l))) return false
  }

  if (f.due && !matchesDue(meta.dueDate, f.due, now)) return false

  if (typeof f.flagged === 'boolean' && Boolean(meta.isFlagged) !== f.flagged) return false
  if (typeof f.hasUnread === 'boolean' && Boolean(meta.hasUnread) !== f.hasUnread) return false

  if (f.model && f.model.length > 0) {
    const m = meta.model ?? ''
    if (!f.model.includes(m)) return false
  }

  return true
}

function cmpNullableNumber(
  a: number | null | undefined,
  b: number | null | undefined,
  dir: CollectionOrderDir,
): number {
  const aNull = a == null || !Number.isFinite(a)
  const bNull = b == null || !Number.isFinite(b)
  if (aNull && bNull) return 0
  if (aNull) return dir === 'asc' ? 1 : -1
  if (bNull) return dir === 'asc' ? -1 : 1
  const d = (a as number) - (b as number)
  return dir === 'asc' ? d : -d
}

function cmpString(a: string, b: string, dir: CollectionOrderDir): number {
  if (a < b) return dir === 'asc' ? -1 : 1
  if (a > b) return dir === 'asc' ? 1 : -1
  return 0
}

/** Stable compare: primary orderBy, then id asc tie-break. */
export function compareSessions(
  a: CollectionSessionMeta,
  b: CollectionSessionMeta,
  orderBy: CollectionOrderBy,
  orderDir: CollectionOrderDir,
): number {
  let primary = 0
  switch (orderBy) {
    case 'rank':
      primary = cmpString(a.rank ?? '', b.rank ?? '', orderDir)
      break
    case 'priority': {
      const wa = priorityWeight(a.priority)
      const wb = priorityWeight(b.priority)
      primary = orderDir === 'asc' ? wa - wb : wb - wa
      break
    }
    case 'dueDate':
      primary = cmpNullableNumber(a.dueDate, b.dueDate, orderDir)
      break
    case 'lastMessageAt':
      primary = cmpNullableNumber(a.lastMessageAt, b.lastMessageAt, orderDir)
      break
    case 'createdAt':
      primary = cmpNullableNumber(a.createdAt, b.createdAt, orderDir)
      break
    case 'name':
      primary = cmpString((a.name ?? '').toLocaleLowerCase(), (b.name ?? '').toLocaleLowerCase(), orderDir)
      break
    default:
      primary = 0
  }
  if (primary !== 0) return primary
  if (a.id < b.id) return -1
  if (a.id > b.id) return 1
  return 0
}

export function querySessionMetas(
  metas: CollectionSessionMeta[],
  filters: CollectionFilters,
  display: Pick<CollectionDisplay, 'orderBy' | 'orderDir' | 'showCompleted'>,
  now: number = Date.now(),
  statusById?: ReadonlyMap<string, { category?: string }>,
): CollectionSessionMeta[] {
  return metas
    .filter((m) =>
      filterSessionMeta(m, filters, { showCompleted: display.showCompleted, now, statusById }),
    )
    .sort((a, b) => compareSessions(a, b, display.orderBy, display.orderDir))
}
