import type { SessionMeta } from '../atoms/sessions'
import type { TreeGuide } from '../components/ui/entity-row'

/**
 * Sub-sessions in the session list. A session nests under its list parent: the session that
 * spawned it or runs it as a task step (`parentSessionId`), else the session it was branched from.
 * Grouping, sorting and pagination place a whole family by its view (see `SessionFamily.view`), so
 * a family is never split across groups or pages.
 */

/** One row of the session list */
export interface SessionListRow {
  item: SessionMeta
  /** Nesting level: 0 for a family's root and for every row outside a family */
  depth: number
  /** Sessions nested under this row, at any depth */
  descendantCount: number
  /** Whether the sessions nested under this row are hidden */
  collapsed: boolean
  /** What the row is grouped, sorted and paginated by: its family's view */
  groupItem: SessionMeta
  /** The row this one is nested under */
  parent?: SessionMeta
  /** Tree lines of the levels above this row, one per level (`depth` of them) */
  guides: TreeGuide[]
}

export interface SessionFamilyMember {
  item: SessionMeta
  depth: number
  descendantCount: number
}

export interface SessionFamily {
  /** Display order: each session, then the subtree of each of its children in creation order */
  members: SessionFamilyMember[]
  /**
   * The root as its family is placed: the newest activity of any member, and unread when any member
   * is. Used for grouping, sorting and pagination, never rendered.
   */
  view: SessionMeta
}

/** The session `meta` nests under in the list, if any */
export function listParentId(meta: Pick<SessionMeta, 'parentSessionId' | 'branchFromSessionId'>): string | undefined {
  return meta.parentSessionId ?? meta.branchFromSessionId
}

/** A row outside any family (search results) */
export function flatRow(item: SessionMeta): SessionListRow {
  return { item, depth: 0, descendantCount: 0, collapsed: false, groupItem: item, guides: [] }
}

/**
 * Groups `items` into families. A session nests only when its list parent is in `items` too;
 * otherwise it's a root, as if it had no parent. A loop of parents (possible in a hand-edited
 * session header) is broken where the walk up from its newest member meets it again. Families come
 * in the order of their first member in `items`, which the list hands over newest first.
 */
export function buildSessionFamilies(items: readonly SessionMeta[]): SessionFamily[] {
  const byId = new Map(items.map(item => [item.id, item]))
  const parentOf = new Map<string, string>()
  for (const item of items) {
    const parentId = listParentId(item)
    if (parentId && parentId !== item.id && byId.has(parentId)) parentOf.set(item.id, parentId)
  }

  // Break loops: the session whose parent was already passed on the walk up becomes a root
  for (const item of items) {
    const passed = new Set([item.id])
    for (let id = item.id, parentId = parentOf.get(id); parentId; parentId = parentOf.get(id)) {
      if (passed.has(parentId)) {
        parentOf.delete(id)
        break
      }
      passed.add(parentId)
      id = parentId
    }
  }

  const childrenOf = new Map<string, SessionMeta[]>()
  for (const item of items) {
    const parentId = parentOf.get(item.id)
    if (!parentId) continue
    const siblings = childrenOf.get(parentId)
    if (siblings) siblings.push(item)
    else childrenOf.set(parentId, [item])
  }
  for (const siblings of childrenOf.values()) {
    siblings.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
  }

  const rootIds = new Set<string>()
  for (const item of items) {
    let rootId = item.id
    for (let parentId = parentOf.get(rootId); parentId; parentId = parentOf.get(rootId)) rootId = parentId
    rootIds.add(rootId)
  }

  return Array.from(rootIds, rootId => {
    const members: SessionFamilyMember[] = []
    const visit = (item: SessionMeta, depth: number): number => {
      const member: SessionFamilyMember = { item, depth, descendantCount: 0 }
      members.push(member)
      for (const child of childrenOf.get(item.id) ?? []) member.descendantCount += 1 + visit(child, depth + 1)
      return member.descendantCount
    }
    const root = byId.get(rootId)!
    visit(root, 0)
    return { members, view: familyView(root, members) }
  })
}

function familyView(root: SessionMeta, members: readonly SessionFamilyMember[]): SessionMeta {
  let newest = 0
  let unread = false
  for (const { item } of members) {
    newest = Math.max(newest, item.lastMessageAt || 0)
    unread ||= item.hasUnread === true
  }
  if (newest === (root.lastMessageAt || 0) && unread === (root.hasUnread === true)) return root
  return { ...root, lastMessageAt: newest, hasUnread: unread }
}

/** The list's rows: every member of `families` in order, minus those under a collapsed row */
export function flattenFamilies(families: readonly SessionFamily[], collapsed: ReadonlySet<string>): SessionListRow[] {
  const rows: SessionListRow[] = []
  for (const { members, view } of families) {
    const start = rows.length
    const path: SessionMeta[] = [] // the current row's ancestors, by depth
    for (let i = 0; i < members.length; i++) {
      const { item, depth, descendantCount } = members[i]
      const isCollapsed = descendantCount > 0 && collapsed.has(item.id)
      path.length = depth
      rows.push({ item, depth, descendantCount, collapsed: isCollapsed, groupItem: view, parent: path[depth - 1], guides: [] })
      path.push(item)
      if (isCollapsed) i += descendantCount
    }
    addGuides(rows, start)
  }
  return rows
}

/**
 * Fills in the tree lines of one family's rows, `rows[start..]`, bottom up. The line of `level` goes on
 * below a row while the next row no deeper than `level + 1` is exactly that deep: a later child of the
 * same parent, not the end of its subtree.
 */
function addGuides(rows: SessionListRow[], start: number): void {
  const goesOn: boolean[] = [] // by level, for the rows below the current one
  for (let i = rows.length - 1; i >= start; i--) {
    const row = rows[i]
    row.guides = Array.from({ length: row.depth }, (_, level) => level === row.depth - 1
      ? (goesOn[level] ? 'branch' : 'last')
      : (goesOn[level] ? 'pass' : 'none'))
    goesOn.length = row.depth // this row ends the lines of its own level and deeper ones
    if (row.depth > 0) goesOn[row.depth - 1] = true
  }
}

/** Ids of the sessions `sessionId` is nested under in `families`, nearest first; undefined when it isn't in them */
export function ancestorIds(families: readonly SessionFamily[], sessionId: string): string[] | undefined {
  for (const { members } of families) {
    const index = members.findIndex(member => member.item.id === sessionId)
    if (index < 0) continue
    const ancestors: string[] = []
    let depth = members[index].depth
    for (let i = index - 1; i >= 0 && depth > 0; i--) {
      if (members[i].depth < depth) {
        ancestors.push(members[i].item.id)
        depth = members[i].depth
      }
    }
    return ancestors
  }
  return undefined
}
