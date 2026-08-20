/**
 * session-families — pure helpers for grouping branch sessions into "families".
 *
 * A session family is a root chat plus all sessions branched from it (directly
 * or transitively — branch-of-branch joins the TOP root's family, families are
 * flat, never nested). Lineage comes from `SessionMeta.branchFromSessionId`,
 * persisted server-side (undefined for roots and legacy pre-feature branches,
 * which therefore render as ordinary chats).
 *
 * No React imports — this module is unit-tested in isolation and consumed by
 * SessionList.tsx for all four grouping modes (date/status/unread/project)
 * plus search mode.
 */

/** Minimal shape family logic needs; SessionMeta satisfies it structurally. */
export interface FamilySessionLike {
  id: string
  branchFromSessionId?: string
  createdAt?: number
  lastMessageAt?: number
}

export interface SessionFamily {
  /** Id of the family's root (top ancestor present in the item set). */
  rootId: string
  /** Root first, then branches by createdAt asc (tie-break by id). */
  memberIds: string[]
  /** max(lastMessageAt ?? 0) across all members. */
  lastActivity: number
  /**
   * True when the family has exactly one member. Singletons are returned
   * explicitly (NOT filtered) so callers can assert regular rendering; they
   * get no UI treatment (no chevron, no grouping).
   */
  isSingleton: boolean
}

export interface SessionFamiliesResult {
  families: SessionFamily[]
  familyBySessionId: Map<string, SessionFamily>
}

/** Collapse-state key for a family; stored in the same collapsedSessionGroups set as bucket keys. */
export function familyCollapseKey(rootId: string): string {
  return `family:${rootId}`
}

/** Safety cap for walking branchFromSessionId chains (pathological data). */
const MAX_ANCESTOR_DEPTH = 32

/**
 * Compute session families from the supplied sessions (typically the metas of
 * the current sidebar view).
 *
 * Root detection walks the `branchFromSessionId` chain upward:
 * - stops at a session without the field (true root);
 * - if an ancestor is MISSING from `items` (deleted / archived separately),
 *   the chain stops at the deepest present node — the orphan branch becomes
 *   the root of its own family;
 * - cycles and self-references are cut by a visited set — the current node
 *   becomes the root;
 * - chains deeper than MAX_ANCESTOR_DEPTH are truncated the same way.
 */
export function buildSessionFamilies(items: readonly FamilySessionLike[]): SessionFamiliesResult {
  const byId = new Map<string, FamilySessionLike>()
  for (const item of items) byId.set(item.id, item)

  const resolveRootId = (start: FamilySessionLike): string => {
    const visited = new Set<string>([start.id])
    let current = start
    let depth = 0
    while (current.branchFromSessionId && depth < MAX_ANCESTOR_DEPTH) {
      const parent = byId.get(current.branchFromSessionId)
      if (!parent) break // orphan: parent missing from items → current is root
      if (visited.has(parent.id)) break // cycle/self-reference: current is root
      visited.add(parent.id)
      current = parent
      depth++
    }
    return current.id
  }

  const membersByRoot = new Map<string, FamilySessionLike[]>()
  for (const item of items) {
    const rootId = resolveRootId(item)
    const bucket = membersByRoot.get(rootId)
    if (bucket) bucket.push(item)
    else membersByRoot.set(rootId, [item])
  }

  const families: SessionFamily[] = []
  const familyBySessionId = new Map<string, SessionFamily>()

  for (const [rootId, members] of membersByRoot) {
    const branches = members
      .filter(m => m.id !== rootId)
      .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const family: SessionFamily = {
      rootId,
      memberIds: [rootId, ...branches.map(m => m.id)],
      lastActivity: members.reduce((acc, m) => Math.max(acc, m.lastMessageAt ?? 0), 0),
      isSingleton: members.length === 1,
    }
    families.push(family)
    for (const id of family.memberIds) familyBySessionId.set(id, family)
  }

  return { families, familyBySessionId }
}

// --------------------------------------------------------------------------
// Family units — bucketing/expansion stage consumed by SessionList
// --------------------------------------------------------------------------

/** Metadata for the visible head row of a multi-member family. */
export interface FamilyUnitHead {
  /** Session id of the head row (the family root). */
  id: string
  /** Collapse-state key (`family:<rootId>`) for the persisted collapsedGroups set. */
  collapseKey: string
  /** Number of branch rows present in the current row set (excludes the root). */
  branchCount: number
  /** Whether the family is currently collapsed (branch rows hidden). */
  collapsed: boolean
}

/**
 * A family unit groups a family's PRESENT members so the caller can:
 * - assign the whole family to ONE outer bucket via `bucketItem` — the member
 *   with the latest activity; this keeps a family together even when member
 *   activity spans several date buckets (the family's bucket is the bucket of
 *   its latest activity, not per-member dates);
 * - sort within the bucket by `lastActivity` (max lastMessageAt of members);
 * - flatten into consecutive `rows` (root first, branches by createdAt asc),
 *   with branch rows omitted when the family is collapsed.
 */
export interface FamilyUnit<T> {
  /** Present member with the max lastMessageAt — drives outer-group bucketing. */
  bucketItem: T
  /** max(lastMessageAt ?? 0) across present members — drives in-bucket position. */
  lastActivity: number
  /** Items to render consecutively; branches excluded when collapsed. */
  rows: T[]
  /** Present when 2+ members of the family are present AND the root is among them. */
  head: FamilyUnitHead | null
  /** Ids of rows rendered as indented branch rows. Empty for singletons/collapsed families. */
  branchIds: string[]
}

/**
 * Group a (visible) subset of sessions into family units.
 *
 * - Members missing from `items` (filtered out by search, pagination, or an
 *   outer filter) simply don't render. If the ROOT is missing but branches
 *   are present, the first present branch (in family order) becomes the
 *   visible head WITHOUT chevron/count (`head` is null) and collapse state is
 *   ignored — there is nothing to toggle from.
 * - A family is collapsed (branch rows hidden, root stays) only when the root
 *   is present and its `family:<rootId>` key is in `collapsedKeys`.
 * - Singletons (family of one, or only one member present) are returned as
 *   regular units with `head: null` — they render exactly as before.
 *
 * Iteration order follows first appearance in `items`, so callers relying on
 * input order (e.g. search results) keep it for non-family rows.
 */
export function groupIntoFamilyUnits<T extends Pick<FamilySessionLike, 'id' | 'createdAt' | 'lastMessageAt'>>(
  items: readonly T[],
  familyBySessionId: Map<string, SessionFamily>,
  collapsedKeys: ReadonlySet<string>,
): FamilyUnit<T>[] {
  const byFamilyKey = new Map<string, { family: SessionFamily | null; members: T[] }>()
  for (const item of items) {
    const family = familyBySessionId.get(item.id) ?? null
    const key = family && !family.isSingleton ? family.rootId : `__single__${item.id}`
    const bucket = byFamilyKey.get(key)
    if (bucket) bucket.members.push(item)
    else byFamilyKey.set(key, { family, members: [item] })
  }

  const units: FamilyUnit<T>[] = []
  for (const { family, members } of byFamilyKey.values()) {
    if (!family || family.isSingleton || members.length === 1) {
      for (const member of members) {
        units.push({
          bucketItem: member,
          lastActivity: member.lastMessageAt ?? 0,
          rows: [member],
          head: null,
          branchIds: [],
        })
      }
      continue
    }

    // Present members in canonical family order (root first, branches createdAt asc).
    const order = new Map<string, number>()
    family.memberIds.forEach((id, index) => order.set(id, index))
    members.sort((a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER))

    let bucketItem = members[0]
    let lastActivity = 0
    for (const member of members) {
      const at = member.lastMessageAt ?? 0
      if (at > lastActivity) {
        lastActivity = at
        bucketItem = member
      }
    }

    const rootPresent = members[0].id === family.rootId
    if (!rootPresent) {
      // Search/filter edge: root didn't match — first present branch is the
      // visible head without chevron, remaining branches stay attached below it.
      units.push({
        bucketItem,
        lastActivity,
        rows: members,
        head: null,
        branchIds: members.slice(1).map(m => m.id),
      })
      continue
    }

    const collapseKey = familyCollapseKey(family.rootId)
    const collapsed = collapsedKeys.has(collapseKey)
    const rows = collapsed ? [members[0]] : members
    units.push({
      bucketItem,
      lastActivity,
      rows,
      head: {
        id: family.rootId,
        collapseKey,
        branchCount: members.length - 1,
        collapsed,
      },
      branchIds: collapsed ? [] : members.slice(1).map(m => m.id),
    })
  }
  return units
}

/** Per-row decoration metadata keyed by session id, derived from family units. */
export interface FamilyRowMetaEntry {
  familyHead?: FamilyUnitHead
  isFamilyBranch?: boolean
}

/** Map session id → family decoration for the rows produced by the units. */
export function buildFamilyRowMeta<T extends Pick<FamilySessionLike, 'id'>>(
  units: readonly FamilyUnit<T>[],
): Map<string, FamilyRowMetaEntry> {
  const meta = new Map<string, FamilyRowMetaEntry>()
  for (const unit of units) {
    for (const row of unit.rows) {
      if (unit.head && row.id === unit.head.id) {
        meta.set(row.id, { familyHead: unit.head })
      } else if (unit.branchIds.includes(row.id)) {
        meta.set(row.id, { isFamilyBranch: true })
      }
    }
  }
  return meta
}

/** Collapse keys of all multi-member families — included in Collapse All. */
export function familyCollapseKeys(familyBySessionId: Map<string, SessionFamily>): string[] {
  const seen = new Set<string>()
  for (const family of familyBySessionId.values()) {
    if (!family.isSingleton) seen.add(familyCollapseKey(family.rootId))
  }
  return [...seen]
}
